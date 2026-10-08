import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { makeSources, reviewWindows } from './model.mjs';
import { validatePack } from './prompts.mjs';
import { safeMessage } from './runtime.mjs';
import { scheduleDue, shanghaiDate } from './schedule.mjs';

const label = { douyin: '抖音', xiaohongshu: '小红书' };
const metricNames = { views: '播放／阅读', likes: '赞', comments: '评论', saves: '收藏', shares: '分享', followers: '关注' };

export function renderReport(report) {
  const lines = ['# 内容工作流报告', '', '生成时间：' + new Date(report.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) + '（北京时间）', '', '任务状态：' + ({ success: '完成', partial: '部分来源未取得', failed: '本次未完成' }[report.status] || report.status), ''];
  if (report.error) lines.push('原因：' + report.error, '');
  lines.push('## 来源读取', '');
  for (const source of report.collection?.sources || []) lines.push('- ' + label[source.platform] + '：' + (source.label || source.query || source.url || '来源') + '；' + source.status + '；' + (source.count || 0) + ' 条' + (source.message ? '；' + source.message : ''));
  const pack = report.pack;
  if (pack?.topics) {
    lines.push('', '## 本周四个选题', '', pack.summary, '');
    for (const topic of pack.topics) {
      lines.push('### ' + topic.id + ' · ' + topic.title, '', '栏目：' + topic.pillar, '角度：' + topic.angle, '依据：' + topic.reason, '');
      lines.push('待补素材：' + (topic.missingMaterials.length ? topic.missingMaterials.join('；') : '请本人确认个人表达与事实后制作发布'), '', '抖音标题：' + topic.douyin.title, '封面：' + topic.douyin.cover, '', topic.douyin.script, '', '镜头：' + topic.douyin.shots.join('；'), '发布正文：' + topic.douyin.caption, '', '小红书标题：' + topic.xiaohongshu.title, '封面：' + topic.xiaohongshu.cover, '');
      topic.xiaohongshu.pages.forEach((page, i) => lines.push('第 ' + (i + 1) + ' 页：' + page, ''));
      lines.push('发布正文：' + topic.xiaohongshu.caption, '');
      for (const id of topic.sourceIds) { const item = report.evidence.find(i => i.id === id); if (item) lines.push('来源：' + item.title + ' ' + item.url + '（读取：' + item.collectedAt + '）'); }
      lines.push('');
    }
  }
  if (report.review) {
    lines.push('## 发布复盘', '', report.review.summary, '');
    for (const finding of report.review.findings || []) lines.push('- ' + finding.observation, '  数据局限：' + finding.limits, '  下次实验：' + finding.nextExperiment, '');
    lines.push(...(report.review.nextWeekAdvice || []).map(a => '- ' + a), '');
  }
  if (report.windows?.length) {
    lines.push('## 实际观察窗口', '');
    for (const entry of report.windows) {
      lines.push('- ' + label[entry.platform] + ' ' + entry.title + ' · ' + entry.window + '：' + ({ observed: '已观察', delayed: '延迟观察，不作准时窗口比较', awaiting_data: '到期但未取得数据' }[entry.status]), entry.url);
      if (entry.snapshot) lines.push('  读取时间：' + entry.snapshot.collectedAt + '；' + Object.entries(metricNames).map(([key, title]) => title + ' ' + (entry.snapshot.metrics[key] ?? '未取得')).join('，'));
    }
  }
  if (report.evidence?.length) {
    lines.push('', '## 已取得的资料', '');
    for (const item of report.evidence) lines.push('- ' + label[item.platform] + ' · ' + item.title, '  ' + item.url, '  采集时间：' + item.collectedAt, '  ' + Object.entries(metricNames).map(([key, title]) => title + ' ' + (item.metrics[key] ?? '未取得')).join('，'), item.body ? '  页面内容：' + item.body : '', '');
  }
  lines.push('', '稿件中的个人经历与实测结果需要本人确认。未取得的指标留空，不代表零。');
  return lines.join('\n');
}

