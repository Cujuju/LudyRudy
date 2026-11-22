import { createSignal, onCleanup, onMount } from 'solid-js';
import type { BuildInfo } from '@shared/buildInfo';
import type { AppSnapshot } from '@shared/ipc';
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/settings';

export function createAppStore() {
  const api = window.api;
  const [settings, setSettings] = createSignal(DEFAULT_SETTINGS);
  const [build, setBuild] = createSignal<BuildInfo>();
  const [snapshot, setSnapshot] = createSignal<AppSnapshot>();
  const [maximized, setMaximized] = createSignal(false);
  const [error, setError] = createSignal('');
  const [ready, setReady] = createSignal(false);
  const [refreshing, setRefreshing] = createSignal(false);
  let disposed = false;

  const reportError = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));

  onMount(() => {
    let snapshotUpdated = false;
    let settingsUpdated = false;
    let maximizeUpdated = false;
    const dispose = [
      api.onSnapshot((value) => { snapshotUpdated = true; setSnapshot(value); }),
      api.onSettings((value) => { settingsUpdated = true; setSettings(value); }),
      api.onMaximized((value) => { maximizeUpdated = true; setMaximized(value); }),
    ];
    onCleanup(() => {
      disposed = true;
      for (const unsubscribe of dispose) unsubscribe();
    });
    void api.initialize().then((initial) => {
      if (disposed) return;
      if (!snapshotUpdated) setSnapshot(initial.snapshot);
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

  return { settings, build, snapshot, maximized, ready, error, refreshing, updateGeneral, refresh };
}

export type AppStore = ReturnType<typeof createAppStore>;
export interface PageProps { store: AppStore }
