import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { crc32, deflateRawSync } from 'node:zlib';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Store } from '../src/store.mjs';

const releaseModule = await import('../src/update-release.mjs').catch(() => ({}));
const archiveModule = await import('../src/update-archive.mjs').catch(() => ({}));
const installerModule = await import('../src/update-installer.mjs').catch(() => ({}));
const managerModule = await import('../src/updater.mjs').catch(() => ({}));
const commit = 'a'.repeat(40);

function zip(entries) {
  const locals = [], central = []; let offset = 0;
  for (const [name, text, mode = 0o100644, compress = false] of entries) {
    const filename = Buffer.from('内容工作台/' + name), data = Buffer.from(text), packed = compress ? deflateRawSync(data) : data;
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x800, 6);
    head.writeUInt16LE(compress ? 8 : 0, 8); head.writeUInt32LE(crc32(data), 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(filename.length, 26);
    locals.push(head, filename, packed);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(0x314, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x800, 8);
    record.writeUInt16LE(compress ? 8 : 0, 10); record.writeUInt32LE(crc32(data), 16); record.writeUInt32LE(packed.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE((mode << 16) >>> 0, 38); record.writeUInt32LE(offset, 42); central.push(record, filename); offset += head.length + filename.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
function packageEntries(version = '0.3.0') {
  return [
    ['package.json', JSON.stringify({ name: 'creator-workflow', version, type: 'module' })], ['package-lock.json', '{}'],
    ['src/cli.mjs', '// new program'], ['src/update-worker.mjs', '// updater'],
    ['public/index.html', '<p>new</p>'], ['public/app.js', '// ui'], ['public/styles.css', 'body{}'],
    ['schemas/collection.json', '{"type":"object"}'], ['schemas/weekly.json', '{"type":"object"}'], ['schemas/review.json', '{"type":"object"}'],
  ];
}
const bytes = zip(packageEntries());
const release = { version: '0.3.0', commit, sha256: createHash('sha256').update(bytes).digest('hex') };
const fetcher = async () => new Response(bytes);

async function installation() {
  const parent = await mkdtemp(path.join(tmpdir(), 'creator-updater-'));
  const appRoot = path.join(parent, 'automation'), dataRoot = path.join(appRoot, 'data');
  await mkdir(path.join(appRoot, 'node_modules'), { recursive: true });
  await writeFile(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'creator-workflow', version: '0.2.0' }));
  await writeFile(path.join(appRoot, 'old-program'), 'original code');
  await writeFile(path.join(appRoot, 'node_modules', 'old-dependency'), 'original dependency');
  const store = new Store(dataRoot); await store.init();
  await store.write('secrets', { playwrightToken: 'private-local-token' });
  await store.write('notes', [{ id: 'n1', text: '真实素材' }]);
  await store.saveReport('old-report', {}, '已有报告');
  return { parent, appRoot, dataRoot, store, close: () => rm(parent, { recursive: true, force: true }) };
}

test('update metadata uses a fixed repository and an immutable, validated release', async () => {
  assert.equal(typeof releaseModule.readLatestRelease, 'function');
  const urls = [];
  const actual = await releaseModule.readLatestRelease(async url => { urls.push(String(url)); return new Response(JSON.stringify(release)); });
  assert.deepEqual(actual, release);
  assert.match(urls[0], /^https:\/\/github\.com\/xiqianshu\/title-every-week\/raw\//);
  assert.ok(releaseModule.newerVersion('0.3.0', '0.2.0'));
  assert.ok(!releaseModule.newerVersion('0.2.0', '0.3.0'));
  assert.throws(() => releaseModule.validateRelease({ ...release, commit: '../main' }));
  assert.throws(() => releaseModule.validateRelease({ ...release, version: 'latest' }));
  await assert.rejects(releaseModule.readLatestRelease(async () => new Response('', { status: 503 })), /503/);
});

test('downloaded update checksum must match before extraction or installation', async () => {
  assert.equal(typeof releaseModule.downloadPackage, 'function');
  await assert.rejects(releaseModule.downloadPackage(release, async () => new Response('tampered')), /校验/);
  assert.deepEqual(await releaseModule.downloadPackage(release, fetcher), bytes);
});

test('curl transport bounds streamed bytes independently of Content-Length and preserves binary output', async () => {
  const binary = Buffer.from([255, 0, 128]); let kills = 0;
  const launcher = payload => () => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { kills++; queueMicrotask(() => child.emit('close', 143)); };
    queueMicrotask(() => { child.stdout.write(payload); if (payload.length < 16000) child.emit('close', 0); });
    return child;
  };
  const response = await releaseModule.githubFetch('https://github.com/xiqianshu/title-every-week/raw/test/file.zip', { launcher: launcher(binary) });
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), binary);
  await assert.rejects(releaseModule.githubFetch('https://github.com/xiqianshu/title-every-week/raw/test/latest.json', { launcher: launcher(Buffer.alloc(16001)) }), /容量/);
  assert.equal(kills, 1);
});

