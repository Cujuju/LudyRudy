import { ipcMain } from 'electron';
import { INVOKE, SEND, type DesktopApi } from '@shared/ipc';
import { parseBuildInfo } from '@shared/buildInfo';
import type { openDaemon } from './daemon';
import { getSettings, updateGeneral } from './settingsStore';
import { mainWindow } from './window';

declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;

export function registerIpc(daemon: ReturnType<typeof openDaemon>, refresh: DesktopApi['refresh']): void {
  const isMain = (sender: Electron.WebContents) => sender === mainWindow()?.webContents;
  const invoke = <K extends keyof typeof INVOKE>(method: K, handler: DesktopApi[K]) => {
    ipcMain.handle(INVOKE[method], (event, ...args: Parameters<DesktopApi[K]>) => {
      if (!isMain(event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error('Invalid app window.');
      return (handler as (...args: Parameters<DesktopApi[K]>) => unknown)(...args);
    });
  };
  const send = (method: keyof typeof SEND, handler: (win: Electron.BrowserWindow) => void) => {
    ipcMain.on(SEND[method], (event) => {
      const win = mainWindow();
      if (win && isMain(event.sender) && event.senderFrame === event.sender.mainFrame) handler(win);
    });
  };
  invoke('initialize', () => Promise.resolve({
    settings: getSettings(), build: parseBuildInfo(__APP_VERSION__, __APP_BUILD__),
    snapshot: daemon.current(), maximized: mainWindow()?.isMaximized() ?? false,
  }));
  invoke('refresh', refresh);
  invoke('updateGeneral', (patch) => Promise.resolve(updateGeneral(patch)));
  invoke('browse', (remote, path) => {
    if (typeof path !== 'string') throw new Error('Invalid remote path.');
    return daemon.forRemote(remote).list(remote, path);
  });
  invoke('quota', (remote) => daemon.forRemote(remote).quota(remote));
  send('minimize', (win) => win.minimize());
  send('toggleMaximize', (win) => { if (win.isMaximized()) win.unmaximize(); else win.maximize(); });
  send('closeWindow', (win) => win.close());
}
