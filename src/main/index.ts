import './identity';
import { app, nativeTheme } from 'electron';
import { EVENTS } from '@shared/ipc';
import { appNotice } from '@shared/notice';
import { installAppMenu } from './appMenu';
import { openDaemon } from './daemon';
import { registerIpc } from './ipc';
import { startNotices } from './notifier';
import { getSettings, onSettingsChange } from './settingsStore';
import { createTray } from './tray';
import { createMainWindow, mainWindow, markQuitting, showMainWindow, syncWindowBackground } from './window';

const POLL_INTERVAL_MS = 5_000;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (app.isReady()) showMainWindow(); });
  app.on('before-quit', markQuitting);
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

  void app.whenReady().then(() => {
    const daemon = openDaemon();
    const notify = startNotices();
    const updateTray = createTray();
    let announcedError: string | null = null;
    const refresh = async () => {
      const snapshot = await daemon.refresh();
      updateTray?.(snapshot.daemon.state);
      mainWindow()?.webContents.send(EVENTS.onSnapshot, snapshot);
      const { error } = snapshot.daemon;
      if (error && error !== announcedError && getSettings().notifications.daemonErrors) {
        notify(appNotice('daemonError', { title: 'rclone connection failed', body: error }));
      }
      announcedError = error;
      return snapshot;
    };
    const poll = () => { void refresh().catch((error: unknown) => console.error('[rclone]', error)); };
    updateTray?.(daemon.current().daemon.state);
    installAppMenu();
    registerIpc(daemon, refresh);
    onSettingsChange((settings) => {
      syncWindowBackground();
      mainWindow()?.webContents.send(EVENTS.onSettings, settings);
    });
    nativeTheme.on('updated', syncWindowBackground);
    createMainWindow();
    app.on('activate', showMainWindow);
    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    app.once('before-quit', () => clearInterval(timer));
  }).catch((error: unknown) => {
    console.error('[startup]', error);
    app.exit(1);
  });
}
