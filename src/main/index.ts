import './identity';
import { app, nativeTheme, shell } from 'electron';
import { APP_NAME } from '@shared/app';
import { EVENTS } from '@shared/ipc';
import { appNotice } from '@shared/notice';
import { minuteToClock, setHourCycle } from '@shared/timeFormat';
import { installAppMenu } from './appMenu';
import { systemHourCycle } from './hourCycle';
import { registerIpc } from './ipc';
import { openJobManager } from './jobManager';
import { openMountManager, type Notify } from './mountManager';
import { startNotices } from './notifier';
import { openAuth } from './rcloneAuth';
import { errorMessage, openDaemon } from './rcloneSupervisor';
import { openRemotes } from './remoteService';
import { getSettings, onSettingsChange, updateSettings } from './settingsStore';
import { createTray } from './tray';
import { startUpdateInstaller } from './updateInstaller';
import { updates } from './updater';
import { createMainWindow, isQuitting, mainWindow, markQuitting, showMainWindow, syncWindowBackground } from './window';

const POLL_INTERVAL_MS = 2_000;
let lastLoginSettings: string | undefined;
const LOGIN_MINIMIZED_ARG = '--login-minimized';

// Dev loads package.json, which has no real version; packaged builds carry it (electron-builder.ts).
if (!app.isPackaged) app.setVersion(__APP_VERSION__);

function applyLoginSettings(): void {
  if (!app.isPackaged || app.commandLine.hasSwitch('user-data-dir') || process.platform === 'linux') return;
  const { launchAtLogin, startMinimized } = getSettings().general;
  const signature = JSON.stringify([launchAtLogin, startMinimized]);
  if (lastLoginSettings === signature) return;
  app.setLoginItemSettings({
    openAtLogin: launchAtLogin,
    ...(process.platform === 'win32' ? { args: startMinimized ? [LOGIN_MINIMIZED_ARG] : [] } : {}),
  });
  lastLoginSettings = signature;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (app.isReady()) showMainWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

  void app.whenReady().then(() => {
    setHourCycle(systemHourCycle());
    const send = (channel: string, payload: unknown) => {
      if (!isQuitting()) mainWindow()?.webContents.send(channel, payload);
    };
    const notices = startNotices();
    const sendNotice = notices.notify;
    const notify: Notify = (kind, title, body) => sendNotice(appNotice(kind, { title, body }));
    const daemon = openDaemon({
      log: (entry) => send(EVENTS.onLog, entry), change: () => publish(),
      crashed: () => {
        if (getSettings().notifications.daemonErrors) notify('daemonCrashed', 'rclone stopped unexpectedly', 'Restart the daemon to reconnect.');
      },
      ready: () => {
        void mounts.autoMount().then(() => refresh()).catch(report);
      },
    });
    const auth = openAuth((session) => send(EVENTS.onAuth, session));
    const remotes = openRemotes(daemon.client, auth);
    const mounts = openMountManager({
      client: daemon.client, profiles: () => getSettings().mounts, save: (mounts) => { updateSettings({ mounts }); },
      defaults: () => getSettings().daemon.defaultVfsCacheMode, managed: () => daemon.current().daemon.mode === 'managed',
      reveal: (path) => shell.openPath(path), notify,
    });
    const jobs = openJobManager({
      client: daemon.client, jobs: () => getSettings().jobs, save: (jobs) => { updateSettings({ jobs }); },
      notify, change: () => publish(),
    });
    const current = () => ({ ...daemon.current(), jobRuns: jobs.runs() });
    const refresh = async () => {
      await Promise.all([daemon.refresh(), jobs.poll()]);
      return publish();
    };

    const report = (error: unknown) => console.error('[rclone]', errorMessage(error));
    const updateTray = createTray(daemon, mounts, () => { void refresh().catch(report); }, report);
    let announcedError: string | null = null;
    function publish() {
      const snapshot = current();
      send(EVENTS.onSnapshot, snapshot);
      updateTray?.(snapshot, getSettings().mounts);
      const { error, mode } = snapshot.daemon;
      if (mode === 'attached' && error && error !== announcedError && getSettings().notifications.daemonErrors) {
        notify('daemonError', 'rclone connection failed', error);
      }
      announcedError = error;
      return snapshot;
    }

    installAppMenu();
    registerIpc({ daemon, mounts, jobs, auth, remotes, current, refresh, sendNotice });
    updates.on('status', (status) => send(EVENTS.onUpdateStatus, status));
    updates.on('found', (version) => {
      const { autoInstall, installMinute } = getSettings().updates;
      const time = minuteToClock(installMinute);
      const bodies = {
        off: `${APP_NAME} ${version} is ready to download in Settings → Updates.`,
        now: `${APP_NAME} ${version} is downloading and installs when it is ready.`,
        scheduled: `${APP_NAME} ${version} is downloading and installs at ${time}.`,
        restart: `${APP_NAME} ${version} is downloading and installs the next time ${APP_NAME} quits.`,
      };
      sendNotice(appNotice('updateFound', { target: 'updates', title: 'Update available', body: bodies[autoInstall], short: `${APP_NAME} ${version}` }));
    });
    onSettingsChange((next, prev) => {
      applyLoginSettings();
      syncWindowBackground();
      if (next.updates.autoCheck !== prev.updates.autoCheck) updates.setAutoCheck(next.updates.autoCheck);
      if (next.updates.channel !== prev.updates.channel) void updates.check();
      send(EVENTS.onSettings, next);
      publish();
    });
    nativeTheme.on('updated', syncWindowBackground);
    applyLoginSettings();
    const minimized = process.argv.includes(LOGIN_MINIMIZED_ARG) || getSettings().general.startMinimized;
    createMainWindow(minimized);
    app.on('activate', showMainWindow);
    startUpdateInstaller();
    updates.setAutoCheck(getSettings().updates.autoCheck);
    publish();
    if (daemon.current().daemon.mode === 'attached' || getSettings().daemon.autoStart) void daemon.start().catch(report);
    else void daemon.refreshLocal().catch(report);
    const timer = setInterval(() => { void refresh().catch(report); }, POLL_INTERVAL_MS);
    app.on('before-quit', (event) => {
      if (isQuitting()) return;
      event.preventDefault();
      markQuitting();
      clearInterval(timer);
      void Promise.allSettled([auth.stop(), daemon.stop()]).then((results) => {
        for (const result of results) if (result.status === 'rejected') report(result.reason);
      }).finally(() => {
        notices.destroy();
        // Calling app.quit() emits 'quit', which lets @cujuju/electron-updates apply staged updates.
        app.quit();
      });
    });
  }).catch((error: unknown) => {
    console.error('[startup]', error);
    app.exit(1);
  });
}
