import './identity';
import { app, nativeTheme, shell } from 'electron';
import { EVENTS } from '@shared/ipc';
import { appNotice } from '@shared/notice';
import { installAppMenu } from './appMenu';
import { registerIpc } from './ipc';
import { openJobManager } from './jobManager';
import { openMountManager, type Notify } from './mountManager';
import { startNotices } from './notifier';
import { supportsLaunchAtLogin } from './paths';
import { openAuth } from './rcloneAuth';
import { errorMessage, openDaemon } from './rcloneSupervisor';
import { openRemotes } from './remoteService';
import { getSettings, getSettingsProblem, onSettingsChange, updateSettings } from './settingsStore';
import { createTray } from './tray';
import { createMainWindow, isQuitting, mainWindow, markQuitting, showMainWindow, syncWindowBackground } from './window';

const POLL_INTERVAL_MS = 2_000;
let lastLoginSettings: string | undefined;
const LOGIN_MINIMIZED_ARG = '--login-minimized';

function applyLoginSettings(): void {
  if (!supportsLaunchAtLogin() || getSettingsProblem()) return;
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
  app.on('before-quit', markQuitting);
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

  void app.whenReady().then(() => {
    const send = (channel: string, payload: unknown) => {
      if (!isQuitting()) mainWindow()?.webContents.send(channel, payload);
    };
    const sendNotice = startNotices();
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
    const platform = () => daemon.current().daemon.hostPlatform;
    const remotes = openRemotes({ client: daemon.client, isCurrentClient: daemon.isCurrentClient, platform }, auth);
    const mounts = openMountManager({
      client: daemon.client, profiles: () => getSettings().mounts, save: (mounts) => { updateSettings({ mounts }); },
      defaults: () => getSettings().daemon.defaultVfsCacheMode, managed: () => daemon.current().daemon.mode === 'managed',
      mountBackendAvailable: () => daemon.current().prereqs.mountBackend.available,
      platform,
      reveal: (path) => shell.openPath(path), notify,
    });
    const jobs = openJobManager({
      client: daemon.client, isCurrentClient: daemon.isCurrentClient, jobs: () => getSettings().jobs, save: (jobs) => { updateSettings({ jobs }); },
      platform,
      hasRemote: (name) => daemon.current().remotes.some((remote) => remote.name === name),
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
    onSettingsChange((settings) => {
      applyLoginSettings();
      syncWindowBackground();
      send(EVENTS.onSettings, settings);
      publish();
    });
    nativeTheme.on('updated', syncWindowBackground);
    applyLoginSettings();
    const minimized = process.argv.includes(LOGIN_MINIMIZED_ARG) || getSettings().general.startMinimized;
    createMainWindow(minimized);
    app.on('activate', showMainWindow);
    publish();
    if (daemon.current().daemon.mode === 'attached' || getSettings().daemon.autoStart) void daemon.start().catch(report);
    else void daemon.refreshLocal().catch(report);
    const timer = setInterval(() => { void refresh().catch(report); }, POLL_INTERVAL_MS);
    let shutdown: Promise<void> | undefined;
    app.on('before-quit', (event) => {
      event.preventDefault();
      clearInterval(timer);
      shutdown ??= Promise.allSettled([auth.stop(), daemon.stop()]).then((results) => {
        for (const result of results) if (result.status === 'rejected') report(result.reason);
        // A second quit request can be ignored during system-initiated termination.
        app.exit(results.some((result) => result.status === 'rejected') ? 1 : 0);
      });
    });
  }).catch((error: unknown) => {
    console.error('[startup]', error);
    app.exit(1);
  });
}
