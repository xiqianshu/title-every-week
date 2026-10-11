import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig, makeSources } from '../src/model.mjs';
import { Store } from '../src/store.mjs';
import { Providers } from '../src/providers.mjs';
import { Workflow, renderReport } from '../src/pipeline.mjs';
import { createServer } from '../src/server.mjs';
import * as browser from '../src/browser-read.mjs';
import { runInNewContext } from 'node:vm';
import { runProcess } from '../src/runtime.mjs';

async function temporaryStore(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'creator-pause-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Store(root); await store.init(); return store;
}
const pausedConfig = () => ({ ...defaultConfig(), pausedPlatforms: ['xiaohongshu'] });
const xhs = { id: 'x', platform: 'xiaohongshu', kind: 'search', query: 'AI', limit: 1 };
const dy = { id: 'd', platform: 'douyin', kind: 'search', query: 'AI', limit: 1 };

test('paused publications cannot enter review jobs or occupy active review slots', () => {
  const config = pausedConfig(); config.limits.maxSources = 1;
  const posts = [
    { id: 'x', platform: 'xiaohongshu', url: 'https://www.xiaohongshu.com/explore/abc', publishedAt: '2026-10-01T00:00:00Z' },
    { id: 'd', platform: 'douyin', url: 'https://www.douyin.com/video/123', publishedAt: '2026-10-01T00:00:00Z' },
  ];
  const sources = makeSources(config, posts, { reviewOnly: true, now: new Date('2026-10-11T00:00:00Z') });
  assert.deepEqual(sources.map(s => s.postId), ['d']);
  assert.ok(makeSources(config, posts).every(s => s.platform === 'douyin'));
});

for (const collector of ['playwright', 'opencli']) {
  test(collector + ' refuses directly supplied paused sources without launching anything', async t => {
    const store = await temporaryStore(t);
    const provider = new Providers(path.resolve('.'), store, async () => { assert.fail('Paused source launched a subprocess'); });
    provider.codex = async () => { assert.fail('Paused source launched a browser model'); };
    const result = await provider.collect([xhs], { ...pausedConfig(), collector });
    assert.deepEqual(result.items, []);
    assert.equal(result.sources[0].status, 'paused');
  });
}

test('browser navigation rejects a paused platform even with a valid public URL', () => {
  assert.throws(() => browser.checkBrowserCall('browser_navigate', { url: 'https://www.xiaohongshu.com/search_result?keyword=AI' }, ['douyin']), /暂停|允许/);
  assert.doesNotThrow(() => browser.checkBrowserCall('browser_navigate', { url: 'https://www.douyin.com/hot' }, ['douyin']));
  assert.throws(() => browser.checkBrowserCall('browser_read_page', {}, []), /暂停|允许/);
});

test('fixed readers do not access a paused page DOM or return its title', () => {
  assert.equal(typeof browser.scopePageCode, 'function');
  for (const code of [browser.pageReadCode, browser.currentPageCode, browser.mutePageCode]) {
    const context = { location: { hostname: 'www.xiaohongshu.com' } };
    Object.defineProperty(context, 'document', { get() { assert.fail('Read a paused page DOM'); } });
    const result = runInNewContext('(' + browser.scopePageCode(code, ['douyin']) + ')()', context);
    assert.match(result.error, /暂停|允许/);
    assert.equal(result.title, undefined);
  }
});

test('browser subprocess receives only the requested active platforms', async t => {
  const store = await temporaryStore(t); await store.write('config', pausedConfig());
  await store.write('secrets', { playwrightToken: 'fixture-token' });
  const provider = new Providers(path.resolve('.'), store, async (command, args, options) => {
    assert.deepEqual(JSON.parse(options.env.CREATOR_BROWSER_PLATFORMS), ['douyin']);
    const envVars = args.find(value => value.startsWith('mcp_servers.playwright.env_vars='));
    assert.match(envVars, /CREATOR_BROWSER_PLATFORMS/);
    await writeFile(args[args.indexOf('--output-last-message') + 1], '{}');
  });
  await provider.codex('fixture', 'collection', true, ['douyin', 'xiaohongshu']);
});

