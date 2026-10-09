#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { Providers } from './providers.mjs';
import { Workflow } from './pipeline.mjs';
import { createServer } from './server.mjs';
import { installMac, notifyMac, APP_PORT } from './mac.mjs';
import { safeMessage, cancelProcesses } from './runtime.mjs';
import { Updater } from './updater.mjs';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const command = process.argv[2] || 'serve';
const option = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const dataRoot = path.resolve(option('--data') || path.join(appRoot, 'data'));
const store = new Store(dataRoot);
try {
  await store.init();
  const workflow = new Workflow(store, new Providers(appRoot, store), notifyMac);
  if (command === 'serve') {
    const updater = new Updater(appRoot, workflow);
    const tick = async () => { if (!await updater.busy()) await workflow.tick(); };
    const server = createServer(workflow, updater);
    server.listen(Number(option('--port') || APP_PORT), '127.0.0.1', () => {
      console.log('内容工作台已启动；数据目录：' + dataRoot);
      console.log('工作台端口：' + server.address().port);
      tick().catch(error => console.error(safeMessage(error)));
    });
    server.on('error', error => { console.error(safeMessage(error)); clearInterval(timer); cancelProcesses(); process.exitCode = 1; });
    const timer = setInterval(() => tick().catch(error => console.error(safeMessage(error))), 60000);
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { clearInterval(timer); cancelProcesses(); server.close(); setTimeout(() => process.exit(0), 1200); });
  } else if (command === 'install-mac') {
    await installMac(appRoot, dataRoot); console.log('后台已安装并响应，接下来在工作台完成浏览器连接与首次采集验收。');
  } else if (command === 'run') {
    const job = await workflow.run(process.argv[3] || 'collect');
    console.log(JSON.stringify(job, null, 2)); if (job.status === 'failed') process.exitCode = 1;
  } else if (command === 'init') console.log('本地配置已初始化；已有资料保持不变。');
  else throw new Error('支持 serve、install-mac、run、init');
} catch (error) { console.error(safeMessage(error)); process.exitCode = 1; }
