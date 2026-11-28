import { posix, win32 } from 'node:path';

const WINDOWS_DRIVE = /^[a-z]:[\\/]/i;
const WINDOWS_SHARE = /^[\\/]{2}[^\\/]+[\\/][^\\/]+/;

export const isWindowsDrivePath = (path: string): boolean => WINDOWS_DRIVE.test(path);

export function daemonPath(platform: string | null) {
  return platform === 'win32' ? win32 : posix;
}

export function isDaemonAbsolute(path: string, platform: string | null): boolean {
  if (!platform) return false;
  if (platform === 'win32') return isWindowsDrivePath(path) || WINDOWS_SHARE.test(path);
  return posix.isAbsolute(path);
}
