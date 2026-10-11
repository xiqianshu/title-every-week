const allowed = new Set(['browser_tabs', 'browser_navigate', 'browser_wait_for', 'browser_read_page']);
export function checkBrowserCall(name, args = {}, platforms = ['douyin', 'xiaohongshu']) {
  if (!allowed.has(name)) throw new Error('此连接只提供页面读取工具');
  if (!platforms.length) throw new Error('所有平台均已暂停，没有允许访问的平台');
  if (name === 'browser_tabs' && args.action !== 'list') throw new Error('采集连接不关闭或修改其他标签页');
  if (name === 'browser_navigate') {
    const url = new URL(args.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['www.douyin.com', 'douyin.com', 'www.xiaohongshu.com', 'xiaohongshu.com'].includes(url.hostname)) throw new Error('仅访问两平台的公开研究页面');
    if (!platforms.includes(url.hostname.endsWith('douyin.com') ? 'douyin' : 'xiaohongshu')) throw new Error('该平台已暂停或不在本批允许访问的平台中');
    const routes = url.hostname.endsWith('douyin.com') ? /^\/(?:$|(?:video|hot|search|user|jingxuan)(?:\/|$))/ : /^\/(?:$|(?:explore|search_result|note|discovery\/item|user\/profile)(?:\/|$))/;
    if (!routes.test(url.pathname)) throw new Error('此页面不属于公开作品、搜索或发现入口');
  }
  if (name === 'browser_wait_for' && args.time != null && (args.time < 0 || args.time > 5)) throw new Error('单次等待最多五秒');
  if (name === 'browser_wait_for' && (args.text || args.textGone || !args.time)) throw new Error('仅提供有限时间等待，不读取其他页面的文本');
}

// Guard before the fixed reader touches the page DOM, including an already-open tab.
export function scopePageCode(code, platforms) {
  const hosts = platforms.filter(platform => ['douyin', 'xiaohongshu'].includes(platform)).flatMap(platform => [platform + '.com', 'www.' + platform + '.com']);
  return '() => { if (!' + JSON.stringify(hosts) + '.includes(location.hostname)) return { error: "当前平台已暂停或不在本批允许访问范围，未读取页面" }; return (' + code + ')(); }';
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
  const counts = [];
  for (const el of document.querySelectorAll('[data-e2e], [class]')) {
    if (counts.length >= 60) break;
    const hint = compact((el.getAttribute('data-e2e') || '') + ' ' + (typeof el.className === 'string' ? el.className : '')).slice(0, 140);
    if (!/赞|评论|收藏|分享|播放|粉丝|(?:^|[^a-z])(?:like|comment|collect|share|digg|favor|praise|count|play|view)(?:[^a-z]|$)/i.test(hint)) continue;
    if (!visible(el)) continue;
    const own = compact(el.innerText).slice(0, 60);
    const parentText = el.parentElement && el.parentElement !== el ? compact(el.parentElement.innerText).slice(0, 60) : '';
    if (!/\d/.test(own + parentText)) continue;
    counts.push({ hint, text: own, parent: /\d/.test(parentText) ? parentText : '' });
  }
  const actionBars = [];
  if (location.hostname.endsWith('douyin.com')) {
    const seen = new Set();
    for (const el of document.querySelectorAll('[data-e2e*="share-icon"], [class*="share-icon"]')) {
      if (actionBars.length >= 2) break;
      const own = compact(el.innerText).slice(0, 24);
      let bar = el.parentElement;
      for (let i = 0; i < 3 && bar; i++) {
        if ((compact(bar.innerText).match(/\d+(?:\.\d+)?/g) || []).length >= 3) break;
        bar = bar.parentElement;
      }
      if (!bar || bar === document.body) continue;
      const barText = compact(bar.innerText).slice(0, 140);
      if (!barText || seen.has(barText)) continue;
      seen.add(barText);
      actionBars.push({ hint: 'share-icon 容器的父级互动栏', own, text: barText, numbers: (barText.match(/\d+(?:\.\d+)?\s*[万亿wW]?/g) || []).slice(0, 8) });
    }
  }
  return { url: location.href, title: document.title, text: (document.body?.innerText || '').slice(0, 35000), works, profiles, labeled, counts, actionBars, links: links.filter(l => !l.isWork).slice(0, 40) };
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
