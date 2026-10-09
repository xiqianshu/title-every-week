import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, makeSources, itemId, normalizeItem } from '../src/model.mjs';
import { Store } from '../src/store.mjs';
import { Workflow } from '../src/pipeline.mjs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const research = await import('../src/research.mjs').catch(() => ({}));
const feeds = await import('../src/public-sources.mjs').catch(() => ({}));
const browserRead = await import('../src/browser-read.mjs').catch(() => ({}));
import { Providers } from '../src/providers.mjs';

test('upgrading legacy settings enables broad research while preserving saved personal data', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'creator-migration-'));
  try {
    const store = new Store(root); await store.init();
    const config = await store.read('config'); delete config.broadResearch;
    config.limits.maxSources = 10; config.keywords = ['自己的方向']; config.profile.voice = '自然表达'; config.enabled = false;
    await store.write('config',config); await store.write('secrets',{playwrightToken:'local-private'});
    await store.write('notes',[{id:'n1',text:'真实素材'}]); await store.write('items',[{id:'i1',title:'旧资料'}]);
    await store.saveReport('old-report',{},'旧报告');
    await store.init();
    const migrated=await store.read('config');
    assert.equal(migrated.broadResearch,true); assert.equal(migrated.limits.maxSources,12);
    assert.equal(migrated.enabled,false); assert.deepEqual(migrated.keywords,['自己的方向']); assert.equal(migrated.profile.voice,'自然表达');
    assert.deepEqual(await store.read('notes'),[{id:'n1',text:'真实素材'}]); assert.equal((await store.read('items'))[0].id,'i1');
    assert.equal((await store.read('secrets')).playwrightToken,'local-private');
    assert.equal(await readFile(path.join(root,'reports','old-report.md'),'utf8'),'旧报告');
    assert.deepEqual(await store.read('signals'),[]);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('a later browser batch failure preserves completed works and incremental progress', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'creator-batches-'));
  try {
    const store = new Store(root); await store.init(); await store.write('secrets',{playwrightToken:'local-private'});
    let calls=0; const progress=[];
    const provider = new Providers(path.resolve('.'),store,async (command,args) => {
      if (++calls > 1) throw new Error('第二批页面超时');
      await writeFile(args[args.indexOf('--output-last-message')+1],JSON.stringify({sources:[1,2,3].map(i=>({sourceId:'s'+i,status:i===1?'ok':'empty',message:''})),items:[{sourceId:'s1',title:'已取得作品',url:'https://www.xiaohongshu.com/search_result/abc?xsec_token=public',body:'实际页面',metrics:{likes:2},metricEvidence:'点赞 2'}]}));
      return {stdout:''};
    });
    const sources=[1,2,3,4].map(i=>({id:'s'+i,platform:'xiaohongshu',kind:'search',query:'AI测试'+i,limit:5}));
    const result=await provider.collect(sources,{collector:'playwright'},async value=>progress.push(value));
    assert.equal(calls,2); assert.equal(result.items.length,1); assert.equal(result.sources.length,4);
    assert.equal(result.sources[3].status,'error'); assert.equal(progress[0].itemCount,1); assert.equal(progress[1].completed,4);
    assert.equal(progress[1].items[0].title,'已取得作品');
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('XHS search result detail URLs identify the same work without accepting listing pages', () => {
  const detail = 'https://www.xiaohongshu.com/search_result/66abcdef0123456789abcdef?xsec_token=public&xsec_source=pc_search';
  assert.equal(itemId(detail, 'xiaohongshu'), itemId(detail.replace('/search_result/', '/explore/'), 'xiaohongshu'));
  for (const url of ['https://www.xiaohongshu.com/search_result?keyword=AI', 'https://www.xiaohongshu.com/search_result/', 'https://xhslink.com/explore/66abcdef0123456789abcdef']) assert.throws(() => itemId(url, 'xiaohongshu'));
  assert.throws(() => normalizeItem({ title: '另一个作品', url: detail.replace('66abcdef', '77abcdef') }, { platform: 'xiaohongshu', kind: 'published', url: detail }, new Date().toISOString()));
});

test('broad discovery and dynamic searches take priority over a full list of reference accounts', () => {
  const config = defaultConfig(); config.accounts = Array.from({ length: 6 }, (_, i) => ({ platform: 'douyin', url: 'https://www.douyin.com/user/ref' + i }));
  const sources = makeSources(config, [], { researchQueries: ['AI 视频实测', '低成本创作', '注意力管理'] });
  assert.ok(sources.some(s => s.kind === 'discovery' && s.platform === 'douyin'));
  assert.ok(sources.some(s => s.kind === 'discovery' && s.platform === 'xiaohongshu'));
  for (const platform of ['douyin', 'xiaohongshu']) assert.ok(sources.some(s => s.platform === platform && s.query === 'AI 视频实测'));
  assert.ok(sources.findIndex(s => s.kind === 'account') > sources.findIndex(s => s.query === 'AI 视频实测'));
  assert.ok(sources.length <= config.limits.maxSources);
});

test('public feed adapters preserve source rank, publication time and unknown quantities', () => {
  assert.equal(typeof feeds.parseFeed, 'function');
  const source = { id: 'bilibili', label: 'B站热门', kind: 'popular', endpoint: 'https://api.bilibili.com/x/web-interface/popular' };
  const rows = feeds.parseFeed(source, JSON.stringify({ code: 0, data: { list: [{ bvid: 'BV1test', title: 'AI 测试', pubdate: 1791504000, desc: '介绍', owner: { name: '作者' }, stat: { view: 100, like: 12 } }] } }), '2026-10-09T01:00:00Z');
  assert.equal(rows[0].url, 'https://www.bilibili.com/video/BV1test');
  assert.equal(rows[0].heat.rank, null, 'popular feed order is not a ranked chart');
  assert.equal(rows[0].metrics.views, 100);
  assert.equal(rows[0].metrics.saves, null);
  assert.equal(rows[0].publishedAt, new Date(1791504000000).toISOString());
  assert.throws(() => feeds.parseFeed(source, '{"code":-412}', '2026-10-09T01:00:00Z'));
});

test('one public source failure does not discard valid external evidence', async () => {
  assert.equal(typeof feeds.collectPublicSources, 'function');
  const result = await feeds.collectPublicSources(async source => {
    if (source.id !== 'v2ex') throw new Error('HTTP 403');
    return JSON.stringify([{ title: 'AI 实践问题', url: 'https://www.v2ex.com/t/123', replies: 20, created: 1791504000 }]);
  });
  assert.equal(result.signals.length, 1);
  assert.equal(result.sources.find(s => s.id === 'v2ex').status, 'ok');
  assert.ok(result.sources.some(s => s.status === 'error'));
});

test('research conclusions cannot invent references or label a single unlabeled post as trending', () => {
  assert.equal(typeof research.validateInsights, 'function');
  const bundle = { items: [{ id: 'i1', platform: 'douyin', title: 'AI 实测', url: 'https://www.douyin.com/video/123', author: 'A', metrics: { likes: null } }], signals: [] };
  const input = { summary: '资料不足', candidates: [{ title: 'AI 实测怎么做', pillar: 'AI实践', reason: '可亲自验证', angle: '一次真实测试', sourceIds: ['i1'], cautions: ['未取得互动量'] }] };
  const valid = research.validateInsights(input, bundle);
  assert.equal(valid.candidates[0].evidenceLevel, '待验证候选');
  assert.throws(() => research.validateInsights({ ...input, candidates: [{ ...input.candidates[0], sourceIds: ['invented'] }] }, bundle));
});

test('work URLs cannot be treated as different author profiles for multi-author evidence', () => {
  const items = [1,2].map(n => normalizeItem({ title:'同一作者作品',url:'https://www.douyin.com/video/'+n,author:'Same',authorUrl:'https://www.douyin.com/video/'+n,metrics:{likes:20},metricEvidence:'点赞 20' },{id:'s',platform:'douyin',kind:'search'},new Date().toISOString()));
  assert.ok(items.every(i => i.authorUrl === null));
  const result = research.validateInsights({summary:'候选',candidates:[{title:'方向',pillar:'AI实践',reason:'可实践',angle:'实测',sourceIds:items.map(i=>i.id),cautions:[]}]},{items,signals:[]});
  assert.equal(result.candidates[0].evidenceLevel,'待验证候选');
});

test('public link query parameters do not turn one author into multiple authors', () => {
  const items=[1,2].map(n=>normalizeItem({title:'作品',url:'https://www.xiaohongshu.com/explore/n'+n,author:'Same',authorUrl:'https://www.xiaohongshu.com/user/profile/abc?xsec_token='+n,metrics:{likes:20},metricEvidence:'点赞 20'},{id:'s',platform:'xiaohongshu',kind:'search'},new Date().toISOString()));
  const result=research.validateInsights({summary:'候选',candidates:[{title:'方向',pillar:'AI实践',reason:'原因',angle:'角度',sourceIds:items.map(i=>i.id),cautions:[]}]},{items,signals:[]});
  assert.equal(result.candidates[0].evidenceLevel,'待验证候选');
  assert.equal(research.summarizeAuthors(items).length,1);
});

test('account activity is a dated sample count and never invents total cadence or follower growth', () => {
  assert.equal(typeof research.summarizeAuthors, 'function');
  const items = [{ id: 'i1', platform: 'douyin', author: 'A', authorUrl: 'https://www.douyin.com/user/a', title: 'AI 实测', publishedAt: '2026-10-08T01:00:00Z' }, { id: 'i2', platform: 'douyin', author: 'A', authorUrl: 'https://www.douyin.com/user/a', title: '新的测试', publishedAt: null }];
  const [author] = research.summarizeAuthors(items, new Date('2026-10-09T01:00:00Z'));
  assert.equal(author.recent7d, 1); assert.equal(author.unknownDates, 1);
  assert.equal(author.followerGrowth, null);
  assert.match(author.limits, /样本/);
});

test('browser failure still produces conclusions from external evidence and reports missing platform coverage', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'creator-research-'));
  try {
    const store = new Store(root); await store.init();
    const signal = { id: 'e1', sourceId: 'v2ex', origin: 'V2EX 热门讨论', title: 'AI 工作流问题', url: 'https://www.v2ex.com/t/123', heat: { kind: 'hot_list', rank: 1 }, metrics: {}, collectedAt: new Date().toISOString() };
    let analyzed = false;
    const workflow = new Workflow(store, {
      publicResearch: async () => ({ sources: [{ id: 'v2ex', label: 'V2EX 热门讨论', status: 'ok', count: 1 }], signals: [signal] }),
      planResearch: async () => ({ queries: [{ query: 'AI 工作流', reason: '具体问题', sourceIds: ['e1'] }], summary: '跨来源研究' }),
      collect: async () => { throw new Error('浏览器未连接'); },
      analyze: async bundle => { analyzed = true; return { summary: '外部资料可形成候选，未验证抖音和小红书', candidates: [{ title: 'AI 工作流如何实测', pillar: 'AI实践', reason: '具体需求', angle: '真实测试', sourceIds: [bundle.signals[0].id], cautions: ['缺少两平台样本'] }] }; },
    });
    const job = await workflow.run('collect');
    assert.equal(job.status, 'partial'); assert.ok(analyzed);
    const report = await readFile(path.join(root, 'reports', job.reportId + '.md'), 'utf8');
    assert.match(report, /AI 工作流如何实测/); assert.match(report, /V2EX/); assert.match(report, /缺少|未取得/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the browser gateway exposes a fixed DOM read and rejects navigation to personal or off-platform pages', () => {
  assert.equal(typeof browserRead.checkBrowserCall, 'function');
  assert.doesNotThrow(() => browserRead.checkBrowserCall('browser_navigate', { url: 'https://www.xiaohongshu.com/search_result?keyword=AI' }));
  for (const [name,args] of [['browser_navigate', { url: 'https://example.com' }], ['browser_evaluate', { function: 'fetch("secret")' }], ['browser_tabs', { action: 'close' }], ['browser_navigate', { url: 'https://creator.douyin.com/' }]]) assert.throws(() => browserRead.checkBrowserCall(name,args));
  assert.match(browserRead.pageReadCode, /querySelectorAll/);
});

