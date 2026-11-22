export interface DaemonStatus {
  state: 'stopped' | 'starting' | 'running' | 'error';
  endpoint: string | null;
  pid: number | null;
  version: string | null;
  binaryPath: string | null;
  binarySource: 'override' | 'bundled' | 'path' | 'missing';
  configPath: string | null;
  configEncrypted: boolean | null;
  attached: boolean;
  error: string | null;
}

export interface PrereqStatus {
  platform: string;
  rcloneInstalled: boolean;
  rcloneVersion: string | null;
  rclonePath: string | null;
  mountBackend: { available: boolean; name: string; details: string; installUrl: string };
}

export interface RemoteSummary {
  name: string;
  type: string;
  isCrypt: boolean;
  targetRemote: string | null;
  targetPath: string | null;
  filenameEncryption: string | null;
  directoryNameEncryption: boolean | null;
  config: Record<string, string>;
}

export interface ProviderInfo {
  name: string;
  prefix: string;
  description: string;
  isOAuth: boolean;
  isCrypt: boolean;
  options: Record<string, unknown>[];
}

export const VFS_CACHE_MODES = ['off', 'minimal', 'writes', 'full'] as const;

export interface MountProfile {
  id: string;
  name: string;
  remote: string;
  remotePath: string;
  mountPoint: string;
  autoMount: boolean;
  vfsCacheMode: typeof VFS_CACHE_MODES[number];
  vfsCacheMaxSize: string;
  vfsCacheMaxAge: string;
  readOnly: boolean;
  extraFlags: string[];
}

export interface ActiveMount {
  profileId: string | null;
  fs: string;
  mountPoint: string;
  mountedOn: string | null;
  status: 'mounted' | 'mounting' | 'unmounting' | 'error';
}

export interface RemoteEntry {
  path: string;
  name: string;
  size: number;
  mimeType: string;
  modTime: string;
  isDir: boolean;
}

export interface RemoteQuota {
  total: number | null;
  used: number | null;
  free: number | null;
  trashed: number | null;
  other: number | null;
}

export interface TransferItem {
  name: string;
  bytes: number;
  size: number;
  speed: number;
  eta: number | null;
}

export interface TransferStats {
  bytes: number;
  totalBytes: number;
  speed: number;
  eta: number | null;
  transfers: number;
  totalTransfers: number;
  checks: number;
  errors: number;
  transferring: TransferItem[];
  bwLimit: string | null;
}

export interface SyncJob {
  id: string;
  name: string;
  mode: 'copy' | 'sync';
  source: string;
  destination: string;
  excludes: string[];
  dryRunDefault: boolean;
  enabled: boolean;
}

export interface SyncJobRun {
  jobId: string;
  rcloneJobId: number;
  state: 'running' | 'finished' | 'failed' | 'stopped';
  startedAt: string;
  finishedAt: string | null;
  dryRun: boolean;
  error: string | null;
}

export interface LogLine {
  ts: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  source: 'app' | 'rclone';
}
