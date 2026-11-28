import { ipcMain, shell } from 'electron';
import { isAbsolute } from 'node:path';
import { appNotice } from '@shared/notice';
import type { startNotices } from './notifier';
import { INVOKE, SEND, type DesktopApi } from '@shared/ipc';
import { parseBuildInfo } from '@shared/buildInfo';
import { setConfigPassword } from './configPassword';
import type { openJobManager } from './jobManager';
import type { openMountManager } from './mountManager';
import { nativeFiles, remotePath } from './nativeFiles';
import { supportsLaunchAtLogin } from './paths';
import { describeFs, NO_CLOBBER, RcloneClient, remoteFs } from './rcloneClient';
import { managedPaths, type RcloneSupervisor } from './rcloneSupervisor';
import type { RcloneAuth } from './rcloneAuth';
import { generateSecret, type openRemotes } from './remoteService';
import { getSettings, readConfigPassword, updateSettings } from './settingsStore';
import { isQuitting, mainWindow } from './window';

declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;

interface Services {
  sendNotice: ReturnType<typeof startNotices>;
  daemon: RcloneSupervisor;
  mounts: ReturnType<typeof openMountManager>;
  jobs: ReturnType<typeof openJobManager>;
  auth: RcloneAuth;
  remotes: ReturnType<typeof openRemotes>;
  current: () => Awaited<ReturnType<DesktopApi['refresh']>>;
  refresh: DesktopApi['refresh'];
}

