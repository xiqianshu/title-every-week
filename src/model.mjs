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
  const pattern = platform === 'douyin' ? /^\/video\/[A-Za-z0-9_-]+\/?$/ : /^\/(?:explore|discovery\/item|search_result|note)\/[A-Za-z0-9_-]+\/?$/;
  if (parsed.hostname === 'xhslink.com') throw new Error('请使用展开后的作品详情网址，短链接不是作品标识');
  if (!pattern.test(parsed.pathname)) throw new Error('请使用作品详情页的完整网址，不能用账号页、搜索页或短链接代替作品');
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
  if (['published', 'link'].includes(source.kind) && itemId(url, source.platform) !== itemId(source.url, source.platform)) throw new Error('读取的作品与指定作品不一致，未写入复盘数据');
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
    if (name === 'followers' && !/新增关注|净增关注|新增粉丝/.test(raw.metricEvidence || '')) value = null;
    metrics[name] = value;
  }
  return {
    id: itemId(url, source.platform), sourceId: source.id, platform: source.platform,
    title, url, body: String(raw.body || raw.content || raw.markdown || '').slice(0, 12000),
    author: raw.author == null ? null : String(raw.author).slice(0, 300),
    authorUrl: (() => { try { const parsed = platformUrl(raw.authorUrl || raw.author_url, source.platform); const pattern = source.platform === 'douyin' ? /^\/user\/[A-Za-z0-9_-]+\/?$/ : /^\/user\/profile\/[A-Za-z0-9_-]+\/?$/; return pattern.test(parsed.pathname) ? parsed.href : null; } catch { return null; } })(),
    sourceKind: source.kind, researchQuery: source.query || null,
    publishedAt: source.adapter === 'opencli' ? null : (raw.publishedAt || raw.published_at || null),
    collectedAt: at, metrics, metricEvidence: raw.metricEvidence || null,
    comments: (Array.isArray(raw.comments) ? raw.comments : Array.isArray(raw.top_comments) ? raw.top_comments : []).slice(0, 10).map(c => typeof c === 'string' ? c.slice(0, 1500) : String(c.text || c.content || '').slice(0, 1500)).filter(Boolean),
    postId: source.postId || null,
  };
}

export function makeSources(config, posts = [], { now = new Date(), snapshots = [], attempts = {}, reviewOnly = false, researchQueries = [] } = {}) {
  const sources = [];
  const add = input => {
    if (input.url) platformUrl(input.url, input.platform);
    const identity = input.url || input.query;
    sources.push({ ...input, id: 's-' + digest(input.platform + ':' + input.kind + ':' + identity), limit: input.kind === 'published' ? 1 : Math.min(5, Math.max(1, config.limits?.perSource || 5)) });
  };
  const pending = new Set(reviewWindows(posts, snapshots, now).filter(r => r.status === 'awaiting_data').map(r => r.postId));
  const queued = posts.filter(p => pending.has(p.id)).sort((a, b) => (Date.parse(attempts[a.id] || '') || 0) - (Date.parse(attempts[b.id] || '') || 0));
  const max = config.limits?.maxSources || 12;
  const researchBudget = config.broadResearch !== false ? 8 : 4;
  const ownBudget = reviewOnly ? max : Math.min(4, Math.max(0, max - researchBudget));
  for (const post of queued.slice(0, ownBudget)) add({ platform: post.platform, kind: 'published', url: post.url, title: post.title, postId: post.id });
  if (reviewOnly) return sources;
  const own = sources.splice(0);
  const day = Math.floor(now.getTime() / 86400000);
  if (config.broadResearch !== false) {
    add({ platform: 'douyin', kind: 'discovery', url: 'https://www.douyin.com/hot', label: '平台热点入口（跨账号发现）' });
    add({ platform: 'xiaohongshu', kind: 'discovery', url: 'https://www.xiaohongshu.com/explore', label: '发现页（个性化推荐，不视为全站榜单）' });
  }
  const ai = ['AI 视频实测', 'AI 搜索 信息核实', 'AI 学习 工作流', 'AI 图片 创作', 'AI 工具 踩坑'];
  const life = ['低成本 生活 记录', '注意力管理 手机', '普通人 自媒体 开始', '个人成长 真实记录', '学习习惯 实践'];
  const custom = (config.keywords || []).filter(k => String(k).trim());
  const fallback = config.broadResearch === false ? custom : [custom[day % (custom.length || 1)] || ai[day % ai.length], ai[(day + 1) % ai.length], life[day % life.length]];
  const queries = [...new Set([...researchQueries, ...fallback])].slice(0, 3);
  for (const keyword of queries) {
    const query = String(keyword).trim().slice(0, 80);
    if (query) for (const platform of ['douyin', 'xiaohongshu']) add({ platform, kind: 'search', query, url: null });
  }
  const references = [...(config.accounts || []).map(a => ({ ...a, kind: 'account' })), ...(config.links || []).map(l => ({ ...l, kind: 'link' }))];
  const offset = references.length ? day % references.length : 0;
  for (const ref of [...references.slice(offset), ...references.slice(0, offset)]) add(ref);
  const unique = [...new Map(sources.map(s => [s.id, s])).values()];
  return [...own, ...unique].slice(0, max);
}

