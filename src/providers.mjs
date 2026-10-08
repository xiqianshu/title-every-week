import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { normalizeItem } from './model.mjs';
import { runProcess, safeMessage } from './runtime.mjs';
import { buildPrompt, collectionPrompt, validatePack } from './prompts.mjs';

export function validateCollection(output, sources, at) {
  if (!Array.isArray(output?.sources) || !Array.isArray(output?.items)) throw new Error('采集输出格式无效');
  const requests = new Map(sources.map(s => [s.id, s]));
  for (const result of output.sources) if (!requests.has(result.sourceId) || !['ok', 'empty', 'blocked', 'error'].includes(result.status)) throw new Error('采集输出含未知来源或状态');
  const counts = new Map();
  const items = output.items.map(raw => {
    const source = requests.get(raw.sourceId);
    if (!source) throw new Error('作品引用了未请求的来源');
    const result = output.sources.find(r => r.sourceId === source.id);
    if (result?.status !== 'ok') throw new Error('作品来源未报告成功');
    const count = (counts.get(source.id) || 0) + 1;
    counts.set(source.id, count);
    if (count > source.limit) throw new Error('来源返回作品数超过本次上限');
    return normalizeItem(raw, source, at);
  });
  return { items, sources: sources.map(s => {
    const result = output.sources.find(r => r.sourceId === s.id);
    return { ...s, status: result?.status || 'error', message: String(result?.message || (result ? '' : '该来源未取得结果')).slice(0, 1000), count: counts.get(s.id) || 0 };
  }) };
}

export class Providers {
  constructor(appRoot, store, runner = runProcess) { this.appRoot = appRoot; this.store = store; this.runner = runner; }
  binary(name) { return path.join(this.appRoot, 'node_modules', ...(name === 'codex' ? ['@openai', 'codex', 'bin', 'codex.js'] : ['@jackwener', 'opencli', 'dist', 'src', 'main.js'])); }
  async codex(prompt, schema, browser = false) {
    const directory = path.join(this.store.root, 'runs', randomUUID());
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const target = path.join(directory, 'result.json');
    const args = ['exec', '--ignore-user-config', '--skip-git-repo-check', '--sandbox', 'read-only', '--output-schema', path.join(this.appRoot, 'schemas', schema + '.json'), '--output-last-message', target, '--cd', directory];
    const env = {};
    if (browser) {
      const secrets = await this.store.read('secrets');
      if (!secrets.playwrightToken) throw new Error('请先在工作台填写 Playwright 扩展连接令牌；本次未启动浏览器连接');
      env.PLAYWRIGHT_MCP_EXTENSION_TOKEN = secrets.playwrightToken;
      const config = {
        'mcp_servers.playwright.command': process.execPath,
        'mcp_servers.playwright.args': [path.join(this.appRoot, 'node_modules', '@playwright', 'mcp', 'cli.js'), '--extension'],
        'mcp_servers.playwright.env_vars': ['PLAYWRIGHT_MCP_EXTENSION_TOKEN'],
        'mcp_servers.playwright.enabled_tools': ['browser_tabs', 'browser_snapshot', 'browser_find', 'browser_navigate', 'browser_wait_for', 'browser_take_screenshot'],
        'mcp_servers.playwright.default_tools_approval_mode': 'approve',
      };
      for (const [key, value] of Object.entries(config)) args.push('-c', key + '=' + JSON.stringify(value));
    }
    args.push('-');
    await this.runner(process.execPath, [this.binary('codex'), ...args], { cwd: directory, input: prompt, env, timeoutMs: browser ? 480000 : 360000 });
    const result = await readFile(target, 'utf8');
    if (result.length > 2000000) throw new Error('结构化报告超过容量限制');
    try { return JSON.parse(result); } catch { throw new Error('模型没有返回有效的结构化报告'); }
  }
  async collect(sources, config) {
    const at = new Date().toISOString();
    if (config.collector === 'playwright') return validateCollection(await this.codex(collectionPrompt(sources), 'collection', true), sources, at);
    const output = { sources: [], items: [] };
    const blocked = new Set();
    for (const source of sources) {
      if (blocked.has(source.platform)) { output.sources.push({ sourceId: source.id, status: 'blocked', message: '该平台需要手动处理登录或验证，已停止后续访问' }); continue; }
      try {
        let args;
        if (source.kind === 'search') args = [source.platform === 'douyin' ? 'douyin' : 'xiaohongshu', 'search', source.query, '--limit', String(source.limit)];
        else if (source.kind === 'account') args = [source.platform === 'douyin' ? 'douyin' : 'xiaohongshu', source.platform === 'douyin' ? 'user-videos' : 'user', source.url, '--limit', String(source.limit)];
        else if (source.platform === 'xiaohongshu') args = ['xiaohongshu', 'note', source.url];
        else args = ['web', 'read', '--url', source.url, '--download-images', 'false', '--stdout', 'true'];
        const markdownMode = args[0] === 'web';
        if (!markdownMode) args.push('-f', 'json');
        const result = await this.runner(process.execPath, [this.binary('opencli'), ...args], { cwd: this.appRoot, timeoutMs: 90000 });
        let rows;
        if (markdownMode) {
          if (/安全限制|请登录|登录后查看|人机验证/.test(result.stdout)) throw new Error('需要登录或平台验证，未读取作品');
          const title = result.stdout.match(/^#\s+(.+)$/m)?.[1];
          if (!title || /^抖音(?:精选|短视频|电脑版|\s*[-—|])/.test(title)) throw new Error('未取得作品实际标题；请使用默认 Playwright 采集');
          rows = [{ title, body: result.stdout, url: source.url }];
        } else {
          const parsed = JSON.parse(result.stdout);
          rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.data) ? parsed.data : [parsed];
          if (args[1] === 'note') {
            const fields = Object.fromEntries(rows.map(r => [r.field, r.value]));
            rows = [{ ...fields, saves: fields.collects, body: fields.content, url: source.url }];
          }
        }
        const normalized = rows.slice(0, source.limit).map(r => normalizeItem({ ...r, url: r.url || (r.aweme_id ? 'https://www.douyin.com/video/' + r.aweme_id : source.url), title: r.title || r.desc, sourceId: source.id }, { ...source, adapter: 'opencli', command: args[1] }, at));
        output.items.push(...normalized);
        output.sources.push({ ...source, status: normalized.length ? 'ok' : 'empty', message: '', count: normalized.length });
      } catch (error) {
        const message = safeMessage(error);
        const isBlocked = /login|auth|captcha|verify|verification|登录|验证码|风控|安全校验|not connected|connection.*timed out/i.test(message);
        if (isBlocked) blocked.add(source.platform);
        output.sources.push({ ...source, status: isBlocked ? 'blocked' : 'error', message, count: 0 });
      }
    }
    return output;
  }
  async generate(bundle, kind) { return validatePack(await this.codex(buildPrompt(bundle, kind), kind), bundle, kind); }
}
