import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const model = await import('../src/model.mjs').catch(() => ({}));
const storage = await import('../src/store.mjs').catch(() => ({}));
const source = { id: 's1', platform: 'xiaohongshu', kind: 'search', query: 'AI 实践', url: null };

test('missing metrics and ID-derived publication dates remain unknown', () => {
  assert.equal(typeof model.normalizeItem, 'function', 'normalizeItem is not implemented');
  const item = model.normalizeItem({ title: '测试资料', url: 'https://www.xiaohongshu.com/explore/abc?xsec_token=public', likes: 0, published_at: '2026-10-01' }, { ...source, adapter: 'opencli', command: 'search' }, '2026-10-08T01:00:00Z');
  assert.equal(item.metrics.likes, null);
  assert.equal(item.metrics.views, null);
  assert.equal(item.publishedAt, null);
  assert.equal(item.url, 'https://www.xiaohongshu.com/explore/abc?xsec_token=public');
});

test('explicit observed zero is retained and URL tokens do not change identity', () => {
  assert.equal(typeof model.normalizeItem, 'function');
  const raw = { title: '测试', url: 'https://www.xiaohongshu.com/explore/abc?xsec_token=one', metrics: { likes: 0 }, metricEvidence: '页面明确显示赞 0' };
  const a = model.normalizeItem(raw, source, '2026-10-08T01:00:00Z');
  const b = model.normalizeItem({ ...raw, url: raw.url.replace('one', 'two') }, source, '2026-10-09T01:00:00Z');
  assert.equal(a.id, b.id);
  assert.equal(a.metrics.likes, 0);
});

test('collector cannot save off-platform or credential-bearing links', () => {
  assert.equal(typeof model.normalizeItem, 'function');
  for (const url of ['http://127.0.0.1/secret', 'https://www.douyin.com.evil.test/video/123', 'https://user:pass@www.xiaohongshu.com/explore/abc']) {
    assert.throws(() => model.normalizeItem({ title: '测试', url }, source, '2026-10-08T01:00:00Z'));
  }
});

test('review identifies delayed observations and keeps missing view counts unknown', () => {
  assert.equal(typeof model.reviewWindows, 'function');
  const posts = [{ id: 'p1', platform: 'douyin', url: 'https://www.douyin.com/video/123', publishedAt: '2026-10-01T01:00:00Z' }];
  const snapshots = [{ postId: 'p1', collectedAt: '2026-10-05T01:00:00Z', metrics: { likes: 12, views: null } }];
  const reviews = model.reviewWindows(posts, snapshots, new Date('2026-10-08T01:00:00Z'));
  assert.equal(reviews.length, 2);
  assert.equal(reviews[0].window, '72h');
  assert.equal(reviews[0].status, 'delayed');
  assert.equal(reviews[0].snapshot.metrics.views, null);
  assert.equal(reviews[1].status, 'awaiting_data');
});

test('source requests preserve the configured account URL and exclude arbitrary hosts', () => {
  assert.equal(typeof model.makeSources, 'function');
  const config = { keywords: ['AI 实践'], accounts: [{ platform: 'douyin', url: 'https://www.douyin.com/user/MS4wLjABAAAAtest', label: '对标' }], limits: { perSource: 5 } };
  const requests = model.makeSources(config, []);
  assert.ok(requests.some(r => r.kind === 'account' && r.url === config.accounts[0].url));
  assert.ok(requests.some(r => r.platform === 'xiaohongshu' && r.query === 'AI 实践'));
  assert.throws(() => model.makeSources({ ...config, accounts: [{ platform: 'douyin', url: 'https://example.com' }] }, []));
});

test('initialization preserves existing personal configuration and writes private data', async () => {
  assert.equal(typeof storage.Store, 'function', 'Store is not implemented');
  const root = await mkdtemp(path.join(tmpdir(), 'creator-store-'));
  try {
    const store = new storage.Store(root);
    await store.init();
    const config = await store.read('config');
    config.profile.voice = '我自己的表达';
    await store.write('config', config);
    await store.init();
    assert.equal((await store.read('config')).profile.voice, '我自己的表达');
    assert.ok(JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8')));
    await assert.rejects(store.read('../escape'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
