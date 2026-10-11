'use strict';
let current, initialized = false, currentReport = '', loadedVersion = '';
let packState = { id: null, ready: false, loading: false, failures: 0, pack: null, evidence: [] };
let renderedWeekKey = '', renderedPackKey = '';
const $ = id => document.getElementById(id);
const platformNames = { douyin: '抖音', xiaohongshu: '小红书' };
const jobNames = { weekly: '本周选题与两平台稿件', collect: '热门话题与选题研究', daily: '每日研究与复盘', review: '发布复盘' };
const topicStatusNames = { pending: '待写', published: '已发布', reviewed: '已复盘' };
function element(tag, text, className) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; }
function showMessage(text) { $('message').textContent = text; $('message').hidden = false; }
function settingsFeedback(text, failed = false) { const message = $('settings-feedback'); message.textContent = text; message.classList.toggle('failed', failed); message.hidden = false; }
async function api(route, data) {
  const response = await fetch(route, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workflow-Request': '1' }, body: JSON.stringify(data) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '操作未完成'); return result;
}
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(section => { section.hidden = section.id !== name; });
  document.querySelectorAll('.nav').forEach(button => button.classList.toggle('active', button.dataset.tab === name));
}
async function copyText(text, label) { try { await navigator.clipboard.writeText(text); showMessage(label + '已复制'); } catch { showMessage('复制未完成，可以手动选择文本复制。'); } }
function topicStatusOf(topicId) {
  const posts = (current?.posts || []).filter(post => post.topicId && post.topicId === topicId);
  if (!posts.length) return 'pending';
  const latest = Math.max(...posts.map(post => Date.parse(post.publishedAt) || 0));
  const reviewed = (current?.jobs || []).some(job => job.kind === 'review' && job.status !== 'failed' && (Date.parse(job.createdAt) || 0) >= latest);
  return reviewed ? 'reviewed' : 'published';
}
function statusBadge(status) { return element('span', topicStatusNames[status], 'badge ' + (status === 'pending' ? 'pending' : 'success')); }
function addSource(container, record = { platform: 'douyin', url: '', label: '' }) {
  if ($(container).children.length >= 6) { showMessage('最多添加六个来源'); return; }
  const row = element('div', null, 'account-row');
  const select = element('select');
  for (const [value, name] of Object.entries(platformNames)) { const option = element('option', name); option.value = value; select.append(option); }
  select.value = record.platform;
  const url = element('input'); url.type = 'url'; url.placeholder = '完整主页或作品网址'; url.value = record.url; url.required = true;
  const label = element('input'); label.placeholder = '备注（可选）'; label.className = 'row-label'; label.value = record.label;
  const remove = element('button', '×'); remove.type = 'button'; remove.setAttribute('aria-label', '移除此来源'); remove.onclick = () => row.remove();
  row.append(select, url, label, remove); $(container).append(row);
}
function sourcesFrom(container) { return [...$(container).children].map(row => ({ platform: row.children[0].value, url: row.children[1].value.trim(), label: row.children[2].value.trim() })); }
function showCollector() { $('playwright-settings').hidden = $('collector').value !== 'playwright'; $('opencli-settings').hidden = $('collector').value !== 'opencli'; }
function initSettings(config) {
  $('collector').value = config.collector; $('schedule-hour').value = config.scheduleHour; $('auto-enabled').checked = config.enabled;
  $('broad-research').checked = config.broadResearch !== false;
  const pausedPlatforms = new Set(config.pausedPlatforms || []);
  $('collect-douyin').checked = !pausedPlatforms.has('douyin');
  $('collect-xiaohongshu').checked = !pausedPlatforms.has('xiaohongshu');
  $('keywords').value = config.keywords.join('，');
  $('profile-goal').value = config.profile.goal; $('profile-voice').value = config.profile.voice; $('profile-boundaries').value = config.profile.boundaries;
  $('accounts').replaceChildren(); $('links').replaceChildren(); config.accounts.forEach(a => addSource('accounts', a)); config.links.forEach(a => addSource('links', a)); showCollector();
}
function renderNotes(status) {
  const query = $('note-search').value.trim().toLowerCase();
  const notes = status.notes.slice().reverse().filter(note => !query || String(note.text || '').toLowerCase().includes(query));
  $('notes').replaceChildren(...(notes.length ? notes.map(note => {
    const card = element('article', null, 'panel note-card');
    card.append(element('p', note.text));
    card.append(element('small', new Date(note.createdAt).toLocaleDateString('zh-CN')));
    const actions = element('div', null, 'actions note-actions');
    const edit = element('button', '编辑', 'mini'); edit.type = 'button';
    edit.onclick = async () => {
      const next = window.prompt('编辑这条素材', note.text);
      if (next == null || next.trim() === String(note.text).trim()) return;
      try { await api('/api/notes/update', { id: note.id, text: next.trim() }); showMessage('素材已更新'); await refresh(); } catch (error) { showMessage(error.message); }
    };
    const remove = element('button', '删除', 'mini'); remove.type = 'button';
    remove.onclick = async () => {
      if (!window.confirm('删除这条素材？删除后不可恢复。')) return;
      try { await api('/api/notes/delete', { id: note.id }); showMessage('素材已删除'); await refresh(); } catch (error) { showMessage(error.message); }
    };
    actions.append(edit, remove); card.append(actions); return card;
  }) : [element('div', '还没有素材，或没有匹配内容。记录你真实做过的小事，写稿时会用到。', 'empty')]));
}
function renderPosts(status) {
  const query = $('post-search').value.trim().toLowerCase();
  const posts = status.posts.slice().reverse().filter(post => !query || String(post.title || '').toLowerCase().includes(query) || String(post.url || '').toLowerCase().includes(query));
  $('post-list').replaceChildren(...(posts.length ? posts.map(post => {
    const row = element('article', null, 'report-row');
    const text = element('div');
    text.append(element('strong', post.title || '已发布作品'));
    const topic = (packState.pack?.topics || []).find(t => t.id === post.topicId);
    text.append(element('p', platformNames[post.platform] + ' · ' + new Date(post.publishedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) + (topic ? ' · 关联：' + topic.title : '')));
    const actions = element('div', null, 'actions');
    const link = element('a', '打开作品', 'button mini'); link.href = post.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const remove = element('button', '删除', 'mini'); remove.type = 'button';
    remove.onclick = async () => {
      if (!window.confirm('删除这条发布记录？已有的指标快照会保留。')) return;
      try { await api('/api/posts/delete', { id: post.id }); showMessage('发布记录已删除'); await refresh(); } catch (error) { showMessage(error.message); }
    };
    actions.append(link, remove); row.append(text, actions); return row;
  }) : [element('div', '还没有发布记录，或没有匹配内容。发布后在这里登记，72 小时和七天后会自动用于复盘。', 'empty')]));
}
function packPlatform(name, data) {
  const box = element('div', null, 'pack-platform');
  box.append(element('h3', name + ' 版'));
  if (!data) { box.append(element('p', '（本条未生成）')); return box; }
  box.append(element('strong', data.title || ''));
  const body = element('div', null, 'pack-text');
  body.textContent = data.pages ? data.pages.join('\n\n') : (data.script || '');
  box.append(body);
  if (data.caption) box.append(element('small', '发布文案：' + data.caption));
  return box;
}
function packCard(topic, status, evidenceMap) {
  const card = element('article', null, 'panel pack-card');
  const top = element('div', null, 'panel-top');
  const head = element('div', null, 'pack-head');
  const line = element('div', null, 'pack-title-line');
  line.append(element('span', topic.pillar || '选题', 'chip'), statusBadge(status));
  head.append(line, element('h2', topic.title || '未命名选题'));
  const actions = element('div', null, 'actions');
  const copyDy = element('button', '复制抖音稿'); copyDy.type = 'button';
  copyDy.onclick = () => copyText([topic.douyin?.title, topic.douyin?.script, topic.douyin?.caption].filter(Boolean).join('\n\n'), '抖音稿');
  const copyXhs = element('button', '复制小红书稿'); copyXhs.type = 'button';
  copyXhs.onclick = () => copyText([topic.xiaohongshu?.title, (topic.xiaohongshu?.pages || []).join('\n\n———\n\n'), topic.xiaohongshu?.caption].filter(Boolean).join('\n\n'), '小红书稿');
  actions.append(copyDy, copyXhs);
  top.append(head, actions); card.append(top);
  if (topic.angle) card.append(element('p', '角度：' + topic.angle));
  if (topic.reason) card.append(element('p', '为什么值得做：' + topic.reason));
  const grid = element('div', null, 'pack-grid');
  grid.append(packPlatform('抖音', topic.douyin), packPlatform('小红书', topic.xiaohongshu));
  card.append(grid);
  const shots = topic.douyin?.shots || [];
  if (shots.length || topic.douyin?.cover || topic.xiaohongshu?.cover) {
    const details = element('details');
    details.append(element('summary', '封面与拍摄要点'));
    const ul = element('ul');
    if (topic.douyin?.cover) ul.append(element('li', '抖音封面：' + topic.douyin.cover));
    for (const shot of shots) ul.append(element('li', shot));
    if (topic.xiaohongshu?.cover) ul.append(element('li', '小红书封面：' + topic.xiaohongshu.cover));
    details.append(ul); card.append(details);
  }
  if ((topic.missingMaterials || []).length) {
    const details = element('details');
    details.append(element('summary', '待补素材 ' + topic.missingMaterials.length + ' 项'));
    const ul = element('ul');
    for (const item of topic.missingMaterials) ul.append(element('li', item));
    details.append(ul); card.append(details);
  }
  const sources = (topic.sourceIds || []).map(id => evidenceMap.get(id)).filter(Boolean);
  if (sources.length) {
    const details = element('details');
    details.append(element('summary', '引用来源 ' + sources.length + ' 条'));
    const ul = element('ul');
    for (const source of sources.slice(0, 10)) {
      const li = element('li');
      const link = element('a', (platformNames[source.platform] || source.platform || '') + ' · ' + String(source.title || '').slice(0, 70));
      link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; li.append(link); ul.append(li);
    }
    details.append(ul); card.append(details);
  }
  return card;
}
function renderTopicOptions() {
  const select = $('post-topic');
  const previous = select.value;
  const options = [element('option', '不关联')]; options[0].value = '';
  for (const topic of (packState.pack?.topics || [])) { const option = element('option', (topic.pillar || '') + ' · ' + String(topic.title || '').slice(0, 30)); option.value = topic.id; options.push(option); }
  select.replaceChildren(...options);
  if (previous && [...select.options].some(option => option.value === previous)) select.value = previous;
}
function renderWeek(status) {
  const panel = $('week-panel');
  const pack = packState.ready ? packState.pack : null;
  if (!pack || !(pack.topics || []).length) { panel.hidden = true; renderedWeekKey = ''; return; }
  const topics = pack.topics;
  const statuses = topics.map(topic => topicStatusOf(topic.id));
  const key = packState.id + ':' + statuses.join(',');
  if (key === renderedWeekKey) { panel.hidden = false; return; }
  renderedWeekKey = key;
  panel.hidden = false;
  $('week-summary').textContent = '已发布 ' + statuses.filter(s => s === 'published').length + ' · 已复盘 ' + statuses.filter(s => s === 'reviewed').length + ' · 共 ' + topics.length + ' 篇（待写 ' + statuses.filter(s => s === 'pending').length + '）';
  $('week-list').replaceChildren(...topics.map((topic, index) => {
    const row = element('div', null, 'week-row');
    const info = element('div');
    info.append(element('strong', topic.title || '未命名选题'), element('p', (topic.pillar || '') + ' · ' + String(topic.angle || '').slice(0, 90)));
    row.append(statusBadge(statuses[index]), info);
    return row;
  }));
}
function renderPack(status) {
  const empty = $('pack-empty'), meta = $('pack-meta'), list = $('pack-list');
  const pack = packState.ready ? packState.pack : null;
  if (!pack || !(pack.topics || []).length) {
    renderedPackKey = '';
    empty.hidden = false; meta.hidden = true; list.replaceChildren();
    return;
  }
  empty.hidden = true;
  const statuses = pack.topics.map(topic => topicStatusOf(topic.id));
  const key = packState.id + ':' + statuses.join(',');
  if (key === renderedPackKey) return;
  renderedPackKey = key;
  meta.hidden = false;
  meta.replaceChildren();
  meta.append(element('p', pack.summary || ''));
  const actions = element('div', null, 'actions');
  const openButton = element('button', '查看完整报告'); openButton.type = 'button';
  openButton.onclick = () => { switchTab('home'); openReport(packState.id).catch(error => showMessage(error.message)); };
  const homeButton = element('button', '回概览看进度'); homeButton.type = 'button';
  homeButton.onclick = () => switchTab('home');
  actions.append(openButton, homeButton);
  meta.append(actions);
  const evidenceMap = new Map((packState.evidence || []).map(item => [item.id, item]));
  list.replaceChildren(...pack.topics.map((topic, index) => packCard(topic, statuses[index], evidenceMap)));
}
function syncPack(status) {
  const id = status.state?.lastWeeklyId || null;
  if (id !== packState.id) { packState = { id, ready: false, loading: false, failures: 0, pack: null, evidence: [] }; renderedWeekKey = ''; renderedPackKey = ''; renderTopicOptions(); }
  if (!id) { packState.ready = true; renderWeek(status); renderPack(status); return; }
  if (packState.ready) { renderWeek(status); renderPack(status); return; }
  if (packState.loading) return;
  packState.loading = true;
  const target = id;
  api('/api/reports/' + encodeURIComponent(id)).then(result => {
    if (packState.id !== target) return;
    packState = { id: target, ready: true, loading: false, failures: 0, pack: result.report?.pack || null, evidence: result.report?.evidence || [] };
    renderedWeekKey = ''; renderedPackKey = '';
    renderTopicOptions(); renderWeek(current || status); renderPack(current || status);
  }).catch(() => {
    if (packState.id !== target) return;
    packState.loading = false;
    packState.failures = (packState.failures || 0) + 1;
    if (packState.failures >= 3) packState.ready = true;
    renderWeek(current || status); renderPack(current || status);
  });
}
let mbInitialized = false;
function initModelBackend(status) {
  const mb = status.modelBackend || {};
  if (!mbInitialized) { $('mb-enabled').checked = Boolean(mb.enabled); if (mb.model) $('mb-model').value = mb.model; mbInitialized = true; }
  $('mb-state').textContent = mb.enabled
    ? '已启用：' + (mb.model || '') + '（Key ' + (mb.hasKey ? '已保存' : '未保存') + '）'
    : (mb.hasKey ? '当前未启用；Key 已保存，勾选并保存即可启用' : '粘贴 Key → 勾选启用 → 保存');
}
function render(status) {
  const wasUpdating = current?.updater?.busy;
  current = status;
  const update = status.updater;
  if (update) {
    if (loadedVersion && loadedVersion !== update.currentVersion && !update.busy) { location.reload(); return; }
    if (!loadedVersion) loadedVersion = update.currentVersion;
    if (wasUpdating && !update.busy) showMessage(update.message);
    $('program-version').textContent = '当前版本：' + update.currentVersion;
    $('update-feedback').textContent = update.message + (update.supported ? '' : ' 此运行环境可检查版本；安装更新请使用 Mac 安装入口。');
    $('update-feedback').classList.toggle('failed', ['failed', 'check-failed'].includes(update.status));
    $('update-check').disabled = status.busy || update.checking;
    $('update-check').textContent = update.checking ? '正在检查…' : '检查更新';
    $('update-install').hidden = !update.available;
    $('update-install').disabled = status.busy || update.checking || !update.supported;
    $('update-install').textContent = update.busy ? '正在更新…' : '安装更新 ' + update.latestVersion;
  }
  if (!initialized) { initSettings(status.config); initialized = true; }
  initModelBackend(status);
  $('item-count').textContent = status.itemCount + (status.signalCount || 0);
  $('schedule-state').textContent = status.config.enabled ? '已开启' : '未开启';
  $('schedule-detail').textContent = status.config.enabled ? '每日 ' + String(status.config.scheduleHour).padStart(2, '0') + ':00（北京时间）' : '保存连接设置后可开启';
  $('connection-banner').hidden = status.browserConfigured;
  const tokenSaved = status.playwrightTokenSaved ?? (status.config.collector === 'playwright' && status.browserConfigured);
  $('browser-token-state').textContent = tokenSaved ? '连接令牌已保存。输入框留空即可；实际浏览器连接等待首次采集验证。' : '尚未保存连接令牌。粘贴后点击下方「保存设置」。';
  $('current-stage').textContent = update?.busy ? update.message : status.busy ? status.jobs.find(j => j.status === 'running')?.stage || '任务正在启动' : '准备就绪';
  document.querySelectorAll('.run').forEach(button => { button.disabled = status.busy; });
  $('stop-task').hidden = !status.busy || Boolean(update?.busy);
  const reports = status.jobs.map(job => {
    const row = element('article', null, 'report-row'); const text = element('div');
    text.append(element('strong', jobNames[job.kind] || '任务'));
    text.append(element('p', new Date(job.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) + ' · ' + job.stage));
    const right = element('div'); right.append(element('div', { success: '已完成', partial: '部分来源未取得', failed: '需要处理', running: '运行中' }[job.status], 'badge ' + job.status));
    if (job.reportId) { const button = element('button', '查看报告'); button.onclick = () => openReport(job.reportId).catch(error => showMessage(error.message)); right.append(button); }
    row.append(text, right); return row;
  });
  $('reports').replaceChildren(...(reports.length ? reports : [element('div', '第一份报告会在任务完成后出现在这里。', 'empty')]));
  renderNotes(status);
  renderPosts(status);
  syncPack(status);
}
async function refresh() { try { render(await api('/api/status')); } catch (error) { showMessage(current?.updater?.busy ? '工作台正在更新并重新连接，请稍候。已有资料保留。' : '工作台连接中断：' + error.message + '。可以重新打开「打开工作台.command」。'); } }
async function openReport(id) {
  const result = await api('/api/reports/' + encodeURIComponent(id)); currentReport = result.markdown;
  $('report-text').textContent = currentReport; $('download-report').href = '/api/reports/' + encodeURIComponent(id) + '?download=1'; $('report-view').hidden = false; $('report-view').scrollIntoView({ behavior: 'smooth' });
}
document.querySelectorAll('.nav').forEach(button => { button.onclick = () => switchTab(button.dataset.tab); });
document.querySelectorAll('.run').forEach(button => { button.onclick = async () => { try { await api('/api/run', { kind: button.dataset.kind }); showMessage('任务已启动，你可以关闭页面，后台会继续运行。'); await refresh(); } catch (error) { showMessage(error.message); } }; });
$('stop-task').onclick = async () => { try { const result = await api('/api/stop', {}); if (result.stopped) $('auto-enabled').checked = false; showMessage(result.message); await refresh(); } catch (error) { showMessage(error.message); } };
for (let hour = 0; hour < 24; hour++) { const option = element('option', String(hour).padStart(2, '0') + ':00'); option.value = hour; $('schedule-hour').append(option); }
$('collector').onchange = showCollector;
$('add-account').onclick = () => addSource('accounts'); $('add-link').onclick = () => addSource('links');
$('week-go').onclick = () => switchTab('pack');
$('pack-go-home').onclick = () => switchTab('home');
$('note-search').oninput = () => { if (current) renderNotes(current); };
$('post-search').oninput = () => { if (current) renderPosts(current); };
$('mb-save').onclick = async () => {
  const button = $('mb-save'); if (button.disabled) return; button.disabled = true; button.textContent = '正在保存…';
  try { await api('/api/model-backend', { enabled: $('mb-enabled').checked, model: $('mb-model').value, apiKey: $('mb-key').value.trim() }); $('mb-key').value = ''; showMessage('模型后端设置已保存'); await refresh(); }
  catch (error) { showMessage(error.message); }
  finally { button.disabled = false; button.textContent = '保存模型后端'; }
};
$('settings-form').onsubmit = async event => {
  event.preventDefault();
  const button = $('settings-save'); if (button.disabled) return;
  button.disabled = true; button.textContent = '正在保存…'; settingsFeedback('正在保存设置…');
  try {
    const config = { ...current.config, broadResearch: $('broad-research').checked, pausedPlatforms: [...($('collect-douyin').checked ? [] : ['douyin']), ...($('collect-xiaohongshu').checked ? [] : ['xiaohongshu'])], collector: $('collector').value, scheduleHour: Number($('schedule-hour').value), enabled: $('auto-enabled').checked, keywords: $('keywords').value.split(/[,，\n]/).map(s => s.trim()).filter(Boolean), accounts: sourcesFrom('accounts'), links: sourcesFrom('links'), profile: { ...current.config.profile, goal: $('profile-goal').value.trim(), voice: $('profile-voice').value.trim(), boundaries: $('profile-boundaries').value.trim() } };
    let playwrightToken = $('browser-token').value.trim(); if (playwrightToken.startsWith('PLAYWRIGHT_MCP_EXTENSION_TOKEN=')) playwrightToken = playwrightToken.slice('PLAYWRIGHT_MCP_EXTENSION_TOKEN='.length);
    const result = await api('/api/config', { config, playwrightToken }); $('browser-token').value = ''; button.textContent = '已保存 ✓';
    if (result.stopped) $('auto-enabled').checked = false;
    const message = result.stopped ? '设置已保存。已停止当前任务并暂停自动运行，已保存资料保留。' : '设置已保存。可以回到概览，点击「研究热门与选题」。';
    settingsFeedback(message + ' 令牌输入框已清空以隐藏内容，已有令牌会保留。');
    showMessage(message); await refresh();
    $('settings-feedback').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch (error) { button.textContent = '保存设置'; settingsFeedback('设置未保存：' + error.message, true); showMessage(error.message); }
  finally { button.disabled = false; }
};
$('settings-form').addEventListener('input', () => { if (!$('settings-save').disabled) { $('settings-save').textContent = '保存设置'; $('settings-feedback').hidden = true; } });
for (const action of ['check', 'install']) $('update-' + action).onclick = async () => {
  const button = $('update-' + action); button.disabled = true;
  $('update-feedback').textContent = action === 'check' ? '正在检查新版…' : '正在启动更新，请保持联网。';
  try { await api('/api/update/' + action, {}); await refresh(); }
  catch (error) { $('update-feedback').textContent = error.message; $('update-feedback').classList.add('failed'); showMessage(error.message); }
  finally { button.disabled = Boolean(current?.busy); }
};
$('note-form').onsubmit = async event => { event.preventDefault(); try { await api('/api/notes', { text: $('note-text').value }); $('note-text').value = ''; showMessage('真实素材已保存，下轮写稿会参考它。'); await refresh(); } catch (error) { showMessage(error.message); } };
$('post-form').onsubmit = async event => {
  event.preventDefault();
  try {
    const metrics = Object.fromEntries(['views', 'likes', 'comments', 'saves', 'shares', 'followers'].map(name => [name, $('metric-' + name).value === '' ? null : Number($('metric-' + name).value)]));
    await api('/api/posts', { platform: $('post-platform').value, title: $('post-title').value, url: $('post-url').value, topicId: $('post-topic').value, publishedAt: new Date($('post-date').value + '+08:00').toISOString(), metrics });
    $('post-form').reset(); showMessage('发布记录已保存；观察窗口到期后会用于复盘。'); await refresh();
  } catch (error) { showMessage(error.message); }
};
$('close-report').onclick = () => { $('report-view').hidden = true; };
$('copy-report').onclick = async () => { try { await navigator.clipboard.writeText(currentReport); showMessage('报告已复制'); } catch { showMessage('复制未完成，可以下载报告或在正文中手动选择文字。'); } };
if (location.hash && document.getElementById(location.hash.slice(1))) switchTab(location.hash.slice(1));
refresh(); setInterval(refresh, 2500);
