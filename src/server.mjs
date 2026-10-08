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

export function createServer(workflow) {
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
        if (url.pathname === '/api/config') {
          const config = validateConfig(input.config);
          if (input.playwrightToken) {
            if (typeof input.playwrightToken !== 'string' || input.playwrightToken.length > 512 || /\s/.test(input.playwrightToken)) throw new Error('连接令牌格式无效，请只粘贴令牌值');
            await workflow.store.write('secrets', { playwrightToken: input.playwrightToken });
          }
          await workflow.store.write('config', config);
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
        if (url.pathname === '/api/run') {
          if (!['collect', 'weekly', 'review'].includes(input.kind)) throw new Error('无效的任务类型');
          if (workflow.busy) return json(response, 409, { error: '已有任务正在运行，进度会自动更新' });
          workflow.run(input.kind).catch(error => console.error(safeMessage(error)));
          return json(response, 202, { accepted: true });
        }
        return json(response, 404, { error: '未找到该操作' });
      }
      if (request.method !== 'GET') return json(response, 405, { error: '不支持该请求方式' });
      if (url.pathname === '/api/status') return json(response, 200, { application: 'creator-workflow', ...(await workflow.status()) });
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
      response.writeHead(200, { 'Content-Type': asset[1] + '; charset=utf-8' });
      response.end(await readFile(path.join(publicRoot, asset[0])));
    } catch (error) { json(response, error.code === 'ENOENT' ? 404 : 400, { error: safeMessage(error) }); }
  });
}
