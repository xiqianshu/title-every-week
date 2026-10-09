import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { checkBrowserCall, pageReadCode, mutePageCode, currentPageCode } from './browser-read.mjs';

// MCP is newline-delimited JSON-RPC. Proxy the pinned server and add one fixed reader.
const upstream = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/@playwright/mcp/cli.js', import.meta.url)), '--extension', '--snapshot-mode', 'none'], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
const listings = new Set();
const navigation = new Set(), muting = new Map(); let serial = 0;
const names = new Set(['browser_navigate', 'browser_wait_for']);
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const error = (id, message) => send({ jsonrpc: '2.0', id, error: { code: -32602, message } });
createInterface({ input: process.stdin }).on('line', line => {
  let message;
  try { if (line.length > 1000000) throw new Error('请求超过容量限制'); message = JSON.parse(line); }
  catch { error(null, '无效 MCP 请求'); return; }
  if (message.method === 'tools/list') listings.add(message.id);
  if (message.method === 'tools/call') {
    try { checkBrowserCall(message.params.name, message.params.arguments); }
    catch (e) { error(message.id, e.message); return; }
    if (message.params.name === 'browser_read_page') message.params = { name: 'browser_evaluate', arguments: { function: pageReadCode } };
    if (message.params.name === 'browser_tabs') message.params = { name: 'browser_evaluate', arguments: { function: currentPageCode } };
    if (message.params.name === 'browser_navigate') navigation.add(message.id);
    message.params.arguments = { ...message.params.arguments, _meta: { raw: true, json: true } };
  }
  upstream.stdin.write(JSON.stringify(message) + '\n');
}).on('close', () => upstream.kill('SIGTERM'));
createInterface({ input: upstream.stdout }).on('line', line => {
  try {
    const message = JSON.parse(line);
    if (muting.has(message.id)) { send(muting.get(message.id)); muting.delete(message.id); return; }
    if (navigation.delete(message.id)) {
      const id = 'creator-internal-mute-' + ++serial; muting.set(id, message);
      upstream.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'browser_evaluate', arguments: { function: mutePageCode, _meta: { raw: true, json: true } } } }) + '\n'); return;
    }
    if (listings.delete(message.id) && Array.isArray(message.result?.tools)) message.result.tools = [
      ...message.result.tools.filter(t => names.has(t.name)).map(t => t.name === 'browser_wait_for' ? { ...t, description: '等待最多五秒加载，不返回页面快照', inputSchema: { type: 'object', required: ['time'], properties: { time: { type: 'number', minimum: 0.1, maximum: 5 } }, additionalProperties: false } } : t),
      { name: 'browser_tabs', description: '仅核对当前公开研究页的网址与标题，不列举其他标签页', inputSchema: { type: 'object', required: ['action'], properties: { action: { type: 'string', enum: ['list'] } }, additionalProperties: false } },
      { name: 'browser_read_page', description: '读取当前公开页面的实际文字、可见作品链接、卡片文字、作者主页和明确字段标签。固定 DOM 读取并静音媒体，无需元素引用；保留小红书公开链接参数。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    ];
    send(message);
  } catch { process.stderr.write('上游 MCP 返回无法解析的消息\n'); }
});
upstream.stderr.pipe(process.stderr);
upstream.stdin.on('error', () => {});
upstream.on('error', () => { process.stderr.write('无法启动固定 Playwright 服务\n'); process.exit(1); });
upstream.on('close', code => process.exit(code || 0));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { upstream.kill(signal); });