export class Workflow {
  constructor(store, providers, notify = async () => {}) { this.store = store; this.providers = providers; this.notify = notify; this.busy = false; this.ticking = false; }
  async status() {
    const [config, jobs, notes, posts, items, state, secrets] = await Promise.all(['config', 'jobs', 'notes', 'posts', 'items', 'state', 'secrets'].map(n => this.store.read(n)));
    return { config, jobs: jobs.slice(-20).reverse(), notes, posts, itemCount: items.length, state, busy: this.busy, playwrightTokenSaved: Boolean(secrets.playwrightToken), browserConfigured: config.collector === 'opencli' || Boolean(secrets.playwrightToken) };
  }
  async updateJob(job) {
    await this.store.update('jobs', jobs => {
      const index = jobs.findIndex(j => j.id === job.id);
      if (index >= 0) jobs[index] = { ...job }; else jobs.push({ ...job });
      return jobs.slice(-50);
    });
  }
  async run(kind) {
    if (!['collect', 'weekly', 'review', 'daily'].includes(kind)) throw new Error('无效的任务类型');
    if (this.busy) throw new Error('已有任务正在运行，请查看当前任务进度');
    this.busy = true;
    let release;
    const job = { id: 'job-' + Date.now() + '-' + randomUUID().slice(0, 8), kind, status: 'running', stage: '准备任务', createdAt: new Date().toISOString(), reportId: null };
    let collection = { sources: [], items: [] }, bundle, report;
    try {
      release = await this.store.lock();
      await this.updateJob(job);
      const [config, posts] = await Promise.all([this.store.read('config'), this.store.read('posts')]);
      const sourceState = await this.store.read('state');
      const sources = makeSources(config, posts, { snapshots: await this.store.read('snapshots'), attempts: sourceState.sourceAttempts, reviewOnly: kind === 'review' });
      const selected = kind === 'review' ? sources.filter(s => s.kind === 'published') : sources;
      await this.store.update('state', value => ({ ...value, sourceAttempts: { ...value.sourceAttempts, ...Object.fromEntries(selected.filter(s => s.postId).map(s => [s.postId, new Date().toISOString()])) } }));
      job.stage = '正在读取两平台页面'; await this.updateJob(job);
      if (selected.length) collection = await this.providers.collect(selected, config);
      if (!collection.items.length && kind !== 'review') throw new Error('本次没有取得有效资料：' + collection.sources.map(s => label[s.platform] + ' ' + (s.message || s.status)).join('；'));
      const existing = await this.store.read('items');
      const merged = new Map(existing.map(i => [i.id, i]));
      for (const item of collection.items) merged.set(item.id, item);
      await this.store.write('items', [...merged.values()].slice(-500));
      const observations = collection.items.map(i => ({ itemId: i.id, postId: i.postId, collectedAt: i.collectedAt, metrics: i.metrics, url: i.url }));
      const snapshots = await this.store.update('snapshots', values => [...values, ...observations].slice(-10000));
      const state = await this.store.read('state');
      let previousReview = null;
      if (state.lastReviewId) { try { previousReview = JSON.parse(await readFile(path.join(this.store.root, 'reports', state.lastReviewId + '.json'), 'utf8')).review; } catch {} }
      bundle = { profile: config.profile, notes: (await this.store.read('notes')).slice(-30), items: collection.items.slice(0, 50), reviews: reviewWindows(posts, snapshots), previousReview };
      let pack = null, review = null;
      if (kind === 'weekly') { job.stage = '正在按个人偏好生成四个选题和两平台稿件'; await this.updateJob(job); pack = validatePack(await this.providers.generate(bundle, 'weekly'), bundle, 'weekly'); }
      if (['weekly', 'daily', 'review'].includes(kind)) {
        job.stage = '正在整理发布复盘'; await this.updateJob(job);
        if (bundle.reviews.some(r => r.snapshot)) review = validatePack(await this.providers.generate(bundle, 'review'), bundle, 'review');
        else review = { summary: posts.length ? '尚无可用于 72 小时或 7 天复盘的真实指标快照。' : '尚未登记已发布内容。首次发布后在工作台记录链接和时间，即可开始自动跟踪。', findings: [], nextWeekAdvice: posts.length ? ['等待观察窗口到期；公开页面未提供的指标可以在发布记录中补充。'] : ['登记第一篇真实发布内容。'] };
      }
      job.status = collection.sources.some(s => ['blocked', 'error'].includes(s.status)) ? 'partial' : 'success';
      report = { id: job.id, kind, createdAt: job.createdAt, status: job.status, collection, evidence: collection.items, pack, review, windows: bundle.reviews };
      await this.store.saveReport(job.id, report, renderReport(report));
      job.reportId = job.id;
      state.lastCollectionId = job.id;
      if (pack) { state.lastWeekly = shanghaiDate().day; state.lastWeeklyId = job.id; }
      if (review) state.lastReviewId = job.id;
      await this.store.write('state', state);
      job.stage = pack ? '选题包已生成' : review ? '复盘已保存' : '资料已保存';
    } catch (error) {
      if (!release) throw error;
      job.status = 'failed'; job.stage = '本次任务未完成'; job.error = safeMessage(error);
      report = { id: job.id, kind, createdAt: job.createdAt, status: 'failed', collection, evidence: collection.items, error: job.error };
      await this.store.saveReport(job.id, report, renderReport(report));
      job.reportId = job.id;
    } finally {
      if (release) {
        job.finishedAt = new Date().toISOString();
        try { await this.updateJob(job); } finally { await release(); this.busy = false; }
      } else this.busy = false;
    }
    try { await this.notify('内容工作台', job.status === 'failed' ? '本次任务需要处理，请打开工作台查看原因' : '新的资料或选题报告已保存，请打开工作台查看'); } catch { job.notificationFailed = true; await this.updateJob(job); }
    return job;
  }
  async tick(now = new Date()) {
    if (this.busy || this.ticking) return null;
    this.ticking = true;
    try {
      const [config, state] = await Promise.all([this.store.read('config'), this.store.read('state')]);
      const due = scheduleDue(config, state, now);
      if (!due) return null;
      state.lastDaily = due.day;
      await this.store.write('state', state);
      return await this.run(due.kind);
    } finally { this.ticking = false; }
  }
}
