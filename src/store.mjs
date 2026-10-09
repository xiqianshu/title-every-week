import { mkdir, readFile, writeFile, rename, open, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultConfig } from './model.mjs';

export class Store {
  constructor(root) { this.root = path.resolve(root); this.updates = new Map(); }
  file(name) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('无效的数据名称');
    return path.join(this.root, name + '.json');
  }
  async init() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await mkdir(path.join(this.root, 'reports'), { recursive: true, mode: 0o700 });
    await mkdir(path.join(this.root, 'runs'), { recursive: true, mode: 0o700 });
    const defaults = { config: defaultConfig(), secrets: { playwrightToken: '' }, notes: [], posts: [], items: [], snapshots: [], jobs: [], updater: { status: 'idle', message: '' }, state: { lastDaily: null, lastWeekly: null } };
    for (const [name, value] of Object.entries(defaults)) {
      try { await writeFile(this.file(name), JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 }); }
      catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
  }
  async read(name) { return JSON.parse(await readFile(this.file(name), 'utf8')); }
  async update(name, transform) {
    const previous = this.updates.get(name) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      const value = await transform(await this.read(name));
      await this.write(name, value);
      return value;
    });
    this.updates.set(name, current);
    try { return await current; } finally { if (this.updates.get(name) === current) this.updates.delete(name); }
  }
  async write(name, value) {
    const target = this.file(name);
    const temporary = target + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(temporary, target);
  }
  async saveReport(id, data, markdown) {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error('无效的报告名称');
    for (const [extension, content] of [['json', JSON.stringify(data, null, 2)], ['md', markdown]]) {
      const target = path.join(this.root, 'reports', id + '.' + extension);
      const temporary = target + '.tmp';
      await writeFile(temporary, content, { mode: 0o600 });
      await rename(temporary, target);
    }
    return id;
  }
  async lock() {
    const file = path.join(this.root, 'job.lock');
    const claim = async () => {
      const handle = await open(file, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      await handle.close();
    };
    try { await claim(); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        const owner = JSON.parse(await readFile(file, 'utf8'));
        try { process.kill(owner.pid, 0); } catch (e) { stale = e.code === 'ESRCH'; }
      } catch { stale = Date.now() - (await stat(file)).mtimeMs > 60000; }
      if (!stale) throw new Error('已有任务正在运行，请在工作台查看进度');
      await unlink(file);
      await claim();
    }
    return async () => { await unlink(file).catch(e => { if (e.code !== 'ENOENT') throw e; }); };
  }
}
