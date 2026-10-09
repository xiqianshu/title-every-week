// Endpoint shapes and Baidu/GitHub selectors adapted from NewsNow (MIT).
// See THIRD_PARTY.md and licenses/NewsNow-MIT.txt for provenance.
import { digest } from './model.mjs';
import { runProcess, safeMessage } from './runtime.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const PUBLIC_SOURCES = [
  { id: 'douyin-hot', label: '抖音公开热点榜', kind: 'hot_list', endpoint: 'https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1' },
  { id: 'baidu', label: '百度实时热搜', kind: 'hot_list', endpoint: 'https://top.baidu.com/board?tab=realtime' },
  { id: 'bilibili', label: 'B站热门视频', kind: 'popular', endpoint: 'https://api.bilibili.com/x/web-interface/popular?ps=30&pn=1' },
  { id: 'v2ex', label: 'V2EX 热门讨论', kind: 'popular', endpoint: 'https://www.v2ex.com/api/topics/hot.json' },
  { id: 'sspai', label: '少数派热门文章', kind: 'popular', endpoint: 'https://sspai.com/api/v1/article/tag/page/get?limit=30&offset=0&tag=%E7%83%AD%E9%97%A8%E6%96%87%E7%AB%A0&released=false' },
  { id: 'github', label: 'GitHub 当日趋势项目', kind: 'hot_list', endpoint: 'https://github.com/trending?since=daily' },
];
const number = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
const date = value => { const d = typeof value === 'number' ? new Date(value * 1000) : new Date(value); return value != null && Number.isFinite(d.getTime()) ? d.toISOString() : null; };
const text = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const hosts = { 'douyin-hot': ['www.douyin.com'], baidu: ['www.baidu.com', 'm.baidu.com', 'baidu.com'], bilibili: ['www.bilibili.com'], v2ex: ['www.v2ex.com', 'v2ex.com'], sspai: ['sspai.com'], github: ['github.com'] };

export function parseFeed(source, body, at) {
  let rows;
  if (source.id === 'github') {
    rows = [...body.matchAll(/<article\b[^>]*class="[^"]*Box-row[^"]*"[^>]*>([\s\S]*?)<\/article>/g)].map(match => {
      const block = match[1], heading = block.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/)?.[1] || '';
      const href = heading.match(/href="(\/[^"?#]+\/[^"?#]+)"/)?.[1];
      return { title: text(heading), url: href ? 'https://github.com' + href : '', summary: text(block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/)?.[1]), heatLabel: 'GitHub 当日趋势榜位置；不是自媒体账号热度' };
    });
  } else if (source.id === 'baidu') {
    const data = JSON.parse(body.match(/<!--s-data:([\s\S]*?)-->/)?.[1] || '{}');
    if (!Array.isArray(data.data?.cards?.[0]?.content)) throw new Error('百度榜单结构未取得');
    rows = data.data.cards[0].content.filter(r => !r.isTop).map(r => ({ title: r.word, url: r.rawUrl, summary: r.desc }));
  } else {
    const data = JSON.parse(body);
    if (data.code != null && data.code !== 0 && data.code !== 200) throw new Error('来源接口返回错误状态 ' + data.code);
    if (source.id === 'douyin-hot') {
      if (!Array.isArray(data.data?.word_list)) throw new Error('抖音公开榜单未返回话题列表');
      rows = data.data.word_list.map(r => ({ title: r.word, url: 'https://www.douyin.com/hot/' + encodeURIComponent(r.sentence_id), heatLabel: '抖音热点榜位置' }));
    } else if (source.id === 'bilibili') {
      if (!Array.isArray(data.data?.list)) throw new Error('B站热门列表未取得');
      rows = data.data.list.map(r => ({ title: r.title, url: 'https://www.bilibili.com/video/' + r.bvid, summary: r.desc, author: r.owner?.name, publishedAt: date(r.pubdate), metrics: { views: number(r.stat?.view), likes: number(r.stat?.like), comments: number(r.stat?.reply), saves: number(r.stat?.favorite), shares: number(r.stat?.share) } }));
    } else if (source.id === 'v2ex') {
      if (!Array.isArray(data)) throw new Error('V2EX 热门列表未取得');
      rows = data.map(r => ({ title: r.title, url: r.url, summary: r.content, author: r.member?.username, publishedAt: date(r.created), metrics: { comments: number(r.replies) } }));
    } else if (source.id === 'sspai') {
      if (!Array.isArray(data.data)) throw new Error('少数派热门文章未取得');
      rows = data.data.map(r => ({ title: r.title, url: 'https://sspai.com/post/' + r.id, summary: r.summary, author: r.author?.nickname }));
    } else throw new Error('未知公开来源');
  }
  return rows.slice(0, 30).flatMap((r, index) => {
    let url; try { url = new URL(r.url); } catch { return []; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts[source.id]?.includes(url.hostname) || !text(r.title)) return [];
    return [{ id: 'e-' + digest(source.id + ':' + url.href), sourceId: source.id, origin: source.label, title: text(r.title).slice(0, 500), url: url.href, body: text(r.summary).slice(0, 1500), author: r.author || null, publishedAt: r.publishedAt || null, collectedAt: at, heat: { kind: source.kind, rank: source.kind === 'hot_list' ? index + 1 : null, label: r.heatLabel || source.label }, metrics: { views: null, likes: null, comments: null, saves: null, shares: null, ...r.metrics } }];
  });
}

async function readPublic(source, checkRunning) {
  const common = ['--disable', '--fail', '--location', '--silent', '--show-error', '--max-time', '20', '--proto', '=https', '--proto-redir', '=https', '--max-filesize', '2000000', '--user-agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36'];
  let directory;
  try {
    const extra = [];
    if (source.id === 'douyin-hot') {
      // Fresh anonymous cookies only; never import a user's Chrome login cookies.
      directory = await mkdtemp(path.join(tmpdir(), 'creator-public-hot-'));
      const jar = path.join(directory, 'anonymous-cookies');
      checkRunning();
      await runProcess('/usr/bin/curl', [...common, '--cookie-jar', jar, '--output', '/dev/null', 'https://login.douyin.com/'], { timeoutMs: 25000, maxBytes: 10000 });
      extra.push('--cookie', jar, '--referer', 'https://www.douyin.com/');
    }
    checkRunning();
    return (await runProcess('/usr/bin/curl', [...common, ...extra, source.endpoint], { timeoutMs: 25000, maxBytes: 2000000 })).stdout;
  } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
}
export async function collectPublicSources(reader = readPublic, checkRunning = () => {}) {
  const results = await Promise.all(PUBLIC_SOURCES.map(async source => {
    try {
      checkRunning();
      const body = await reader(source, checkRunning), signals = parseFeed(source, body, new Date().toISOString());
      return { source: { ...source, status: signals.length ? 'ok' : 'empty', count: signals.length, message: signals.length ? '' : '未取得列表内容' }, signals };
    } catch (error) { return { source: { ...source, status: 'error', count: 0, message: safeMessage(error) }, signals: [] }; }
  }));
  return { sources: results.map(r => r.source), signals: results.flatMap(r => r.signals) };
}
