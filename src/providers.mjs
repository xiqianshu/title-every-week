import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { normalizeItem } from './model.mjs';
import { runProcess, safeMessage, cancelProcesses } from './runtime.mjs';
import { buildPrompt, collectionPrompt, validatePack } from './prompts.mjs';
import { collectPublicSources } from './public-sources.mjs';
import { researchPlanPrompt, insightsPrompt, validateResearchPlan, validateInsights } from './research.mjs';

export function validateCollection(output, sources, at) {
  if (!Array.isArray(output?.sources) || !Array.isArray(output?.items)) throw new Error('采集输出格式无效');
  const requests = new Map(sources.map(s => [s.id, s]));
  for (const result of output.sources) if (!requests.has(result.sourceId) || !['ok', 'empty', 'blocked', 'error'].includes(result.status)) throw new Error('采集输出含未知来源或状态');
  const counts = new Map(), accepted = new Map(), rejected = new Map();
  const items = [];
  for (const raw of output.items) {
    const source = requests.get(raw.sourceId);
    if (!source) throw new Error('作品引用了未请求的来源');
    const result = output.sources.find(r => r.sourceId === source.id);
    if (result?.status !== 'ok') throw new Error('作品来源未报告成功');
    const count = (counts.get(source.id) || 0) + 1;
    counts.set(source.id, count);
    if (count > source.limit) throw new Error('来源返回作品数超过本次上限');
    try {
      items.push(normalizeItem(raw, source, at));
      accepted.set(source.id, (accepted.get(source.id) || 0) + 1);
    } catch (error) {
      let link = '未提供有效网址';
      try { const parsed = new URL(String(raw.url || '')); link = parsed.origin + parsed.pathname; } catch {}
      const messages = rejected.get(source.id) || [];
      messages.push('第 ' + count + ' 条结果被拒绝（' + link.slice(0, 300) + '）：' + safeMessage(error));
      rejected.set(source.id, messages);
    }
  }
  return { items, sources: sources.map(s => {
    const result = output.sources.find(r => r.sourceId === s.id);
    const failures = rejected.get(s.id) || [];
    const message = [result?.message || (result ? '' : '该来源未取得结果'), ...failures].filter(Boolean).join('；');
    return { ...s, status: failures.length ? 'error' : result?.status || 'error', message: message.slice(0, 1000), count: accepted.get(s.id) || 0 };
  }) };
}

export class Providers {
  constructor(appRoot, store, runner = runProcess) { this.appRoot = appRoot; this.store = store; this.runner = runner; }
  begin() { this.stopped = false; }
  stop() { this.stopped = true; cancelProcesses(); }
  checkRunning() { if (this.stopped) throw new Error('你已停止当前任务'); }
  binary(name) { return path.join(this.appRoot, 'node_modules', ...(name === 'codex' ? ['@openai', 'codex', 'bin', 'codex.js'] : ['@jackwener', 'opencli', 'dist', 'src', 'main.js'])); }
  async codex(prompt, schema, browser = false) {
    this.checkRunning();
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
        'mcp_servers.playwright.args': [path.join(this.appRoot, 'src', 'browser-bridge.mjs')],
        'mcp_servers.playwright.env_vars': ['PLAYWRIGHT_MCP_EXTENSION_TOKEN'],
        'mcp_servers.playwright.enabled_tools': ['browser_tabs', 'browser_read_page', 'browser_navigate', 'browser_wait_for'],
        'mcp_servers.playwright.default_tools_approval_mode': 'approve',
      };
      for (const [key, value] of Object.entries(config)) args.push('-c', key + '=' + JSON.stringify(value));
    }
    args.push('-');
    this.checkRunning();
    await this.runner(process.execPath, [this.binary('codex'), ...args], { cwd: directory, input: prompt, env, timeoutMs: browser ? 240000 : 360000 });
    const result = await readFile(target, 'utf8');
    if (result.length > 2000000) throw new Error('结构化报告超过容量限制');
    try { return JSON.parse(result); } catch { throw new Error('模型没有返回有效的结构化报告'); }
  }
  async collect(sources, config, onProgress = async () => {}) {
    const at = new Date().toISOString();
    if (config.collector === 'playwright') {
      const result = { sources: [], items: [] }, blocked = new Set();
      // Keep completed batches when another page stalls or a later model call fails.
      for (let start = 0; start < sources.length; start += 3) {
        this.checkRunning();
        const next = sources.slice(start, start + 3), batch = next.filter(s => !blocked.has(s.platform));
        result.sources.push(...next.filter(s => blocked.has(s.platform)).map(s => ({ ...s, status: 'blocked', count: 0, message: '该平台需要处理登录或验证，未继续访问' })));
        if (batch.length) {
          try {
            const collected = validateCollection(await this.codex(collectionPrompt(batch), 'collection', true), batch, new Date().toISOString());
            result.sources.push(...collected.sources); result.items.push(...collected.items);
            for (const s of collected.sources) if (s.status === 'blocked') blocked.add(s.platform);
          } catch (error) { result.sources.push(...batch.map(s => ({ ...s, status: 'error', count: 0, message: safeMessage(error) }))); }
        }
        await onProgress({ completed: Math.min(start + 3, sources.length), total: sources.length, itemCount: new Set(result.items.map(i => i.id)).size, sources: result.sources.slice(), items: result.items.slice() });
      }
      return result;
    }
    const output = { sources: [], items: [] };
    const blocked = new Set();
    for (const source of sources) {
      this.checkRunning();
      if (blocked.has(source.platform)) { output.sources.push({ sourceId: source.id, status: 'blocked', message: '该平台需要手动处理登录或验证，已停止后续访问' }); continue; }
      try {
        let args;
        if (source.kind === 'discovery') {
          if (source.platform === 'douyin') throw new Error('OpenCLI 未提供抖音发现页作品读取；公开热榜独立采集，继续其他搜索');
          args = ['xiaohongshu', 'feed', '--limit', String(source.limit)];
        }
        else if (source.kind === 'search') args = [source.platform === 'douyin' ? 'douyin' : 'xiaohongshu', 'search', source.query, '--limit', String(source.limit)];
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
  async publicResearch() { return collectPublicSources(undefined, () => this.checkRunning()); }
  async planResearch(signals, config) { return validateResearchPlan(await this.codex(researchPlanPrompt(signals, config.profile), 'research-plan'), signals); }
  async analyze(bundle) { return validateInsights(await this.codex(insightsPrompt(bundle), 'insights'), bundle); }
  async generate(bundle, kind) { return validatePack(await this.codex(buildPrompt(bundle, kind), kind), bundle, kind); }
}
