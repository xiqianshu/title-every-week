import { createHash } from 'node:crypto';

export const METRICS = ['views', 'likes', 'comments', 'saves', 'shares', 'followers'];
const hosts = { douyin: ['www.douyin.com', 'douyin.com', 'creator.douyin.com'], xiaohongshu: ['www.xiaohongshu.com', 'xiaohongshu.com', 'xhslink.com'] };
export const digest = value => createHash('sha256').update(String(value)).digest('hex').slice(0, 20);

export function platformUrl(value, platform) {
  if (!Object.hasOwn(hosts, platform)) throw new Error('平台必须是抖音或小红书');
  let url;
  try { url = new URL(value); } catch { throw new Error('请填写完整的账号或作品网址'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts[platform].includes(url.hostname)) throw new Error('网址必须属于所选平台，且使用 HTTPS');
  return url;
}

export function itemId(url, platform) {
  const parsed = platformUrl(url, platform);
  const id = parsed.pathname.split('/').filter(Boolean).at(-1);
  if (!id) throw new Error('作品网址缺少作品标识');
  return platform + '-' + digest(id);
}

function observedNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  return null;
}

export function normalizeItem(raw, source, at) {
  if (!raw || typeof raw !== 'object') throw new Error('采集结果格式无效');
  const url = String(raw.url || (raw.aweme_id ? 'https://www.douyin.com/video/' + raw.aweme_id : '') || '');
  platformUrl(url, source.platform);
  const title = String(raw.title || raw.desc || '').trim().slice(0, 1000);
  if (!title) throw new Error('采集结果缺少实际标题');
  const metrics = {};
  const rawMetrics = raw.metrics || raw;
  for (const name of METRICS) {
    let value = observedNumber(rawMetrics[name]);
    if (name === 'views' && value === null) value = observedNumber(rawMetrics.plays);
    if (name === 'likes' && value === null) value = observedNumber(rawMetrics.digg_count);
    if (source.adapter === 'opencli' && value === 0) value = null;
    if (source.adapter !== 'opencli' && !raw.metricEvidence) value = null;
    metrics[name] = value;
  }
  return {
    id: itemId(url, source.platform), sourceId: source.id, platform: source.platform,
    title, url, body: String(raw.body || raw.content || raw.markdown || '').slice(0, 12000),
    author: raw.author == null ? null : String(raw.author).slice(0, 300),
    publishedAt: source.adapter === 'opencli' ? null : (raw.publishedAt || raw.published_at || null),
    collectedAt: at, metrics, metricEvidence: raw.metricEvidence || null,
    comments: (Array.isArray(raw.comments) ? raw.comments : Array.isArray(raw.top_comments) ? raw.top_comments : []).slice(0, 10).map(c => typeof c === 'string' ? c.slice(0, 1500) : String(c.text || c.content || '').slice(0, 1500)).filter(Boolean),
    postId: source.postId || null,
  };
}

export function makeSources(config, posts = []) {
  const sources = [];
  const add = input => {
    if (input.url) platformUrl(input.url, input.platform);
    const identity = input.url || input.query;
    sources.push({ ...input, id: 's-' + digest(input.platform + ':' + input.kind + ':' + identity), limit: Math.min(20, Math.max(1, config.limits?.perSource || 5)) });
  };
  for (const post of posts.slice(-20)) add({ platform: post.platform, kind: 'published', url: post.url, title: post.title, postId: post.id });
  for (const account of (config.accounts || []).slice(0, 6)) add({ platform: account.platform, kind: 'account', url: account.url, label: account.label || '' });
  for (const link of (config.links || []).slice(0, 6)) add({ platform: link.platform, kind: 'link', url: link.url, label: link.label || '' });
  for (const keyword of (config.keywords || []).slice(0, 3)) {
    const query = String(keyword).trim().slice(0, 80);
    if (query) for (const platform of ['douyin', 'xiaohongshu']) add({ platform, kind: 'search', query, url: null });
  }
  return [...new Map(sources.map(s => [s.id, s])).values()].slice(0, config.limits?.maxSources || 10);
}

export function validateConfig(config) {
  if (!['playwright', 'opencli'].includes(config.collector)) throw new Error('请选择采集方式');
  if (!Array.isArray(config.keywords) || config.keywords.length > 3) throw new Error('关键词最多三个');
  if (!Array.isArray(config.accounts) || config.accounts.length > 6) throw new Error('对标账号最多六个');
  if (!Array.isArray(config.links) || config.links.length > 6) throw new Error('参考作品最多六个');
  if (!Number.isInteger(config.scheduleHour) || config.scheduleHour < 0 || config.scheduleHour > 23) throw new Error('每日运行小时应为 0—23');
  if (!config.profile || typeof config.profile.voice !== 'string' || typeof config.profile.goal !== 'string') throw new Error('个人内容偏好无效');
  makeSources(config);
  return config;
}

export function reviewWindows(posts, snapshots, now = new Date()) {
  const output = [];
  for (const post of posts) {
    const start = Date.parse(post.publishedAt);
    if (!Number.isFinite(start)) continue;
    for (const [window, hours] of [['72h', 72], ['7d', 168]]) {
      const due = start + hours * 3600000;
      if (now.getTime() < due) continue;
      const candidates = snapshots.filter(s => s.postId === post.id && Date.parse(s.collectedAt) >= due && Date.parse(s.collectedAt) <= now.getTime()).sort((a, b) => Date.parse(a.collectedAt) - Date.parse(b.collectedAt));
      const snapshot = candidates[0] || null;
      const late = snapshot && Date.parse(snapshot.collectedAt) - due > 6 * 3600000;
      output.push({ postId: post.id, title: post.title || '', platform: post.platform, url: post.url, window, dueAt: new Date(due).toISOString(), status: snapshot ? (late ? 'delayed' : 'observed') : 'awaiting_data', snapshot });
    }
  }
  return output;
}

export function defaultConfig() {
  return {
    collector: 'playwright', enabled: false, scheduleHour: 9,
    keywords: ['AI 实际使用', 'AI 个人成长'], accounts: [],
    links: [
      { platform: 'douyin', url: 'https://www.douyin.com/video/7690817035621661111', label: '用户指定对标的置顶作品' },
      { platform: 'douyin', url: 'https://www.douyin.com/video/7692084992523930880', label: '用户指定对标的置顶作品' },
      { platform: 'douyin', url: 'https://www.douyin.com/video/7683154176955731234', label: '用户指定对标的置顶作品' },
    ],
    limits: { perSource: 5, maxSources: 10 },
    profile: {
      goal: '长期建立个人 IP，先找到受众和真实需求，为以后自己的品牌探索机会。',
      voice: '自然、具体、诚实，像与朋友分享；避免专家口吻、空泛鸡汤与收益夸张。',
      pillars: ['AI 实践', '日常生活', '个人心得'],
      boundaries: '不做桌面账号，不包装品牌出海专家；不编造经验、实测、收入或生活。没有本人素材的日常与实践结果须标待补。工作状态不默认公开。',
    },
  };
}
