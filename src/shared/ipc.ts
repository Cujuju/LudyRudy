import type { BuildInfo } from './buildInfo';
import type { AppSettings } from './settings';
import type { HourCycle } from './timeFormat';
import type { ActiveMount, DaemonStatus, LogLine, PrereqStatus, RemoteEntry, RemoteQuota, RemoteSummary, TransferStats } from './types';

export const NOTICE_OVERLAY_ARG = '--ludyrudy-notice-overlay';

export interface AppSnapshot {
  daemon: DaemonStatus;
  prereqs: PrereqStatus;
  remotes: RemoteSummary[];
  mounts: ActiveMount[];
  stats: TransferStats | null;
  logs: LogLine[];
  dataError: string | null;
}

export interface DesktopApi {
  platform: string;
  hourCycle: HourCycle;
  noticeOverlaySupported: boolean;
  initialize(): Promise<{ settings: AppSettings; build: BuildInfo; snapshot: AppSnapshot; maximized: boolean }>;
  refresh(): Promise<AppSnapshot>;
  updateGeneral(patch: Partial<AppSettings['general']>): Promise<AppSettings>;
  browse(remote: string, path: string): Promise<RemoteEntry[]>;
  quota(remote: string): Promise<RemoteQuota>;
  minimize(): void;
  toggleMaximize(): void;
  closeWindow(): void;
  onSnapshot(cb: (snapshot: AppSnapshot) => void): () => void;
  onSettings(cb: (settings: AppSettings) => void): () => void;
  onMaximized(cb: (maximized: boolean) => void): () => void;
}

type Methods = Exclude<keyof DesktopApi, 'platform' | 'hourCycle' | 'noticeOverlaySupported'>;
type Invoke = { [K in Methods]: ReturnType<DesktopApi[K]> extends Promise<unknown> ? K : never }[Methods];
type Send = { [K in Methods]: ReturnType<DesktopApi[K]> extends void ? K : never }[Methods];
type Event = Exclude<Methods, Invoke | Send>;

export const INVOKE = {
  initialize: 'app:initialize', refresh: 'app:refresh', updateGeneral: 'settings:general',
  browse: 'remote:browse', quota: 'remote:quota',
} as const satisfies Record<Invoke, string>;

export const SEND = {
  minimize: 'window:minimize', toggleMaximize: 'window:toggle-maximize', closeWindow: 'window:close',
} as const satisfies Record<Send, string>;

export const EVENTS = {
  onSnapshot: 'app:snapshot', onSettings: 'settings:changed', onMaximized: 'window:maximized',
} as const satisfies Record<Event, string>;