test('Mac background download uses the system HTTPS proxy when launchd has no proxy environment', async () => {
  let args, proxyReads=0;
  const launcher=(command,input)=>{
    args=input;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
    queueMicrotask(()=>{child.stdout.write('downloaded');child.emit('close',0);});return child;
  };
  const proxyReader=async()=>{proxyReads++;return {stdout:'<dictionary> {\n HTTPSEnable : 1\n HTTPSProxy : 127.0.0.1\n HTTPSPort : 7890\n}'};};
  await releaseModule.githubFetch('https://github.com/xiqianshu/title-every-week/raw/test/file.zip',{launcher,platform:'darwin',env:{},proxyReader});
  assert.equal(proxyReads,1);assert.equal(args[args.indexOf('--proxy')+1],'http://127.0.0.1:7890');
  assert.ok(!args.includes('--insecure'));
  proxyReads=0;
  await releaseModule.githubFetch('https://github.com/xiqianshu/title-every-week/raw/test/file.zip',{launcher,platform:'darwin',env:{HTTPS_PROXY:'http://localhost:9999'},proxyReader});
  assert.equal(proxyReads,0);assert.ok(!args.includes('--proxy'),'explicit proxy environments retain precedence');
});

test('system proxy parsing supports SOCKS DNS and rejects invalid proxy settings',()=>{
  assert.deepEqual(releaseModule.macProxyArgs('SOCKSEnable : 1\nSOCKSProxy : ::1\nSOCKSPort : 7891'),['--proxy','socks5h://[::1]:7891']);
  for(const input of ['HTTPSEnable : 0\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 7890','HTTPSEnable : 1\nHTTPSProxy : user@host\nHTTPSPort : 7890','HTTPSEnable : 1\nHTTPSProxy : localhost\nHTTPSPort : 99999'])assert.deepEqual(releaseModule.macProxyArgs(input),[]);
});

