import { dialog, shell } from 'electron';
import { basename, dirname, posix, win32 } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { UploadResult } from '@shared/ipc';
import { errorMessage, managedPaths, type RcloneSupervisor } from './rcloneSupervisor';
import { NO_CLOBBER, remoteFs } from './rcloneClient';
import { profileFile } from './paths';
import { mainWindow } from './window';

async function withDialogFocus<T>(open: (parent: ReturnType<typeof mainWindow>) => Promise<T>): Promise<T> {
  const parent = mainWindow();
  try {
    return await open(parent);
  } finally {
    if (parent && !parent.isDestroyed()) {
      parent.focus();
      parent.webContents.focus();
    }
  }
}

function openDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  return withDialogFocus((parent) => parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options));
}

export function remotePath(path: unknown, allowRoot = false): string {
  if (typeof path !== 'string' || /[\0\r\n]/.test(path) || path.includes('\\') || path.startsWith('/') || path.split('/').includes('..')) {
    throw new Error('Invalid remote path.');
  }
  const normalized = posix.normalize(path).replace(/\/$/, '');
  if (normalized === '.' && !allowRoot) throw new Error('Select a file or directory below the remote root.');
  return normalized === '.' ? '' : normalized;
}

export function nativeFiles(daemon: RcloneSupervisor) {
  function localTransfer(remote: string) {
    if (daemon.current().daemon.mode !== 'managed') throw new Error('Native file transfers require the managed daemon.');
    return daemon.forRemote(remote);
  }

  return {
    async pickDirectory(): Promise<string | null> {
      const { filePaths, canceled } = await openDialog({ properties: ['openDirectory', 'createDirectory'] });
      return canceled ? null : filePaths[0] ?? null;
    },
    async pickRcloneBinary(): Promise<string | null> {
      const { filePaths, canceled } = await openDialog({
        properties: ['openFile'], ...(process.platform === 'win32' ? { filters: [{ name: 'Executable', extensions: ['exe'] }] } : {}),
      });
      return canceled ? null : filePaths[0] ?? null;
    },
    async uploadFiles(remote: string, directory: string): Promise<UploadResult> {
      const path = remotePath(directory, true);
      const rc = localTransfer(remote);
      const { filePaths, canceled } = await openDialog({ properties: ['openFile', 'multiSelections'] });
      const uploaded: string[] = [];
      if (canceled) return { uploaded };
      if (rc !== localTransfer(remote)) throw new Error('The rclone daemon changed while choosing files.');
      const names = filePaths.map((file) => basename(file));
      if (new Set(names).size !== names.length) throw new Error('Choose files with distinct names.');
      for (const name of names) {
        await rc.requireMissingDestination(remote, posix.join(path, name));
      }
      for (const [index, file] of filePaths.entries()) {
        const name = basename(file);
        try {
          if (rc !== localTransfer(remote)) throw new Error('The rclone daemon changed during upload.');
          await rc.call('operations/copyfile', {
            srcFs: dirname(file), srcRemote: name, dstFs: remoteFs(remote), dstRemote: posix.join(path, name), _config: NO_CLOBBER,
          });
          uploaded.push(name);
        } catch (error) {
          return {
            uploaded, skipped: names.slice(index + 1),
            failure: { file: name, message: errorMessage(error) },
          };
        }
      }
      return { uploaded };
    },
    async downloadFile(remote: string, source: string, suggestedName?: string): Promise<boolean> {
      const path = remotePath(source);
      const rc = localTransfer(remote);
      const fallback = posix.basename(path);
      const defaultPath = win32.basename(suggestedName || fallback).replace(/[\x00-\x1f]/g, '');
      const options = { defaultPath: defaultPath && !['.', '..'].includes(defaultPath) ? defaultPath : fallback };
      const { filePath, canceled } = await withDialogFocus((parent) =>
        parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options));
      if (canceled || !filePath) return false;
      if (rc !== localTransfer(remote)) throw new Error('The rclone daemon changed while choosing where to save the file.');
      await rc.call('operations/copyfile', { srcFs: remoteFs(remote), srcRemote: path, dstFs: dirname(filePath), dstRemote: basename(filePath) });
      return true;
    },
    async openExternal(value: string): Promise<void> {
      const url = typeof value === 'string' ? URL.parse(value) : null;
      if (url?.protocol !== 'https:' || url.username || url.password) throw new Error('Only HTTPS links are allowed.');
      await shell.openExternal(url.href);
    },
    async openPath(kind: 'config' | 'cache' | 'data'): Promise<void> {
      const { configPath, cacheDir } = managedPaths();
      const paths = { config: dirname(configPath), cache: cacheDir, data: profileFile('') };
      if (!Object.hasOwn(paths, kind)) throw new Error('Unknown application directory.');
      const path = paths[kind];
      await mkdir(path, { recursive: true });
      if (await shell.openPath(path)) throw new Error('Could not open the application directory.');
    },
  };
}
