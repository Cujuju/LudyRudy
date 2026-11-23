import { createSignal, onCleanup, onMount, untrack } from 'solid-js';
import { LOG_CAPACITY, type AuthSession, type LogLine } from '@shared/types';
import type { Page } from './components/Sidebar';
import type { BuildInfo } from '@shared/buildInfo';
import type { AppSnapshot } from '@shared/ipc';
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/settings';
import { createBrowserCache } from './lib/browserCache';

export const SETTINGS_SECTIONS = ['General', 'Appearance', 'Daemon & Security', 'Notifications', 'About'] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number];

export function createAppStore() {
  const api = window.api;
  const [settings, setSettings] = createSignal(DEFAULT_SETTINGS);
  const [settingsSection, setSettingsSection] = createSignal<SettingsSection>('General');
  const [build, setBuild] = createSignal<BuildInfo>();
  const [snapshot, setSnapshot] = createSignal<AppSnapshot>();
  const [logs, setLogs] = createSignal<LogLine[]>([]);
  const [auth, setAuth] = createSignal<AuthSession>();
  const [browserTarget, setBrowserTarget] = createSignal<{ remote: string; path: string }>();
  const [maximized, setMaximized] = createSignal(false);
  const [error, setError] = createSignal('');
  const [ready, setReady] = createSignal(false);
  const [refreshing, setRefreshing] = createSignal(false);
  const browserCache = createBrowserCache();
  let daemonSession = '';
  let disposed = false;

  const reportError = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));
  const applySnapshot = (value: AppSnapshot) => {
    const nextSession = value.daemon.state === 'running' ? `${value.daemon.endpoint ?? ''}\0${value.daemon.pid ?? ''}` : '';
    if (nextSession !== daemonSession) {
      if (daemonSession) browserCache.clear();
      daemonSession = nextSession;
    }
    setSnapshot(value);
  };

  onMount(() => {
    let snapshotUpdated = false;
    let settingsUpdated = false;
    let maximizeUpdated = false;
    const dispose = [
      api.onSnapshot((value) => {
        snapshotUpdated = true;
        applySnapshot(value);
        if (!untrack(ready)) setLogs(value.logs);
      }),
      api.onLog((entry) => setLogs((lines) => [entry, ...lines].slice(0, LOG_CAPACITY))),
      api.onAuth(setAuth),
      api.onSettings((value) => { settingsUpdated = true; setSettings(value); }),
      api.onMaximized((value) => { maximizeUpdated = true; setMaximized(value); }),
    ];
    onCleanup(() => {
      disposed = true;
      for (const unsubscribe of dispose) unsubscribe();
    });
    void api.initialize().then((initial) => {
      if (disposed) return;
      if (!snapshotUpdated) {
        applySnapshot(initial.snapshot);
        setLogs(initial.snapshot.logs);
      }
      if (!settingsUpdated) setSettings(initial.settings);
      if (!maximizeUpdated) setMaximized(initial.maximized);
      setBuild(initial.build);
      setReady(true);
    }).catch(reportError);
  });

  async function updateGeneral(patch: Partial<AppSettings['general']>): Promise<void> {
    setError('');
    try {
      await api.updateGeneral(patch);
    } catch (cause) {
      reportError(cause);
    }
  }

  async function refresh(): Promise<void> {
    if (refreshing()) return;
    setRefreshing(true);
    setError('');
    try {
      await api.refresh();
    } catch (cause) {
      reportError(cause);
    } finally {
      setRefreshing(false);
    }
  }

  return { settings, settingsSection, setSettingsSection, build, snapshot, logs, auth, browserTarget, setBrowserTarget,
    browserCache, maximized, ready, error, refreshing, updateGeneral, refresh };
}

export type AppStore = ReturnType<typeof createAppStore>;
export interface PageProps { store: AppStore; navigate: (page: Page) => void }