export function registerIpc({ daemon, mounts, jobs, auth, remotes, current, refresh, sendNotice }: Services): void {
  const isMain = (sender: Electron.WebContents) => sender === mainWindow()?.webContents;
  const invoke = <K extends keyof typeof INVOKE>(method: K, handler: DesktopApi[K]) => {
    ipcMain.handle(INVOKE[method], (event, ...args: Parameters<DesktopApi[K]>) => {
      if (!isMain(event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error('Invalid app window.');
      if (isQuitting()) throw new Error('The app is shutting down.');
      return (handler as (...args: Parameters<DesktopApi[K]>) => unknown)(...args);
    });
  };
  const send = (method: keyof typeof SEND, handler: (win: Electron.BrowserWindow) => void) => {
    ipcMain.on(SEND[method], (event) => {
      const win = mainWindow();
      if (win && isMain(event.sender) && event.senderFrame === event.sender.mainFrame) handler(win);
    });
  };
  const mutate = <Args extends unknown[], T>(action: (...args: Args) => T | Promise<T>) => async (...args: Args): Promise<T> => {
    const value = await action(...args);
    await refresh();
    return value;
  };
  invoke('initialize', () => Promise.resolve({
    settings: getSettings(), build: parseBuildInfo(__APP_VERSION__, __APP_BUILD__),
    snapshot: current(), launchAtLoginSupported: supportsLaunchAtLogin(), maximized: mainWindow()?.isMaximized() ?? false,
  }));
  invoke('refresh', async () => { await daemon.refreshLocal(); return refresh(); });
  invoke('updateGeneral', (patch) => Promise.resolve(updateSettings({ general: { ...getSettings().general, ...patch } })));
  invoke('updateNotifications', (patch) => Promise.resolve(updateSettings({ notifications: { ...getSettings().notifications, ...patch } })));
  invoke('noticePreview', () => {
    sendNotice(appNotice('preview', { title: 'Test notification', body: 'Notifications are ready for drive and transfer updates.' }));
    return Promise.resolve();
  });
  invoke('updateDaemon', async (patch) => {
    const config = { ...getSettings().daemon, ...patch };
    if (config.endpoint) new RcloneClient(config.endpoint);
    for (const path of [config.binaryPath, config.configPath, config.defaultCacheDir]) {
      if (path && (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0'))) throw new Error('Use an absolute path.');
    }
    const settings = updateSettings({ daemon: config });
    if (patch.binaryPath !== undefined || patch.configPath !== undefined) {
      await daemon.refreshLocal();
      await refresh();
    }
    return settings;
  });
  invoke('startDaemon', daemon.start);
  invoke('stopDaemon', daemon.stop);
  invoke('restartDaemon', daemon.restart);
  invoke('bandwidthLimit', async (rate) => {
    if (rate !== undefined && (typeof rate !== 'string' || !rate.trim())) throw new Error('Enter an rclone bandwidth rate.');
    const { rate: value } = await daemon.client().call('core/bwlimit', rate === undefined ? {} : { rate });
    if (rate !== undefined) {
      if (daemon.current().daemon.mode === 'managed') updateSettings({ daemon: { ...getSettings().daemon, bwLimit: rate } });
      await refresh();
    }
    return value;
  });
  invoke('completedTransfers', () => daemon.client().transferred());
  invoke('resetStats', mutate(async () => { await daemon.client().call('core/stats-reset'); }));
  invoke('listProviders', remotes.listProviders);
  invoke('createRemote', mutate(remotes.createRemote));
  invoke('updateRemote', mutate(remotes.updateRemote));
  invoke('deleteRemote', mutate(remotes.deleteRemote));
  invoke('testRemote', remotes.testRemote);
  invoke('createCryptRemote', mutate(remotes.createCryptRemote));
  invoke('generateSecret', (bits) => Promise.resolve(generateSecret(bits)));
  invoke('setConfigPassword', (password) => setConfigPassword(daemon, password));
  invoke('hasConfigPassword', async () => await readConfigPassword(managedPaths().configPath) !== null);
  invoke('startAuth', async (provider) => {
    const binary = daemon.current().daemon.binaryPath;
    if (!binary) throw new Error('The rclone executable could not be found.');
    if (!(await remotes.listProviders()).some((entry) => entry.name === provider && entry.isOAuth)) throw new Error('Unknown OAuth provider.');
    if (isQuitting()) throw new Error('The app is shutting down.');
    return auth.start(binary, provider);
  });
  invoke('authStatus', (id) => Promise.resolve(auth.status(id)));
  invoke('openAuth', (id) => shell.openExternal(auth.openUrl(id)));
  invoke('cancelAuth', auth.cancel);
  invoke('listMountProfiles', () => Promise.resolve(mounts.list()));
  invoke('saveMountProfile', mutate(mounts.save));
  invoke('deleteMountProfile', mutate(mounts.delete));
  invoke('mountProfile', mutate(mounts.mountProfile));
  invoke('unmount', mutate(mounts.unmount));
  invoke('unmountAll', mutate(mounts.unmountAll));
  invoke('revealMount', mounts.revealMount);
  invoke('mountTypes', async () => (await daemon.client().call('mount/types')).mountTypes ?? []);
  invoke('listVfs', async () => ((await daemon.client().call('vfs/list')).vfses ?? []).map((fs) => describeFs(fs, process.platform === 'win32').display));
  invoke('vfsStats', async (remote, path = '') => {
    const { inUse, metadataCache } = await daemon.forRemote(remote).call('vfs/stats', { fs: remoteFs(remote, remotePath(path, true)) });
    const cache = metadataCache as { files?: unknown; dirs?: unknown } | undefined;
    const count = (value: unknown) => typeof value === 'number' ? value : 0;
    return { inUse: count(inUse), files: count(cache?.files), dirs: count(cache?.dirs) };
  });
  invoke('vfsRefresh', async (remote, path = '', dir, recursive = false) => {
    await daemon.forRemote(remote).call('vfs/refresh', {
      fs: remoteFs(remote, remotePath(path, true)), ...(dir === undefined ? {} : { dir: remotePath(dir, true) }), recursive: String(recursive),
    });
  });
  invoke('vfsForget', async (remote, path = '', dir) => {
    await daemon.forRemote(remote).call('vfs/forget', { fs: remoteFs(remote, remotePath(path, true)), ...(dir === undefined ? {} : { dir: remotePath(dir, true) }) });
  });
  invoke('listJobs', () => Promise.resolve(jobs.list()));
  invoke('saveJob', (draft) => Promise.resolve(jobs.save(draft)));
  invoke('deleteJob', (id) => Promise.resolve(jobs.delete(id)));
  invoke('runJob', jobs.runJob);
  invoke('stopJob', jobs.stopJob);
  invoke('browse', (remote, path) => {
    const rc = daemon.forRemote(remote);
    const isCrypt = daemon.current().remotes.some((item) => item.name === remote && item.isCrypt);
    return rc.list(remote, remotePath(path, true), isCrypt);
  });
  invoke('quota', (remote) => daemon.forRemote(remote).quota(remote));
  invoke('stat', (remote, path) => daemon.forRemote(remote).stat(remote, remotePath(path, true)));
  for (const [method, command] of [['mkdir', 'operations/mkdir'], ['deleteFile', 'operations/deletefile'], ['purge', 'operations/purge']] as const) {
    invoke(method, async (remote, path) => { await daemon.forRemote(remote).call(command, { fs: remoteFs(remote), remote: remotePath(path) }); });
  }
  for (const [method, command] of [['copyFile', 'operations/copyfile'], ['moveFile', 'operations/movefile']] as const) {
    invoke(method, async (src, srcPath, dst, dstPath) => {
      const rc = daemon.forRemote(src);
      daemon.forRemote(dst);
      const from = remotePath(srcPath);
      const to = remotePath(dstPath);
      if (method === 'moveFile') {
        if (src === dst && from === to) return;
        await rc.requireMissingDestination(dst, to);
        if (daemon.forRemote(src) !== rc || daemon.forRemote(dst) !== rc) {
          throw new Error('The rclone daemon changed during move setup.');
        }
      }
      await rc.call(command, {
        srcFs: remoteFs(src), srcRemote: from, dstFs: remoteFs(dst), dstRemote: to,
        ...(method === 'moveFile' ? { _config: NO_CLOBBER } : {}),
      });
    });
  }
  invoke('moveDirectory', async (remote, source, destination) => {
    const rc = daemon.forRemote(remote);
    const from = remotePath(source);
    const to = remotePath(destination);
    if (from === to) return;
    if (to.startsWith(from + '/') || from.startsWith(to + '/')) throw new Error('Choose a destination outside the source tree.');
    await rc.requireMissingDestination(remote, to);
    if (daemon.forRemote(remote) !== rc) throw new Error('The rclone daemon changed during move setup.');
    await rc.call('sync/move', {
      srcFs: remoteFs(remote, from), dstFs: remoteFs(remote, to),
      createEmptySrcDirs: true, deleteEmptySrcDirs: true, _config: NO_CLOBBER,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'The move failed.';
      throw new Error(`${message} Some files may have moved. Check both folders before retrying.`);
    });
  });
  const native = nativeFiles(daemon);
  for (const method of ['pickDirectory', 'pickRcloneBinary', 'uploadFiles', 'downloadFile', 'openExternal', 'openPath'] as const) {
    invoke(method, native[method]);
  }
  send('minimize', (win) => win.minimize());
  send('toggleMaximize', (win) => { if (win.isMaximized()) win.unmaximize(); else win.maximize(); });
  send('closeWindow', (win) => win.close());
}
