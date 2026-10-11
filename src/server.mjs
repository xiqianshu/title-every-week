import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { validateConfig, platformUrl, itemId, METRICS } from './model.mjs';
import { safeMessage } from './runtime.mjs';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
function json(response, status, data) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); }
async function body(request) {
  let size = 0, input = '';
  for await (const chunk of request) { size += chunk.length; if (size > 256000) throw new Error('输入内容过大'); input += chunk.toString(); }
  try { return JSON.parse(input || '{}'); } catch { throw new Error('输入格式无效'); }
}
function metricValues(raw) {
  return Object.fromEntries(METRICS.map(name => {
    const value = raw?.[name];
    if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('指标必须是非负数字，未知值应留空');
    return [name, value ?? null];
  }));
}

export function createServer(workflow, updater = null) {
  return http.createServer(async (request, response) => {
    const port = response.socket.localPort;
    const allowedHosts = ['127.0.0.1:' + port, 'localhost:' + port];
    if (!allowedHosts.includes(request.headers.host)) return json(response, 403, { error: '本工作台仅接受本机访问' });
    const origin = 'http://' + request.headers.host;
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    try {
      const url = new URL(request.url, origin);
      if (request.method === 'POST') {
        if (request.headers['x-workflow-request'] !== '1' || (request.headers.origin && request.headers.origin !== origin) || !String(request.headers['content-type']).startsWith('application/json')) return json(response, 403, { error: '请从本机工作台发起操作' });
        const input = await body(request);
        if (url.pathname === '/api/update/check' || url.pathname === '/api/update/install') {
          if (!updater) throw new Error('当前程序没有启用更新入口');
          return json(response, url.pathname.endsWith('/install') ? 202 : 200, await (url.pathname.endsWith('/install') ? updater.install() : updater.check()));
        }
        if (updater && await updater.busy()) return json(response, 409, { error: '正在更新工作台，请完成后再保存或运行任务；已有资料保留。' });
        if (url.pathname === '/api/stop') return json(response, 200, await workflow.stop());
        if (url.pathname === '/api/config') {
          const config = validateConfig(input.config);
          let stopped = false;
          if (input.playwrightToken) {
            if (typeof input.playwrightToken !== 'string' || input.playwrightToken.length > 512 || /\s/.test(input.playwrightToken)) throw new Error('连接令牌格式无效，请只粘贴令牌值');
          }
          const previous = await workflow.store.read('config');
          if (workflow.busy && config.pausedPlatforms.some(platform => !(previous.pausedPlatforms ?? ['xiaohongshu']).includes(platform))) {
            stopped = (await workflow.stop()).stopped;
            config.enabled = false;
          }
          if (input.playwrightToken) {
            const secrets = await workflow.store.read('secrets');
            await workflow.store.write('secrets', { ...secrets, playwrightToken: input.playwrightToken });
          }
          await workflow.store.write('config', config);
          return json(response, 200, { ok: true, stopped });
        }
        if (url.pathname === '/api/model-backend') {
          const models = ['gpt-6-luna', 'gpt-5.6-luna', 'grok-4.7'];
          const enabled = input.enabled === true;
          const model = String(input.model || 'gpt-6-luna');
          if (!models.includes(model)) throw new Error('请选择支持的模型');
          const secrets = await workflow.store.read('secrets');
          const previous = secrets.modelBackend || {};
          let apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
          if (apiKey && (apiKey.length > 512 || /\s/.test(apiKey))) throw new Error('API Key 格式无效，请只粘贴 Key 值');
          if (!apiKey) apiKey = previous.apiKey || '';
          if (enabled && !apiKey) throw new Error('请先粘贴 OpenCode API Key，再启用');
          const wire = 'responses';
          await workflow.store.write('secrets', { ...secrets, modelBackend: { enabled, model, wire, apiKey, baseUrl: 'https://opencode.ai/zen/go/v1' } });
          return json(response, 200, { ok: true });
        }
        if (url.pathname === '/api/notes') {
          const text = String(input.text || '').trim();
          if (!text || text.length > 10000) throw new Error('素材内容应为 1—10000 字');
          const note = { id: 'n-' + randomUUID().slice(0, 12), text, confirmed: true, createdAt: new Date().toISOString() };
          await workflow.store.update('notes', notes => [...notes, note].slice(-100));
          return json(response, 201, note);
        }
        if (url.pathname === '/api/posts') {
          platformUrl(input.url, input.platform);
          const date = Date.parse(input.publishedAt);
          if (!Number.isFinite(date) || date > Date.now() + 300000 || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(String(input.publishedAt))) throw new Error('请填写带时区的真实发布时间');
          const metrics = metricValues(input.metrics);
          const post = { id: 'p-' + itemId(input.url, input.platform), platform: input.platform, url: input.url, title: String(input.title || '').slice(0, 300), publishedAt: new Date(date).toISOString(), topicId: String(input.topicId || '').slice(0, 30) };
          await workflow.store.update('posts', posts => {
            const index = posts.findIndex(p => p.id === post.id);
            if (index >= 0) posts[index] = post; else posts.push(post);
            return posts.slice(-100);
          });
          if (input.metrics && Object.values(input.metrics).some(v => v != null)) {
            await workflow.store.update('snapshots', snapshots => [...snapshots, { postId: post.id, itemId: itemId(post.url, post.platform), collectedAt: new Date().toISOString(), metrics, url: post.url, origin: 'user_backend_entry' }].slice(-10000));
          }
          return json(response, 201, post);
        }
        if (url.pathname === '/api/notes/update' || url.pathname === '/api/notes/delete') {
          const id = String(input.id || '');
          if (!/^n-[a-z0-9-]{6,40}$/i.test(id)) throw new Error('素材编号无效');
          if (url.pathname.endsWith('/update')) {
            const text = String(input.text || '').trim();
            if (!text || text.length > 10000) throw new Error('素材内容应为 1—10000 字');
            let found = false;
            await workflow.store.update('notes', notes => notes.map(n => { if (n.id !== id) return n; found = true; return { ...n, text }; }));
            if (!found) throw new Error('没有找到这条素材');
            return json(response, 200, { ok: true });
          }
          let removed = 0;
          await workflow.store.update('notes', notes => { const next = notes.filter(n => n.id !== id); removed = notes.length - next.length; return next; });
          return json(response, 200, { ok: true, removed });
        }
        if (url.pathname === '/api/posts/delete') {
          const id = String(input.id || '');
          if (!/^p-[a-z0-9-]{6,80}$/i.test(id)) throw new Error('发布记录编号无效');
          let removed = 0;
          await workflow.store.update('posts', posts => { const next = posts.filter(p => p.id !== id); removed = posts.length - next.length; return next; });
          return json(response, 200, { ok: true, removed });
        }
        if (url.pathname === '/api/run') {
          if (!['collect', 'weekly', 'review'].includes(input.kind)) throw new Error('无效的任务类型');
          if (workflow.busy) return json(response, 409, { error: '已有任务正在运行，进度会自动更新' });
          workflow.run(input.kind).catch(error => console.error(safeMessage(error)));
          return json(response, 202, { accepted: true });
        }
        return json(response, 404, { error: '未找到该操作' });
      }
      if (request.method !== 'GET') return json(response, 405, { error: '不支持该请求方式' });
      if (url.pathname === '/api/status') {
        const status = await workflow.status(), update = updater ? await updater.status() : null;
        return json(response, 200, { application: 'creator-workflow', ...status, busy: status.busy || Boolean(update?.busy), updater: update });
      }
      if (url.pathname.startsWith('/api/reports/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/reports/'.length));
        if (!/^[a-z0-9-]+$/.test(id)) throw new Error('报告名称无效');
        const markdown = await readFile(path.join(workflow.store.root, 'reports', id + '.md'), 'utf8');
        if (url.searchParams.get('download') === '1') {
          response.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + id + '.md"' });
          return response.end(markdown);
        }
        return json(response, 200, { report: JSON.parse(await readFile(path.join(workflow.store.root, 'reports', id + '.json'), 'utf8')), markdown });
      }
      const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
      const asset = assets[url.pathname];
      if (!asset) return json(response, 404, { error: '未找到页面' });
      response.writeHead(200, { 'Content-Type': asset[1] + '; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(await readFile(path.join(publicRoot, asset[0])));
    } catch (error) { json(response, error.code === 'ENOENT' ? 404 : 400, { error: safeMessage(error) }); }
  });
}
