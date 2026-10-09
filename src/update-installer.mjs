import path from 'node:path';
import { mkdtemp, readFile, rename, rm, realpath, lstat, access } from 'node:fs/promises';
import { Store } from './store.mjs';
import { downloadPackage, validateRelease, newerVersion, githubFetch } from './update-release.mjs';
import { extractPackage } from './update-archive.mjs';
import { installMac, AGENT_LABEL } from './mac.mjs';
import { runProcess, safeMessage } from './runtime.mjs';

export async function prepareDependencies(candidate, dataRoot, runner = runProcess) {
  const npm = await realpath(path.join(path.dirname(process.execPath), 'npm'));
  await runner(process.execPath, [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', path.join(dataRoot, 'update-cache')], { cwd: candidate, timeoutMs: 300000 });
  const entries = ['@openai/codex/bin/codex.js', '@playwright/mcp/cli.js', '@jackwener/opencli/dist/src/main.js'];
  for (const entry of entries) await access(path.join(candidate, 'node_modules', entry));
  const codex = await runner(process.execPath, [path.join(candidate, 'node_modules', entries[0]), 'exec', '--help'], { cwd: candidate, timeoutMs: 15000 });
  for (const flag of ['--ignore-user-config', '--output-schema', '--output-last-message']) if (!codex.stdout.includes(flag)) throw new Error('新版 Codex 命令不可用，原程序保留；请检查依赖下载');
}
async function stopMac() {
  await runProcess('/bin/launchctl', ['bootout', 'gui/' + process.getuid() + '/' + AGENT_LABEL], { timeoutMs: 15000 });
}
export async function installUpdate({ appRoot, dataRoot, release: input, fetcher = githubFetch, prepare = prepareDependencies, stop = stopMac, start = () => installMac(appRoot, dataRoot) }) {
  const release = validateRelease(input), store = new Store(dataRoot);
  if (path.resolve(dataRoot) !== path.join(path.resolve(appRoot), 'data') || (await lstat(appRoot)).isSymbolicLink() || (await lstat(dataRoot)).isSymbolicLink()) throw new Error('当前安装位置不支持自动更新，请使用安装入口');
  const current = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8'));
  if (!newerVersion(release.version, current.version)) throw new Error('该版本不是比当前程序更新的版本');
  const update = async (status, message) => {
    let previous = {}; try { previous = await store.read('updater'); } catch {}
    await store.write('updater', { ...previous, status, message, release, workerPid: process.pid, updatedAt: new Date().toISOString() });
  };
  const directory = await mkdtemp(path.join(path.dirname(appRoot), '.creator-update-'));
  const candidate = path.join(directory, 'candidate'), backup = path.join(directory, 'previous');
  let stopped = false, movedOld = false, movedData = false, placedNew = false, releaseLock, restored = true;
  try {
    await update('installing', '正在下载并校验新版安装包');
    await extractPackage(await downloadPackage(release, fetcher), candidate);
    const target = JSON.parse(await readFile(path.join(candidate, 'package.json'), 'utf8'));
    if (target.name !== 'creator-workflow' || target.version !== release.version) throw new Error('安装包的程序或版本与更新信息不一致');
    await update('installing', '正在准备新版依赖，当前程序继续保留');
    await prepare(candidate, dataRoot);
    releaseLock = await store.lock();
    await update('installing', '正在切换程序并重启工作台，个人资料保留');
    stopped = true; await stop();
    await rename(appRoot, backup); movedOld = true;
    await rename(path.join(backup, 'data'), path.join(candidate, 'data')); movedData = true;
    await rename(candidate, appRoot); placedNew = true;
    await start();
    await releaseLock(); releaseLock = null;
    await update('success', '更新完成，已保留设置、令牌、素材和报告');
  } catch (error) {
    let message = safeMessage(error);
    if (movedOld) {
      try {
        if (placedNew) { await stop().catch(() => {}); await rename(path.join(appRoot, 'data'), path.join(backup, 'data')); await rename(appRoot, candidate); }
        else if (movedData) await rename(path.join(candidate, 'data'), path.join(backup, 'data'));
        await rename(backup, appRoot);
      } catch (restoreError) { restored = false; message += '；恢复未完成，请保留目录 ' + directory + '：' + safeMessage(restoreError); }
    }
    if (stopped && restored) { try { await start(); } catch (restartError) { message += '；原程序重启需要处理：' + safeMessage(restartError); } }
    if (restored) await update('failed', '更新未完成，原版本和资料保留：' + message);
    throw new Error(message);
  } finally {
    if (releaseLock && restored) await releaseLock();
    if (restored) await rm(directory, { recursive: true, force: true });
  }
}
