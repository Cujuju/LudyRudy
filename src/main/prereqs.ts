import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import type { PrereqStatus } from '@shared/types';

const BINARY_PROBE_TIMEOUT_MS = 3_000;
const FUSE_T_PATHS = [
  '/Library/Application Support/fuse-t', '/Library/Frameworks/fuse_t.framework',
  '/usr/local/bin/go-nfsv4', '/opt/homebrew/bin/go-nfsv4',
];
const MAC_FUSE_PATHS = ['/Library/Filesystems/macfuse.fs', '/Library/Filesystems/osxfuse.fs'];

export function localVersion(path: string | null): Promise<string | null> {
  if (!path) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(path, ['version'], { encoding: 'utf8', timeout: BINARY_PROBE_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      resolve(error ? null : /^rclone (v\S+)/m.exec(stdout)?.[1] ?? null);
    });
  });
}

export function mountBackend(platform = process.platform, exists: (path: string) => boolean = existsSync, env = process.env): PrereqStatus['mountBackend'] {
  if (platform === 'darwin') {
    const fuseT = FUSE_T_PATHS.some(exists);
    const macFuse = MAC_FUSE_PATHS.some(exists);
    const installed = [fuseT && 'FUSE-T', macFuse && 'macFUSE'].filter(Boolean).join(' and ');
    return {
      available: fuseT || macFuse, name: fuseT || !macFuse ? 'FUSE-T' : 'macFUSE',
      details: `${installed ? `Detected ${installed}.` : 'FUSE-T is available without a kernel extension.'} The rclone nfsmount command is also available on macOS.`,
      installUrl: fuseT || !macFuse ? 'https://www.fuse-t.org/' : 'https://macfuse.io/',
    };
  }
  if (platform === 'win32') {
    const roots = [env['ProgramFiles(x86)'], env.ProgramFiles].filter((root): root is string => !!root);
    const available = roots.some((root) => {
      const bin = win32.join(root, 'WinFsp', 'bin');
      return exists(win32.join(bin, 'winfsp-x64.dll')) || exists(win32.join(bin, 'winfsp-a64.dll')) || exists(win32.join(bin, 'winfsp-x86.dll')) || exists(bin);
    });
    return { available, name: 'WinFsp', details: available ? 'Detected WinFsp.' : 'WinFsp was not found.', installUrl: 'https://winfsp.dev/' };
  }
  if (platform === 'linux') {
    const device = exists('/dev/fuse');
    const helpers = (env.PATH ?? '').split(posix.delimiter).filter(posix.isAbsolute);
    const helper = helpers.some((dir) => ['fusermount3', 'fusermount'].some((name) => exists(posix.join(dir, name))));
    return {
      available: device && helper, name: 'FUSE',
      details: [device ? '/dev/fuse detected' : '/dev/fuse missing', helper ? 'FUSE mount helper detected' : 'fusermount3/fusermount missing'].join(', ') + '.',
      installUrl: 'https://rclone.org/commands/rclone_mount/',
    };
  }
  return { available: false, name: 'FUSE', details: 'Unsupported platform', installUrl: '' };
}
