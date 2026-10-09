const allowed = new Set(['browser_tabs', 'browser_navigate', 'browser_wait_for', 'browser_read_page']);
export function checkBrowserCall(name, args = {}) {
  if (!allowed.has(name)) throw new Error('此连接只提供页面读取工具');
  if (name === 'browser_tabs' && args.action !== 'list') throw new Error('采集连接不关闭或修改其他标签页');
  if (name === 'browser_navigate') {
    const url = new URL(args.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['www.douyin.com', 'douyin.com', 'www.xiaohongshu.com', 'xiaohongshu.com'].includes(url.hostname)) throw new Error('仅访问两平台的公开研究页面');
    const routes = url.hostname.endsWith('douyin.com') ? /^\/(?:$|(?:video|hot|search|user|jingxuan)(?:\/|$))/ : /^\/(?:$|(?:explore|search_result|note|discovery\/item|user\/profile)(?:\/|$))/;
    if (!routes.test(url.pathname)) throw new Error('此页面不属于公开作品、搜索或发现入口');
  }
  if (name === 'browser_wait_for' && args.time != null && (args.time < 0 || args.time > 5)) throw new Error('单次等待最多五秒');
  if (name === 'browser_wait_for' && (args.text || args.textGone || !args.time)) throw new Error('仅提供有限时间等待，不读取其他页面的文本');
}

// Fixed DOM reader; its only UI change is muting media in the collection page.
// The model never supplies JavaScript to this gateway.
export const pageReadCode = (() => {
  if (!['www.douyin.com', 'douyin.com', 'www.xiaohongshu.com', 'xiaohongshu.com'].includes(location.hostname)) return { error: '当前标签页不是两平台页面，未读取内容' };
  const routes = location.hostname.endsWith('douyin.com') ? /^\/(?:$|(?:video|hot|search|user|jingxuan)(?:\/|$))/ : /^\/(?:$|(?:explore|search_result|note|discovery\/item|user\/profile)(?:\/|$))/;
  if (!routes.test(location.pathname)) return { error: '当前页面不是公开研究入口，未读取内容' };
  for (const media of document.querySelectorAll('video, audio')) { media.muted = true; media.volume = 0; }
  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
  const compact = value => String(value || '').replace(/\s+/g, ' ').trim();
  const links = [...document.querySelectorAll('a[href]')].filter(visible).map(a => {
    let url; try { url = new URL(a.getAttribute('href'), location.href); } catch { return null; }
    if (url.protocol !== 'https:' || url.hostname !== location.hostname) return null;
    const isWork = /^\/(?:video|explore|search_result|note|discovery\/item)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
    const card = a.closest('section, article, [data-e2e="search-result-item"], .video-card, .note-item, li') || a.parentElement;
    return { url: url.href, title: compact(a.innerText || a.getAttribute('aria-label') || a.getAttribute('title')).slice(0, 500), isWork, cardText: isWork ? compact(card?.innerText).slice(0, 1600) : '' };
  }).filter(Boolean);
  const works = [...new Map(links.filter(l => l.isWork).map(l => [l.url, l])).values()].slice(0, 60);
  const profiles = links.filter(l => /^\/user\/(?:profile\/)?[^/]+\/?$/.test(new URL(l.url).pathname)).slice(0, 30);
  const labeled = [...document.querySelectorAll('[aria-label], [title], [data-e2e]')].filter(visible).map(el => ({ label: el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('data-e2e'), text: compact(el.innerText).slice(0, 120) })).filter(x => /赞|评论|收藏|分享|播放|粉丝|like|comment|collect|share|play/i.test(x.label)).slice(0, 60);
  return { url: location.href, title: document.title, text: (document.body?.innerText || '').slice(0, 35000), works, profiles, labeled, links: links.filter(l => !l.isWork).slice(0, 40) };
}).toString();
export const mutePageCode = (() => {
  if (!['www.douyin.com', 'douyin.com', 'www.xiaohongshu.com', 'xiaohongshu.com'].includes(location.hostname)) return { muted: false };
  const routes = location.hostname.endsWith('douyin.com') ? /^\/(?:$|(?:video|hot|search|user|jingxuan)(?:\/|$))/ : /^\/(?:$|(?:explore|search_result|note|discovery\/item|user\/profile)(?:\/|$))/;
  if (!routes.test(location.pathname)) return { muted: false };
  const mute = () => { for (const media of document.querySelectorAll('video, audio')) { media.muted = true; media.volume = 0; } };
  mute();
  if (!window.__creatorMediaMute) { window.__creatorMediaMute = new MutationObserver(mute); window.__creatorMediaMute.observe(document.documentElement, { childList: true, subtree: true }); }
  return { muted: true };
}).toString();
export const currentPageCode = (() => {
  const isDy = ['www.douyin.com', 'douyin.com'].includes(location.hostname), isXhs = ['www.xiaohongshu.com', 'xiaohongshu.com'].includes(location.hostname);
  const routes = isDy ? /^\/(?:$|(?:video|hot|search|user|jingxuan)(?:\/|$))/ : /^\/(?:$|(?:explore|search_result|note|discovery\/item|user\/profile)(?:\/|$))/;
  return (isDy || isXhs) && routes.test(location.pathname) ? { current: { url: location.href, title: document.title } } : { error: '当前标签页不是公开研究页面，不返回其他标签页资料' };
}).toString();
