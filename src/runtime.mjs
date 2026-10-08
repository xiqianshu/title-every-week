import { spawn } from 'node:child_process';

export function safeMessage(error) {
  return String(error?.message || error).replace(/Bearer\s+[^\s]+/gi, 'Bearer [隐藏]').replace(/sk-[A-Za-z0-9_-]{12,}/g, '[隐藏]').replace(/(PLAYWRIGHT_MCP_EXTENSION_TOKEN\s*[=:]\s*)[^\s]+/g, '$1[隐藏]').slice(0, 1800);
}

export function runProcess(command, args, { cwd, input = '', env = {}, timeoutMs = 120000, maxBytes = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', size = 0, failure = null, killTimer;
    const stop = message => {
      if (failure) return;
      failure = new Error(message);
      const kill = signal => {
        try { if (process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch {}
      };
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 500);
    };
    const timer = setTimeout(() => stop('任务超时，已停止本次执行；不会无限重试'), timeoutMs);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > maxBytes) stop('任务输出超过容量限制'); else stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000); });
    child.stdin.on('error', () => {});
    child.on('error', error => { clearTimeout(timer); clearTimeout(killTimer); reject(new Error('无法启动所需程序：' + safeMessage(error))); });
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(killTimer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(safeMessage(new Error(stderr.trim() || '程序退出，状态码 ' + code))));
      else resolve({ stdout, stderr, code });
    });
    child.stdin.end(input);
  });
}