test('research plans cannot refer to absent evidence', () => {
  assert.throws(() => research.validateResearchPlan({ summary: '方向', queries: [{ query: 'AI', reason: '问题', sourceIds: ['fake'] }] }, []));
  assert.equal(research.validateResearchPlan({ summary: '探索', queries: [{ query: 'AI 实测', reason: '没有热点，探索真实需求', sourceIds: [] }] }, []).queries.length, 1);
});

test('stopping a task pauses automation and prevents later analysis or drafting', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'creator-stop-'));
  let release, task; const gate = new Promise(resolve => { release = resolve; }); let analyzed = 0;
  try {
    const store = new Store(root); await store.init(); const config = await store.read('config'); config.enabled = true; await store.write('config',config);
    const workflow = new Workflow(store, { collect: async () => { await gate; return { sources: [], items: [{ id: 'i1', platform: 'douyin', title: '资料', url: 'https://www.douyin.com/video/123', metrics: {}, collectedAt: new Date().toISOString() }] }; }, stop: () => release(), analyze: async () => { analyzed++; } });
    task = workflow.run('collect');
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(typeof workflow.stop, 'function');
    await workflow.stop(); const job = await task;
    assert.equal(job.stage, '本次任务已停止'); assert.equal(analyzed, 0);
    assert.equal((await store.read('config')).enabled, false);
  } finally { release(); await task?.catch(() => {}); await rm(root, { recursive: true, force: true }); }
});