test('saving a new platform pause stops an in-flight job and disables its schedule', async t => {
  const store = await temporaryStore(t);
  await store.write('config', { ...defaultConfig(), pausedPlatforms: [], enabled: true });
  let started, release;
  const ready = new Promise(resolve => started = resolve);
  const gate = new Promise(resolve => release = resolve);
  t.after(() => release());
  const workflow = new Workflow(store, {
    collect: async () => { started(); await gate; return { sources: [], items: [] }; },
    stop: () => release(),
  });
  const server = createServer(workflow); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const task = workflow.run('collect'); await ready;
  const config = await store.read('config'); config.pausedPlatforms = ['xiaohongshu'];
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const response = await fetch(origin + '/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workflow-Request': '1', Origin: origin }, body: JSON.stringify({ config }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.stopped, true);
    const job = await task;
    assert.equal(job.status, 'failed');
    assert.deepEqual((await store.read('config')).pausedPlatforms, ['xiaohongshu']);
    assert.equal((await store.read('config')).enabled, false);
  } finally { release(); await task; }
});

test('new and legacy settings pause Xiaohongshu without removing existing data', async t => {
  assert.deepEqual(defaultConfig().pausedPlatforms, ['xiaohongshu']);
  const store = await temporaryStore(t);
  const config = await store.read('config'); delete config.pausedPlatforms; config.profile.voice = '我的表达';
  await store.write('config', config); await store.write('notes', [{ id: 'n-original', text: '真实素材' }]);
  await store.init();
  assert.deepEqual((await store.read('config')).pausedPlatforms, ['xiaohongshu']);
  assert.equal((await store.read('config')).profile.voice, '我的表达');
  assert.equal((await store.read('notes'))[0].text, '真实素材');
  await store.write('config', { ...config, pausedPlatforms: [] }); await store.init();
  assert.deepEqual((await store.read('config')).pausedPlatforms, []);
});

test('reports disclose paused coverage separately from collection errors', () => {
  const markdown = renderReport({ createdAt: '2026-10-11T00:00:00Z', status: 'success', pausedPlatforms: ['xiaohongshu'], collection: { sources: [], items: [] } });
  assert.match(markdown, /小红书.*暂停/);
  assert.match(markdown, /未.*采样|未.*访问/);
});

test('real MCP gateway rejects paused navigation before connecting to any browser', async () => {
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'browser_navigate', arguments: { url: 'https://www.xiaohongshu.com/explore' } } };
  const result = await runProcess(process.execPath, ['src/browser-bridge.mjs'], { cwd: path.resolve('.'), env: { CREATOR_BROWSER_PLATFORMS: '["douyin"]' }, input: JSON.stringify(request) + '\n', timeoutMs: 5000 });
  const reply = JSON.parse(result.stdout.trim());
  assert.equal(reply.error.code, -32602);
  assert.match(reply.error.message, /暂停/);
});

test('paused-platform review can still use manually entered metrics without browsing', async t => {
  const store = await temporaryStore(t);
  const now = new Date().toISOString();
  const post = { id: 'p-xhs', platform: 'xiaohongshu', title: '我的笔记', url: 'https://www.xiaohongshu.com/explore/abc', publishedAt: new Date(Date.now() - 10 * 86400000).toISOString() };
  await store.write('posts', [post]);
  await store.write('snapshots', [{ postId: post.id, itemId: 'manual', url: post.url, collectedAt: now, metrics: { likes: 10 }, origin: 'user_backend_entry' }]);
  const workflow = new Workflow(store, {
    collect: async () => assert.fail('Paused-platform review launched browsing'),
    generate: async (bundle, kind) => {
      assert.equal(kind, 'review'); assert.equal(bundle.reviews[0].snapshot.metrics.likes, 10);
      return { summary: '基于手动登记的数据复盘', findings: [], nextWeekAdvice: [] };
    },
  });
  const job = await workflow.run('review');
  assert.equal(job.status, 'success');
});
