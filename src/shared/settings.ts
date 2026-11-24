import { DEFAULT_NOTICE_CONFIG, normalizeNoticeConfig, type NoticeConfig } from '@cujuju/electron-notices';
import { SYSTEM_THEME, THEME_CHOICES } from './themes';
import { validateOptionMap } from './mountOptions';
import { MINUTES_PER_DAY, MINUTES_PER_HOUR } from './timeFormat';
import { UPDATE_CHANNELS, type UpdateChannel } from './updateFeed';
import { VFS_CACHE_MODES, type MountProfile, type SyncJob } from './types';

/** When a downloaded update installs. */
export const UPDATE_INSTALL_MODES = ['off', 'now', 'scheduled', 'restart'] as const;
export type UpdateInstallMode = (typeof UPDATE_INSTALL_MODES)[number];
/** Quiet overnight install time, in local minutes after midnight. */
export const DEFAULT_UPDATE_INSTALL_MINUTE = 3 * MINUTES_PER_HOUR;

export interface AppSettings {
  general: { theme: string; closeToTray: boolean; minimizeToTray: boolean; sidebarCollapsed: boolean; launchAtLogin: boolean; startMinimized: boolean };
  daemon: { binaryPath: string; configPath: string; endpoint: string; autoStart: boolean; defaultVfsCacheMode: MountProfile['vfsCacheMode']; defaultCacheDir: string; bwLimit: string };
  notifications: NoticeConfig & { daemonErrors: boolean };
  updates: { autoCheck: boolean; autoInstall: UpdateInstallMode; installMinute: number; channel: UpdateChannel };
  mounts: MountProfile[];
  jobs: SyncJob[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  general: { theme: SYSTEM_THEME, closeToTray: false, minimizeToTray: false, sidebarCollapsed: false, launchAtLogin: false, startMinimized: false },
  daemon: { binaryPath: '', configPath: '', endpoint: '', autoStart: true, defaultVfsCacheMode: 'off', defaultCacheDir: '', bwLimit: 'off' },
  notifications: { ...DEFAULT_NOTICE_CONFIG, daemonErrors: true },
  updates: { autoCheck: true, autoInstall: 'off', installMinute: DEFAULT_UPDATE_INSTALL_MINUTE, channel: 'stable' },
  mounts: [], jobs: [],
};

const record = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
const string = (raw: unknown, fallback = '') => typeof raw === 'string' ? raw : fallback;
const bool = (raw: unknown, fallback = false) => typeof raw === 'boolean' ? raw : fallback;
const int = (raw: unknown, fallback: number, min: number, max: number) =>
  typeof raw === 'number' && Number.isFinite(raw) ? Math.min(max, Math.max(min, Math.round(raw))) : fallback;
const strings = (raw: unknown): string[] => Array.isArray(raw) ? raw.filter((item) => typeof item === 'string') : [];
const items = (raw: unknown) => Array.isArray(raw) ? raw.map(record) : [];

function normalizeMounts(raw: unknown): MountProfile[] {
  return items(raw).filter((item) => string(item.id) && string(item.remote) && string(item.mountPoint)).map((item) => ({
    id: string(item.id), name: string(item.name), remote: string(item.remote), remotePath: string(item.remotePath),
    mountPoint: string(item.mountPoint), autoMount: bool(item.autoMount),
    vfsCacheMode: VFS_CACHE_MODES.find((mode) => mode === item.vfsCacheMode) ?? 'off',
    vfsCacheMaxSize: string(item.vfsCacheMaxSize), vfsCacheMaxAge: string(item.vfsCacheMaxAge),
    readOnly: bool(item.readOnly), extraFlags: strings(item.extraFlags),
    mountOpts: validateOptionMap('mount', item.mountOpts, 'discard'),
    vfsOpts: validateOptionMap('vfs', item.vfsOpts, 'discard'),
    ...(typeof item.mountType === 'string' ? { mountType: item.mountType } : {}),
  }));
}

function normalizeJobs(raw: unknown): SyncJob[] {
  return items(raw).filter((item) => string(item.id) && string(item.source) && string(item.destination)).map((item) => ({
    id: string(item.id), name: string(item.name), mode: item.mode === 'sync' ? 'sync' : 'copy',
    source: string(item.source), destination: string(item.destination), excludes: strings(item.excludes),
    dryRunDefault: bool(item.dryRunDefault, true), enabled: bool(item.enabled),
  }));
}

export function normalizeSettings(raw: unknown): AppSettings {
  const value = record(raw);
  const general = record(value.general);
  const daemon = record(value.daemon);
  const notifications = record(value.notifications);
  const updates = record(value.updates);
  return {
    general: {
      theme: THEME_CHOICES.find((theme) => theme === general.theme) ?? DEFAULT_SETTINGS.general.theme,
      closeToTray: bool(general.closeToTray), minimizeToTray: bool(general.minimizeToTray),
      sidebarCollapsed: bool(general.sidebarCollapsed),
      launchAtLogin: bool(general.launchAtLogin), startMinimized: bool(general.startMinimized),
    },
    daemon: {
      binaryPath: string(daemon.binaryPath), configPath: string(daemon.configPath), endpoint: string(daemon.endpoint),
      autoStart: bool(daemon.autoStart, DEFAULT_SETTINGS.daemon.autoStart),
      defaultVfsCacheMode: VFS_CACHE_MODES.find((mode) => mode === daemon.defaultVfsCacheMode) ?? DEFAULT_SETTINGS.daemon.defaultVfsCacheMode,
      defaultCacheDir: string(daemon.defaultCacheDir), bwLimit: string(daemon.bwLimit, DEFAULT_SETTINGS.daemon.bwLimit),
    },
    notifications: { ...normalizeNoticeConfig(notifications), daemonErrors: bool(notifications.daemonErrors, true) },
    updates: {
      autoCheck: bool(updates.autoCheck, DEFAULT_SETTINGS.updates.autoCheck),
      autoInstall: UPDATE_INSTALL_MODES.find((mode) => mode === updates.autoInstall) ?? DEFAULT_SETTINGS.updates.autoInstall,
      installMinute: int(updates.installMinute, DEFAULT_SETTINGS.updates.installMinute, 0, MINUTES_PER_DAY - 1),
      channel: UPDATE_CHANNELS.find((channel) => channel === updates.channel) ?? DEFAULT_SETTINGS.updates.channel,
    },
    mounts: normalizeMounts(value.mounts),
    jobs: normalizeJobs(value.jobs),
  };
}