test('package extraction rejects traversal, symlinks, duplicates and oversized output', async () => {
  assert.equal(typeof archiveModule.extractPackage, 'function');
  const root = await mkdtemp(path.join(tmpdir(), 'creator-zip-test-'));
  try {
    for (const [entries, reason] of [
      [[['../../escape', 'x']], /路径/], [[['src/link.mjs', 'target', 0o120777]], /不支持/],
      [[['src/a.mjs', 'a'], ['src/a.mjs', 'b']], /重复/], [[['src/large.mjs', 'x'.repeat(9 * 1024 * 1024), 0o100644, true]], /容量/],
    ]) {
      await assert.rejects(archiveModule.extractPackage(zip([...packageEntries(), ...entries]), root), reason);
    }
    const corrupt = Buffer.from(bytes); corrupt[corrupt.indexOf('// new program')] ^= 1;
    await assert.rejects(archiveModule.extractPackage(corrupt, root), /校验/);
    await assert.rejects(archiveModule.extractPackage(zip(packageEntries().filter(e => e[0] !== 'schemas/review.json')), root), /所需程序文件/);
    await assert.rejects(archiveModule.extractPackage(zip(packageEntries().map(e => e[0] === 'schemas/review.json' ? [e[0], 'bad JSON'] : e)), root), /schema|格式/);
    await archiveModule.extractPackage(bytes, root);
    assert.match(await readFile(path.join(root, 'src/cli.mjs'), 'utf8'), /new program/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('successful update prepares first, preserves personal files and restarts the new program', async () => {
  assert.equal(typeof installerModule.installUpdate, 'function');
  const env = await installation(), steps = [];
  try {
    await installerModule.installUpdate({ ...env, release, fetcher,
      prepare: async candidate => { steps.push('prepare'); assert.equal(await readFile(path.join(env.appRoot, 'old-program'), 'utf8'), 'original code'); await mkdir(path.join(candidate, 'node_modules')); },
      stop: async () => { steps.push('stop'); },
      start: async () => { steps.push('start'); assert.equal(JSON.parse(await readFile(path.join(env.appRoot, 'package.json'), 'utf8')).version, '0.3.0'); },
    });
    assert.deepEqual(steps, ['prepare', 'stop', 'start']);
    assert.equal((await env.store.read('secrets')).playwrightToken, 'private-local-token');
    assert.equal((await env.store.read('notes'))[0].text, '真实素材');
    assert.equal(await readFile(path.join(env.dataRoot, 'reports', 'old-report.md'), 'utf8'), '已有报告');
    assert.equal((await env.store.read('updater')).status, 'success');
    await assert.rejects(readFile(path.join(env.appRoot, 'old-program')), /ENOENT/);
  } finally { await env.close(); }
});

test('failed activation restores original program, dependencies and all personal data', async () => {
  const env = await installation(); let starts = 0;
  try {
    await assert.rejects(installerModule.installUpdate({ ...env, release, fetcher,
      prepare: async candidate => { await mkdir(path.join(candidate, 'node_modules')); }, stop: async () => {},
      start: async () => { if (++starts === 1) throw new Error('新版启动失败'); },
    }), /新版启动失败/);
    assert.equal(starts, 2);
    assert.equal(await readFile(path.join(env.appRoot, 'old-program'), 'utf8'), 'original code');
    assert.equal(await readFile(path.join(env.appRoot, 'node_modules', 'old-dependency'), 'utf8'), 'original dependency');
    assert.equal((await env.store.read('secrets')).playwrightToken, 'private-local-token');
    assert.equal((await env.store.read('notes'))[0].text, '真实素材');
    assert.equal((await env.store.read('updater')).status, 'failed');
    await env.store.lock().then(releaseLock => releaseLock());
  } finally { await env.close(); }
});

test('bad checksum leaves the running installation intact', async () => {
  const env = await installation(); let stopped = false;
  try {
    await assert.rejects(installerModule.installUpdate({ ...env, release, fetcher: async () => new Response('bad'), prepare: async () => {}, stop: async () => { stopped = true; }, start: async () => {} }), /校验/);
    assert.equal(stopped, false);
    assert.equal(await readFile(path.join(env.appRoot, 'old-program'), 'utf8'), 'original code');
    assert.equal((await env.store.read('notes'))[0].text, '真实素材');
  } finally { await env.close(); }
});

test('dependency preparation requires a functional staged Codex even when npm succeeds', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'creator-update-deps-'));
  const calls = [];
  try {
    for (const file of ['@openai/codex/bin/codex.js', '@playwright/mcp/cli.js', '@jackwener/opencli/dist/src/main.js']) {
      const target = path.join(root, 'node_modules', file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, '// fixture');
    }
    const runner = async (command, args) => { calls.push({ command, args }); return { stdout: 'unusable command', stderr: '', code: 0 }; };
    await assert.rejects(installerModule.prepareDependencies(root, path.join(root, 'data'), runner), /Codex/);
    assert.equal(calls[0].command, process.execPath);
    assert.ok(path.isAbsolute(calls[0].args[0]));
    assert.equal(calls[1].command, process.execPath);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failed dependency staging keeps the old service and personal data intact', async () => {
  const env = await installation(); let stopped = false;
  try {
    await assert.rejects(installerModule.installUpdate({ ...env, release, fetcher, prepare: async () => { throw new Error('依赖准备失败'); }, stop: async () => { stopped = true; }, start: async () => {} }), /依赖准备失败/);
    assert.equal(stopped, false);
    assert.equal(await readFile(path.join(env.appRoot, 'old-program'), 'utf8'), 'original code');
    assert.equal((await env.store.read('secrets')).playwrightToken, 'private-local-token');
  } finally { await env.close(); }
});

test('checking cannot overwrite an active installation or allow concurrent installation', async () => {
  const env = await installation(); let complete, started;
  const gate = new Promise(resolve => { complete = resolve; }), entered = new Promise(resolve => { started = resolve; });
  try {
    const updater = new managerModule.Updater(env.appRoot, { store: env.store, busy: false }, { supported: true, fetcher: async () => { started(); await gate; return new Response(JSON.stringify(release)); }, launch: async () => {} });
    const check = updater.check(); await entered;
    await assert.rejects(updater.install(), /正在检查/);
    await assert.rejects(updater.check(), /正在检查/);
    complete(); await check;
    await updater.install();
    await assert.rejects(updater.check(), /正在安装/);
    assert.equal((await env.store.read('updater')).status, 'installing');
  } finally { complete(); await env.close(); }
});

test('updates cannot interrupt an active content task and launch only once per click', async () => {
  assert.equal(typeof managerModule.Updater, 'function');
  const env = await installation(); let launched = 0;
  const workflow = { store: env.store, busy: true };
  try {
    const updater = new managerModule.Updater(env.appRoot, workflow, { supported: true, fetcher: async () => new Response(JSON.stringify(release)), launch: async () => { launched++; } });
    await updater.check();
    await assert.rejects(updater.install(), /任务/);
    workflow.busy = false;
    const results = await Promise.allSettled([updater.install(), updater.install()]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(launched, 1);
    assert.equal((await updater.status()).busy, true);
    await assert.rejects(updater.install(), /已启动/);
    assert.equal((await updater.status()).busy, true, 'A repeated click must not clear the active update marker');
  } finally { await env.close(); }
});