export function validateConfig(config) {
  if (!config || typeof config !== 'object' || typeof config.enabled !== 'boolean') throw new Error('自动运行设置无效');
  if (!['playwright', 'opencli'].includes(config.collector)) throw new Error('请选择采集方式');
  if (!Array.isArray(config.keywords) || config.keywords.length > 8) throw new Error('补充关键词最多八个');
  if (config.broadResearch != null && typeof config.broadResearch !== 'boolean') throw new Error('广泛研究开关无效');
  if (!Array.isArray(config.accounts) || config.accounts.length > 6) throw new Error('对标账号最多六个');
  if (!Array.isArray(config.links) || config.links.length > 6) throw new Error('参考作品最多六个');
  if (!Number.isInteger(config.scheduleHour) || config.scheduleHour < 0 || config.scheduleHour > 23) throw new Error('每日运行小时应为 0—23');
  if (!config.profile || typeof config.profile.voice !== 'string' || typeof config.profile.goal !== 'string') throw new Error('个人内容偏好无效');
  for (const key of ['voice', 'goal', 'boundaries']) if (typeof config.profile[key] !== 'string' || config.profile[key].length > 3000) throw new Error('个人内容偏好每项最多 3000 字');
  if (config.keywords.some(k => typeof k !== 'string' || k.length > 80)) throw new Error('每个关键词最多 80 字');
  if (!Number.isInteger(config.limits?.perSource) || config.limits.perSource < 1 || config.limits.perSource > 5 || !Number.isInteger(config.limits?.maxSources) || config.limits.maxSources < 1 || config.limits.maxSources > 16) throw new Error('每个来源最多五条，每次最多十六个浏览器来源');
  for (const link of config.links) itemId(link.url, link.platform);
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
      const candidates = snapshots.filter(s => s.postId === post.id && Object.values(s.metrics || {}).some(v => v != null) && Date.parse(s.collectedAt) >= due && Date.parse(s.collectedAt) <= now.getTime()).sort((a, b) => Date.parse(a.collectedAt) - Date.parse(b.collectedAt));
      const snapshot = candidates[0] || null;
      const late = snapshot && Date.parse(snapshot.collectedAt) - due > 6 * 3600000;
      output.push({ postId: post.id, title: post.title || '', platform: post.platform, url: post.url, window, dueAt: new Date(due).toISOString(), status: snapshot ? (late ? 'delayed' : 'observed') : 'awaiting_data', snapshot });
    }
  }
  return output;
}

export function defaultConfig() {
  return {
    collector: 'playwright', enabled: false, scheduleHour: 9, broadResearch: true,
    keywords: ['AI 实际使用', 'AI 个人成长'], accounts: [],
    links: [
      { platform: 'douyin', url: 'https://www.douyin.com/video/7690817035621661111', label: '用户指定对标的置顶作品' },
      { platform: 'douyin', url: 'https://www.douyin.com/video/7692084992523930880', label: '用户指定对标的置顶作品' },
      { platform: 'douyin', url: 'https://www.douyin.com/video/7683154176955731234', label: '用户指定对标的置顶作品' },
    ],
    limits: { perSource: 5, maxSources: 12 },
    profile: {
      goal: '长期建立个人 IP，先找到受众和真实需求，为以后自己的品牌探索机会。',
      voice: '自然、具体、诚实，像与朋友分享；避免专家口吻、空泛鸡汤与收益夸张。',
      pillars: ['AI 实践', '日常生活', '个人心得'],
      boundaries: '不做桌面账号，不包装品牌出海专家；不编造经验、实测、收入或生活。没有本人素材的日常与实践结果须标待补。工作状态不默认公开。',
    },
  };
}
