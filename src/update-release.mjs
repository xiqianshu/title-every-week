import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { safeMessage } from './runtime.mjs';

const repository = 'https://github.com/xiqianshu/title-every-week/raw/';
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
// macOS includes curl. It supports proxy environments without relying on Node DNS/proxy defaults.
export async function githubFetch(url, { launcher = spawn } = {}) {
  if (!String(url).startsWith(repository)) throw new Error('更新仅能从固定的 GitHub 仓库下载');
  const limit = String(url).endsWith('/latest.json') ? 16000 : 2 * 1024 * 1024;
  const bytes = await new Promise((resolve, reject) => {
    const child = launcher('/usr/bin/curl', ['--disable', '--fail', '--location', '--silent', '--show-error', '--max-time', '30', '--proto', '=https', '--proto-redir', '=https', '--max-filesize', String(limit), '--header', 'Cache-Control: no-cache', String(url)], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let size = 0, stderr = '', failure, killTimer;
    const stop = message => {
      if (failure) return;
      failure = new Error(message); child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 500); killTimer.unref();
    };
    const timer = setTimeout(() => stop('GitHub 下载超时，原版本保留'), 35000);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > limit) stop('更新文件超过容量限制'); else if (!failure) chunks.push(chunk); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-3000); });
    child.once('error', error => { clearTimeout(timer); clearTimeout(killTimer); reject(new Error('无法下载 GitHub 更新：' + safeMessage(error))); });
    child.once('close', code => {
      clearTimeout(timer); clearTimeout(killTimer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error('GitHub 下载未完成：' + safeMessage(stderr || '退出状态 ' + code)));
      else resolve(Buffer.concat(chunks));
    });
  });
  return new Response(bytes);
}
export function newerVersion(target, current) {
  if (!versionPattern.test(target) || !versionPattern.test(current)) throw new Error('程序版本格式无效');
  const a = target.split('.').map(Number), b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export function validateRelease(input) {
  if (!input || typeof input.version !== 'string' || input.version.length > 40 || !versionPattern.test(input.version) || !/^[a-f0-9]{40}$/.test(input.commit) || !/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error('GitHub 更新信息格式无效，本次不会安装');
  return { version: input.version, commit: input.commit, sha256: input.sha256 };
}
async function download(url, limit, fetcher) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(30000), headers: { 'Cache-Control': 'no-cache' } });
  if (!response.ok) throw new Error('GitHub 下载未完成（HTTP ' + response.status + '），原版本保留');
  if (Number(response.headers.get('content-length')) > limit) throw new Error('更新文件超过容量限制');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) { await response.body.cancel().catch(() => {}); throw new Error('更新文件超过容量限制'); }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
export async function readLatestRelease(fetcher = githubFetch) {
  const bytes = await download(repository + 'refs/heads/feat/creator-automation/releases/latest.json', 16000, fetcher);
  let metadata; try { metadata = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('GitHub 更新信息未取得，原版本保留'); }
  return validateRelease(metadata);
}
export async function downloadPackage(input, fetcher = githubFetch) {
  const release = validateRelease(input);
  const bytes = await download(repository + release.commit + '/releases/creator-workflow-mac.zip', 2 * 1024 * 1024, fetcher);
  if (createHash('sha256').update(bytes).digest('hex') !== release.sha256) throw new Error('安装包校验失败，未安装；原版本保留');
  return bytes;
}
