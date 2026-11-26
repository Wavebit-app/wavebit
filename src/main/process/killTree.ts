import { spawnSync, type ChildProcess } from 'node:child_process';

/** yt-dlp starts Deno and more; on Windows a survivor would lock its .exe. */
export function killTree(child: ChildProcess): void {
  if (process.platform !== 'win32' || !child.pid) {
    child.kill();
    return;
  }
  const taskkill = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\taskkill.exe`;
  spawnSync(taskkill, ['/PID', String(child.pid), '/T', '/F'], {
    windowsHide: true,
  });
}
