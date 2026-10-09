import path from 'node:path';
import { homedir } from 'node:os';
import { readFile, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readLatestRelease, newerVersion, validateRelease, githubFetch } from './update-release.mjs';
import { safeMessage } from './runtime.mjs';

export class Updater {
  constructor(appRoot, workflow, { fetcher = githubFetch, supported = process.platform === 'darwin' && path.resolve(appRoot) === path.join(homedir(), 'creator-workflow', 'automation') && workflow.store.root === path.join(path.resolve(appRoot), 'data'), launch } = {}) {
    this.appRoot = appRoot; this.workflow = workflow; this.store = workflow.store; this.fetcher = fetcher; this.supported = supported;
    this.launch = launch || (() => this.launchWorker()); this.starting = false; this.checking = false;
  }
  async currentVersion() { return JSON.parse(await readFile(path.join(this.appRoot, 'package.json'), 'utf8')).version; }
  async state() { try { return await this.store.read('updater'); } catch (error) { if (error.code === 'ENOENT') return { status: 'idle', message: '' }; throw error; } }
  async status() {
    const currentVersion = await this.currentVersion(); let state = await this.state();
    if (state.status === 'installing') {
      const pid = state.workerPid || state.launcherPid;
      let alive = false; if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 0); alive = true; } catch {} }
      if (!alive && Date.now() - Date.parse(state.updatedAt || '') > 30000) { state = { ...state, status: 'failed', message: '更新进程已结束，未确认更新完成。原资料保留，请重新检查更新。' }; await this.store.write('updater', state); }
    }
    let available = false; if (state.release) available = newerVersion(validateRelease(state.release).version, currentVersion);
    return { currentVersion, status: state.status, message: state.message || '点击「检查更新」查看是否有新版。', available, latestVersion: state.release?.version || null, supported: this.supported, busy: this.starting || state.status === 'installing', checking: this.checking };
  }
  async busy() { return this.starting || (await this.status()).busy; }
  async check() {
    if (this.checking || this.starting) throw new Error('正在检查或安装更新，请稍候');
    this.checking = true;
    try {
      if (await this.busy()) throw new Error('正在安装更新，请稍候');
      const release = await readLatestRelease(this.fetcher), current = await this.currentVersion();
      await this.store.write('updater', { status: 'checked', release, updatedAt: new Date().toISOString(), message: newerVersion(release.version, current) ? '发现新版 ' + release.version + '，点击「安装更新」即可。' : '当前已是最新版本。' });
      return await this.status();
    } catch (error) { const previous = await this.state(); if (previous.status !== 'installing') await this.store.write('updater', { ...previous, status: 'check-failed', message: '检查更新未完成：' + safeMessage(error) }); throw error; }
    finally { this.checking = false; }
  }
  async install() {
    if (this.starting || this.checking) throw new Error('正在检查或安装更新，请稍候');
    this.starting = true;
    let claimed = false;
    try {
      if (!this.supported) throw new Error('当前运行位置不支持后台更新，请使用 Mac 安装入口');
      if (this.workflow.busy) throw new Error('已有内容任务正在运行，任务结束后再更新');
      const status = await this.status();
      if (status.status === 'installing') throw new Error('更新已启动，请稍候');
      if (!status.available) throw new Error('请先检查更新；当前没有可安装的新版');
      const state = await this.state(); validateRelease(state.release);
      if (this.workflow.busy) throw new Error('已有内容任务正在运行，任务结束后再更新');
      await this.store.write('updater', { ...state, id: randomUUID(), status: 'installing', workerPid: null, launcherPid: process.pid, updatedAt: new Date().toISOString(), message: '更新已启动，正在下载新版；请保持联网。' });
      claimed = true;
      await this.launch();
      return { accepted: true };
    } catch (error) {
      const state = await this.state(); if (claimed && state.status === 'installing' && !state.workerPid) await this.store.write('updater', { ...state, status: 'failed', message: '更新未完成：' + safeMessage(error) });
      throw error;
    } finally { this.starting = false; }
  }
  async launchWorker() {
    const log = await open(path.join(this.store.root, 'update.log'), 'a', 0o600);
    try {
      const child = spawn(process.execPath, [path.join(this.appRoot, 'src/update-worker.mjs'), this.appRoot, this.store.root], { cwd: path.dirname(this.appRoot), detached: true, stdio: ['ignore', log.fd, log.fd], shell: false });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.on('exit', code => { if (code) this.state().then(state => { if (state.status === 'installing' && !state.workerPid) return this.store.write('updater', { ...state, status: 'failed', message: '更新程序未能启动，请查看 update.log。' }); }).catch(error => console.error(safeMessage(error))); });
      child.unref();
    } finally { await log.close(); }
  }
}