test('stop during the final weekly generation cannot report success or continue to review', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'creator-stop-write-'));
  let release, started, task;
  const ready = new Promise(resolve => { started = resolve; }); const gate = new Promise(resolve => { release = resolve; });
  try {
    const store = new Store(root); await store.init();
    const workflow = new Workflow(store, { collect: async () => ({ sources: [], items: [{ id: 'i1', platform: 'douyin', title: '来源', url: 'https://www.douyin.com/video/123', metrics: {}, collectedAt: new Date().toISOString() }] }), generate: async bundle => {
      started(); await gate;
      return { summary: '候选', topics: ['AI实践','AI实践','日常生活','个人心得'].map((pillar,i) => ({ id:'t'+i,pillar,title:'选题',angle:'角度',reason:'原因',sourceIds:['i1'],factIds:[],missingMaterials:['待本人素材'],douyin:{title:'标题',cover:'封面',script:'待实践',caption:'待实践',shots:[]},xiaohongshu:{title:'标题',cover:'封面',pages:['待实践'],caption:'待实践'} })), nextQuestions:[] };
    }, stop: () => release() });
    task = workflow.run('weekly'); await ready; await workflow.stop();
    assert.equal((await task).stage, '本次任务已停止');
  } finally { release(); await task?.catch(() => {}); await rm(root,{recursive:true,force:true}); }
});
