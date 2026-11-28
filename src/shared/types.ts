import type { MountOptionMap } from './mountOptions';

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
  mode: 'attached' | 'managed';
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
  popular: boolean;
  isCrypt: boolean;
  options: ProviderOptionSpec[];
}

export interface ProviderOptionSpec {
  name: string;
  help?: string;
  input: 'text' | 'boolean' | 'password';
  sensitive?: boolean;
  required?: boolean;
  advanced?: boolean;
  provider?: string;
  defaultValue?: RemoteParameters[string];
  choices?: { value: string; help: string; provider?: string }[];
}

export interface RemoteEditorData {
  providers: ProviderInfo[];
  values: RemoteParameters;
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
  mountOpts?: MountOptionMap;
  vfsOpts?: MountOptionMap;
  mountType?: string;
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
  id?: string;
  tier?: string;
  encrypted?: string;
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
  srcFs?: string | null;
  dstFs?: string | null;
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
  bwLimitTx?: number;
  bwLimitRx?: number;
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
  state: 'running' | 'reconnecting' | 'unknown' | 'finished' | 'failed' | 'stopped';
  startedAt: string;
  finishedAt: string | null;
  dryRun: boolean;
  error: string | null;
}

export const LOG_CAPACITY = 200;

export interface LogLine {
  ts: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  source: 'app' | 'rclone';
}

export interface AuthSession {
  id: string;
  provider: string;
  state: 'starting' | 'awaiting' | 'completed' | 'expired' | 'failed' | 'cancelled';
  url: string | null;
  error: string | null;
}

export type RemoteParameters = Record<string, string | boolean | number>;
export interface RemoteDraft {
  name: string;
  type: string;
  parameters: RemoteParameters;
  authSessionId?: string;
}

export interface CryptDraft {
  name: string;
  targetRemote: string;
  targetPath: string;
  password: string;
  salt?: string;
  filenameEncryption: 'standard' | 'obfuscate' | 'off';
  directoryNameEncryption: boolean;
}

export interface CompletedTransfer {
  name: string;
  size: number;
  bytes: number;
  checked: boolean;
  startedAt: string;
  completedAt: string;
  failed: boolean;
}
