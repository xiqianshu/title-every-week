'use strict';
let current, initialized = false, currentReport = '', loadedVersion = '';
const $ = id => document.getElementById(id);
const platformNames = { douyin: '抖音', xiaohongshu: '小红书' };
const jobNames = { weekly: '本周选题与两平台稿件', collect: '热门话题与选题研究', daily: '每日研究与复盘', review: '发布复盘' };
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
  $('keywords').value = config.keywords.join('，');
  $('profile-goal').value = config.profile.goal; $('profile-voice').value = config.profile.voice; $('profile-boundaries').value = config.profile.boundaries;
  $('accounts').replaceChildren(); $('links').replaceChildren(); config.accounts.forEach(a => addSource('accounts', a)); config.links.forEach(a => addSource('links', a)); showCollector();
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
  $('notes').replaceChildren(...status.notes.slice().reverse().map(note => { const row = element('article', null, 'panel'); row.append(element('p', note.text)); row.append(element('small', new Date(note.createdAt).toLocaleDateString('zh-CN'))); return row; }));
  $('post-list').replaceChildren(...status.posts.slice().reverse().map(post => { const row = element('article', null, 'report-row'); const text = element('div'); text.append(element('strong', post.title || '已发布作品')); text.append(element('p', platformNames[post.platform] + ' · ' + new Date(post.publishedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))); const link = element('a', '打开作品'); link.href = post.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; row.append(text, link); return row; }));
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
$('settings-form').onsubmit = async event => {
  event.preventDefault();
  const button = $('settings-save'); if (button.disabled) return;
  button.disabled = true; button.textContent = '正在保存…'; settingsFeedback('正在保存设置…');
  try {
    const config = { ...current.config, broadResearch: $('broad-research').checked, collector: $('collector').value, scheduleHour: Number($('schedule-hour').value), enabled: $('auto-enabled').checked, keywords: $('keywords').value.split(/[,，\n]/).map(s => s.trim()).filter(Boolean), accounts: sourcesFrom('accounts'), links: sourcesFrom('links'), profile: { ...current.config.profile, goal: $('profile-goal').value.trim(), voice: $('profile-voice').value.trim(), boundaries: $('profile-boundaries').value.trim() } };
    let playwrightToken = $('browser-token').value.trim(); if (playwrightToken.startsWith('PLAYWRIGHT_MCP_EXTENSION_TOKEN=')) playwrightToken = playwrightToken.slice('PLAYWRIGHT_MCP_EXTENSION_TOKEN='.length);
    await api('/api/config', { config, playwrightToken }); $('browser-token').value = ''; button.textContent = '已保存 ✓';
    settingsFeedback('设置已保存。令牌输入框已清空以隐藏内容，已有令牌会保留。下一步回到概览，点击「研究热门与选题」。');
    showMessage('设置已保存。可以回到概览，点击「研究热门与选题」。'); await refresh();
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
    await api('/api/posts', { platform: $('post-platform').value, title: $('post-title').value, url: $('post-url').value, publishedAt: new Date($('post-date').value + '+08:00').toISOString(), metrics });
    $('post-form').reset(); showMessage('发布记录已保存；观察窗口到期后会用于复盘。'); await refresh();
  } catch (error) { showMessage(error.message); }
};
$('close-report').onclick = () => { $('report-view').hidden = true; };
$('copy-report').onclick = async () => { try { await navigator.clipboard.writeText(currentReport); showMessage('报告已复制'); } catch { showMessage('复制未完成，可以下载报告或在正文中手动选择文字。'); } };
refresh(); setInterval(refresh, 2500);
