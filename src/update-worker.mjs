import { Store } from './store.mjs';
import { installUpdate } from './update-installer.mjs';
import { safeMessage } from './runtime.mjs';

try {
  const [appRoot, dataRoot] = process.argv.slice(2);
  if (process.platform !== 'darwin' || !appRoot || !dataRoot) throw new Error('后台更新仅用于已安装的 Mac 工作台');
  const store = new Store(dataRoot), state = await store.read('updater');
  if (state.status !== 'installing') throw new Error('没有已启动的更新任务');
  await installUpdate({ appRoot, dataRoot, release: state.release });
} catch (error) { console.error(safeMessage(error)); process.exitCode = 1; }
