import type { BuildInfo } from './buildInfo';
import type { AppSettings } from './settings';
import type { HourCycle } from './timeFormat';
import type { ActiveMount, AuthSession, CompletedTransfer, CryptDraft, DaemonStatus, MountProfile, ProviderInfo, RemoteDraft, SyncJob, SyncJobRun, LogLine, PrereqStatus, RemoteEntry, RemoteQuota, RemoteSummary, TransferStats } from './types';

export const NOTICE_OVERLAY_ARG = '--ludyrudy-notice-overlay';

export interface AppSnapshot {
  daemon: DaemonStatus;
  prereqs: PrereqStatus;
  remotes: RemoteSummary[];
  mounts: ActiveMount[];
  stats: TransferStats | null;
  logs: LogLine[];
  dataError: string | null;
  jobRuns: SyncJobRun[];
}

export interface DesktopApi {
  platform: string;
  hourCycle: HourCycle;
  noticeOverlaySupported: boolean;
  initialize(): Promise<{ settings: AppSettings; build: BuildInfo; snapshot: AppSnapshot; maximized: boolean }>;
  refresh(): Promise<AppSnapshot>;
  updateGeneral(patch: Partial<AppSettings['general']>): Promise<AppSettings>;
  updateDaemon(patch: Partial<AppSettings['daemon']>): Promise<AppSettings>;
  startDaemon(): Promise<void>;
  stopDaemon(): Promise<void>;
  restartDaemon(): Promise<void>;
  bandwidthLimit(rate?: string): Promise<string>;
  completedTransfers(): Promise<CompletedTransfer[]>;
  resetStats(): Promise<void>;
  listProviders(): Promise<ProviderInfo[]>;
  createRemote(draft: RemoteDraft): Promise<void>;
  updateRemote(draft: RemoteDraft): Promise<void>;
  deleteRemote(name: string): Promise<void>;
  testRemote(name: string): Promise<void>;
  createCryptRemote(draft: CryptDraft): Promise<void>;
  generateSecret(bits?: number): Promise<string>;
  setConfigPassword(password: string | null): Promise<void>;
  hasConfigPassword(): Promise<boolean>;
  startAuth(provider: string): Promise<AuthSession>;
  authStatus(sessionId: string): Promise<AuthSession | null>;
  openAuth(sessionId: string): Promise<void>;
  cancelAuth(sessionId: string): Promise<void>;
  listMountProfiles(): Promise<MountProfile[]>;
  saveMountProfile(draft: Omit<MountProfile, 'id' | 'vfsCacheMode'> & Partial<Pick<MountProfile, 'id' | 'vfsCacheMode'>>): Promise<MountProfile>;
  deleteMountProfile(id: string): Promise<void>;
  mountProfile(id: string): Promise<string>;
  unmount(mountPoint: string): Promise<void>;
  unmountAll(): Promise<void>;
  revealMount(mountPoint: string): Promise<void>;
  mountTypes(): Promise<string[]>;
  listVfs(): Promise<string[]>;
  vfsStats(remote: string, path?: string): Promise<{ inUse: number; files: number; dirs: number }>;
  vfsRefresh(remote: string, path?: string, dir?: string, recursive?: boolean): Promise<void>;
  vfsForget(remote: string, path?: string, dir?: string): Promise<void>;
  listJobs(): Promise<SyncJob[]>;
  saveJob(draft: Omit<SyncJob, 'id'> & { id?: string }): Promise<SyncJob>;
  deleteJob(id: string): Promise<void>;
  runJob(id: string, options?: { dryRun?: boolean }): Promise<SyncJobRun>;
  stopJob(rcloneJobId: number): Promise<void>;
  stat(remote: string, path: string): Promise<RemoteEntry | null>;
  mkdir(remote: string, path: string): Promise<void>;
  deleteFile(remote: string, path: string): Promise<void>;
  purge(remote: string, path: string): Promise<void>;
  copyFile(srcRemote: string, srcPath: string, dstRemote: string, dstPath: string): Promise<void>;
  moveFile(srcRemote: string, srcPath: string, dstRemote: string, dstPath: string): Promise<void>;
  pickDirectory(): Promise<string | null>;
  pickRcloneBinary(): Promise<string | null>;
  uploadFiles(remote: string, remoteDir: string): Promise<number>;
  downloadFile(remote: string, remotePath: string, suggestedName?: string): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  openPath(kind: 'config' | 'cache' | 'data'): Promise<void>;
  browse(remote: string, path: string): Promise<RemoteEntry[]>;
  quota(remote: string): Promise<RemoteQuota>;
  minimize(): void;
  toggleMaximize(): void;
  closeWindow(): void;
  onLog(cb: (entry: LogLine) => void): () => void;
  onAuth(cb: (session: AuthSession) => void): () => void;
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
  updateDaemon: 'settings:daemon', startDaemon: 'daemon:start', stopDaemon: 'daemon:stop', restartDaemon: 'daemon:restart',
  bandwidthLimit: 'daemon:bandwidth', completedTransfers: 'daemon:transferred', resetStats: 'daemon:reset-stats',
  listProviders: 'remote:providers', createRemote: 'remote:create', updateRemote: 'remote:update',
  deleteRemote: 'remote:delete', testRemote: 'remote:test', createCryptRemote: 'remote:crypt', generateSecret: 'remote:generate-secret',
  setConfigPassword: 'config:set-password', hasConfigPassword: 'config:has-password',
  startAuth: 'auth:start', authStatus: 'auth:status', openAuth: 'auth:open', cancelAuth: 'auth:cancel',
  listMountProfiles: 'mount:profiles', saveMountProfile: 'mount:save', deleteMountProfile: 'mount:delete',
  mountProfile: 'mount:mount', unmount: 'mount:unmount', unmountAll: 'mount:unmount-all', revealMount: 'mount:reveal',
  mountTypes: 'mount:types', listVfs: 'vfs:list', vfsStats: 'vfs:stats', vfsRefresh: 'vfs:refresh', vfsForget: 'vfs:forget',
  listJobs: 'job:list', saveJob: 'job:save', deleteJob: 'job:delete', runJob: 'job:run', stopJob: 'job:stop',
  stat: 'file:stat', mkdir: 'file:mkdir', deleteFile: 'file:delete', purge: 'file:purge',
  copyFile: 'file:copy', moveFile: 'file:move', pickDirectory: 'native:directory', pickRcloneBinary: 'native:binary',
  uploadFiles: 'native:upload', downloadFile: 'native:download', openExternal: 'native:external', openPath: 'native:path',
} as const satisfies Record<Invoke, string>;

export const SEND = {
  minimize: 'window:minimize', toggleMaximize: 'window:toggle-maximize', closeWindow: 'window:close',
} as const satisfies Record<Send, string>;

export const EVENTS = {
  onLog: 'daemon:log', onAuth: 'auth:changed', onSnapshot: 'app:snapshot', onSettings: 'settings:changed', onMaximized: 'window:maximized',
} as const satisfies Record<Event, string>;
