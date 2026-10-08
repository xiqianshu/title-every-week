import path from 'node:path';
import { homedir } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { runProcess } from './runtime.mjs';

export const APP_PORT = 38473;
export const AGENT_LABEL = 'com.creatorworkflow.local';
const xml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function makeLaunchAgent({ node = process.execPath, appRoot, dataRoot }) {
  const args = [node, path.join(appRoot, 'src', 'cli.mjs'), 'serve', '--data', dataRoot];
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n' +
    '<key>Label</key><string>' + AGENT_LABEL + '</string>\n<key>ProgramArguments</key><array>' + args.map(a => '<string>' + xml(a) + '</string>').join('') + '</array>\n' +
    '<key>WorkingDirectory</key><string>' + xml(appRoot) + '</string>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><true/>\n<key>ThrottleInterval</key><integer>30</integer>\n' +
    '<key>StandardOutPath</key><string>' + xml(path.join(dataRoot, 'service.log')) + '</string>\n<key>StandardErrorPath</key><string>' + xml(path.join(dataRoot, 'service-error.log')) + '</string>\n</dict></plist>\n';
}

export async function installMac(appRoot, dataRoot) {
  if (process.platform !== 'darwin') throw new Error('后台安装入口仅用于 macOS；当前环境可运行测试与本地服务');
  const directory = path.join(homedir(), 'Library', 'LaunchAgents');
  await mkdir(directory, { recursive: true });
  const plist = path.join(directory, AGENT_LABEL + '.plist');
  await writeFile(plist, makeLaunchAgent({ appRoot, dataRoot }), { mode: 0o600 });
  const domain = 'gui/' + process.getuid();
  await runProcess('/bin/launchctl', ['bootout', domain + '/' + AGENT_LABEL], { timeoutMs: 10000 }).catch(() => {});
  await runProcess('/bin/launchctl', ['enable', domain + '/' + AGENT_LABEL], { timeoutMs: 10000 });
  await runProcess('/bin/launchctl', ['bootstrap', domain, plist], { timeoutMs: 15000 });
  for (let attempt = 0; attempt < 20; attempt++) {
    try { const response = await fetch('http://127.0.0.1:' + APP_PORT + '/api/status', { signal: AbortSignal.timeout(1000) }); if (response.ok && (await response.json()).application === 'creator-workflow') return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('后台服务尚未响应，请查看安装目录 data/service-error.log；安装状态不能视为已完成');
}

export async function notifyMac(title, text) {
  if (process.platform !== 'darwin') return;
  const quote = value => JSON.stringify(String(value));
  await runProcess('/usr/bin/osascript', ['-e', 'display notification ' + quote(text) + ' with title ' + quote(title)], { timeoutMs: 10000 });
}
