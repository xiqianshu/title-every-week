import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
const pipeline = await import('../src/pipeline.mjs').catch(() => ({}));
const schedule = await import('../src/schedule.mjs').catch(() => ({}));

function weekly(bundle) {
  return { summary: '测试输出', topics: ['AI实践', 'AI实践', '日常生活', '个人心得'].map((pillar, i) => ({ id: 'W0' + (i + 1), pillar, title: '测试题', angle: '测试角度', reason: '测试依据', sourceIds: [bundle.items[0].id], factIds: [], missingMaterials: ['补本人素材'], douyin: { title: '标题', cover: '封面', script: '脚本', caption: '正文', shots: [] }, xiaohongshu: { title: '标题', cover: '封面', pages: ['一页'], caption: '正文' } })), nextQuestions: [] };
}
async function setup(provider) {
  const root = await mkdtemp(path.join(tmpdir(), 'creator-workflow-test-'));
  const store = new Store(root); await store.init();
  return { root, store, workflow: new pipeline.Workflow(store, provider, async () => {}) };
}
const collection = { items: [{ id: 'i1', sourceId: 's1', platform: 'douyin', title: '测试来源', url: 'https://www.douyin.com/video/123', body: '测试资料', collectedAt: '2026-10-08T01:00:00Z', metrics: { likes: 12, views: null }, postId: null }], sources: [{ id: 's1', platform: 'douyin', status: 'ok', count: 1 }, { id: 's2', platform: 'xiaohongshu', status: 'blocked', message: '需要登录', count: 0 }] };

test('partial collection produces a sourced pack with missing-platform status', async () => {
  assert.equal(typeof pipeline.Workflow, 'function');
  const env = await setup({ collect: async () => structuredClone(collection), generate: async bundle => weekly(bundle) });
  try {
    const job = await env.workflow.run('weekly');
    assert.equal(job.status, 'partial');
    const report = JSON.parse(await readFile(path.join(env.root, 'reports', job.reportId + '.json'), 'utf8'));
    assert.equal(report.pack.topics.length, 4);
    assert.equal(report.collection.sources[1].status, 'blocked');
    assert.equal((await env.store.read('snapshots')).length, 1);
  } finally { await rm(env.root, { recursive: true, force: true }); }
});

test('total collection failure never calls the writer and preserves the previous pack', async () => {
  assert.equal(typeof pipeline.Workflow, 'function');
  let generated = 0;
  const env = await setup({ collect: async () => ({ items: [], sources: [{ platform: 'douyin', status: 'blocked', message: '需要验证' }] }), generate: async () => { generated++; } });
  try {
    await env.store.write('state', { lastDaily: null, lastWeekly: 'previous' });
    const job = await env.workflow.run('weekly');
    assert.equal(job.status, 'failed');
    assert.equal(generated, 0);
    assert.equal((await env.store.read('state')).lastWeekly, 'previous');
    await env.store.lock().then(release => release());
  } finally { await rm(env.root, { recursive: true, force: true }); }
});

test('successive observations deduplicate content while preserving metric history', async () => {
  assert.equal(typeof pipeline.Workflow, 'function');
  const env = await setup({ collect: async () => structuredClone(collection), generate: async () => {} });
  try {
    await env.workflow.run('collect'); await env.workflow.run('collect');
    assert.equal((await env.store.read('items')).length, 1);
    assert.equal((await env.store.read('snapshots')).length, 2);
  } finally { await rm(env.root, { recursive: true, force: true }); }
});

test('concurrent tasks cannot write overlapping reports or data', async () => {
  assert.equal(typeof pipeline.Workflow, 'function');
  let unblock;
  const gate = new Promise(resolve => { unblock = resolve; });
  const env = await setup({ collect: async () => { await gate; return structuredClone(collection); }, generate: async () => {} });
  try {
    const first = env.workflow.run('collect');
    await new Promise(resolve => setTimeout(resolve, 20));
    await assert.rejects(env.workflow.run('collect'), /任务/);
    unblock(); await first;
  } finally { unblock(); await rm(env.root, { recursive: true, force: true }); }
});

test('Shanghai schedule catches up once and does not replay missed days', () => {
  assert.equal(typeof schedule.scheduleDue, 'function');
  const config = { enabled: true, scheduleHour: 9 };
  assert.equal(schedule.scheduleDue(config, { lastDaily: '2026-10-01', lastWeekly: '2026-10-01' }, new Date('2026-10-08T08:00:00Z')).kind, 'daily');
  assert.equal(schedule.scheduleDue(config, { lastDaily: '2026-10-08', lastWeekly: '2026-10-01' }, new Date('2026-10-08T08:00:00Z')), null);
  assert.equal(schedule.scheduleDue(config, {}, new Date('2026-10-08T00:00:00Z')), null);
  assert.equal(schedule.scheduleDue(config, { lastDaily: '2026-10-08', lastWeekly: '2026-10-01' }, new Date('2026-10-12T01:00:00Z')).kind, 'weekly');
});

test('automated failure is recorded once per day and can be manually retried', async () => {
  assert.equal(typeof pipeline.Workflow, 'function');
  let calls = 0;
  const env = await setup({ collect: async () => { calls++; throw new Error('需要连接浏览器'); }, generate: async () => {} });
  try {
    const config = await env.store.read('config'); config.enabled = true; await env.store.write('config', config);
    await env.workflow.tick(new Date('2026-10-08T08:00:00Z'));
    await env.workflow.tick(new Date('2026-10-08T08:10:00Z'));
    assert.equal(calls, 1);
    await env.workflow.run('collect');
    assert.equal(calls, 2);
  } finally { await rm(env.root, { recursive: true, force: true }); }
});
