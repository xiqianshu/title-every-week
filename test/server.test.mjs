import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { Workflow } from '../src/pipeline.mjs';
const web = await import('../src/server.mjs').catch(() => ({}));

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'creator-http-test-'));
  const store = new Store(root); await store.init();
  const workflow = new Workflow(store, { collect: async () => ({ items: [], sources: [] }), generate: async () => {} });
  const server = web.createServer(workflow);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const post = (route, data, headers = {}) => fetch(origin + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workflow-Request': '1', Origin: origin, ...headers }, body: JSON.stringify(data) });
  return { root, store, workflow, server, origin, post, close: async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); } };
}

test('HTTP configuration persists without returning the browser connection token', async () => {
  assert.equal(typeof web.createServer, 'function');
  const env = await setup();
  try {
    const config = await env.store.read('config'); config.profile.voice = '我自己的口吻';
    assert.equal((await env.post('/api/config', { config, playwrightToken: 'private-test-token' })).status, 200);
    const status = await (await fetch(env.origin + '/api/status')).json();
    assert.equal(status.config.profile.voice, '我自己的口吻');
    assert.equal(status.browserConfigured, true);
    assert.ok(!JSON.stringify(status).includes('private-test-token'));
    assert.equal((await env.store.read('secrets')).playwrightToken, 'private-test-token');
  } finally { await env.close(); }
});

test('external web origins cannot create jobs or alter personal notes', async () => {
  assert.equal(typeof web.createServer, 'function');
  const env = await setup();
  try {
    assert.equal((await env.post('/api/notes', { text: '不该保存' }, { Origin: 'https://evil.example' })).status, 403);
    assert.deepEqual(await env.store.read('notes'), []);
    assert.equal((await env.post('/api/run', { kind: 'collect' }, { 'X-Workflow-Request': '' })).status, 403);
  } finally { await env.close(); }
});

test('invalid token, metric or timezone does not partially persist a rejected request', async () => {
  const env = await setup();
  try {
    const before = await env.store.read('config');
    const changed = structuredClone(before); changed.profile.voice = '不能保存';
    assert.equal((await env.post('/api/config', { config: changed, playwrightToken: 'has spaces' })).status, 400);
    assert.deepEqual(await env.store.read('config'), before);
    const post = { platform: 'douyin', url: 'https://www.douyin.com/video/123', publishedAt: '2026-10-01T01:00:00Z' };
    assert.equal((await env.post('/api/posts', { ...post, metrics: { views: -1 } })).status, 400);
    assert.deepEqual(await env.store.read('posts'), []);
    assert.equal((await env.post('/api/posts', { ...post, publishedAt: '2026-10-01T01:00:00' })).status, 400);
    assert.deepEqual(await env.store.read('posts'), []);
  } finally { await env.close(); }
});

test('personal notes and publication observations are usable in later review', async () => {
  assert.equal(typeof web.createServer, 'function');
  const env = await setup();
  try {
    assert.equal((await env.post('/api/notes', { text: '我今天实际测试了一个 AI 提示词。' })).status, 201);
    assert.equal((await env.post('/api/posts', { platform: 'douyin', title: '我的测试作品', url: 'https://www.douyin.com/video/123', publishedAt: '2026-10-01T01:00:00Z', metrics: { views: 100, likes: 3 } })).status, 201);
    const posts = await env.store.read('posts');
    assert.equal(posts.length, 1);
    const snapshots = await env.store.read('snapshots');
    assert.equal(snapshots[0].postId, posts[0].id);
    assert.equal(snapshots[0].metrics.saves, null);
    assert.equal((await env.post('/api/posts', { platform: 'douyin', url: 'https://example.com', publishedAt: 'bad' })).status, 400);
  } finally { await env.close(); }
});

test('report download cannot traverse outside its directory', async () => {
  assert.equal(typeof web.createServer, 'function');
  const env = await setup();
  try {
    await env.store.saveReport('test-report', { value: '真实内容' }, '# 测试报告');
    assert.equal((await fetch(env.origin + '/api/reports/test-report')).status, 200);
    assert.notEqual((await fetch(env.origin + '/api/reports/%2e%2e%2fsecrets')).status, 200);
    const homepage = await fetch(env.origin + '/');
    assert.equal(homepage.status, 200);
    assert.match(await homepage.text(), /内容工作台/);
  } finally { await env.close(); }
});

test('concurrent acknowledged saves retain all personal material', async () => {
  const env = await setup();
  try {
    const responses = await Promise.all(Array.from({ length: 10 }, (_, i) => env.post('/api/notes', { text: '真实素材 ' + i })));
    assert.ok(responses.every(r => r.status === 201));
    assert.equal((await env.store.read('notes')).length, 10);
  } finally { await env.close(); }
});
