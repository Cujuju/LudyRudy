export const CACHE_SIZE_PRESETS = [
  { value: '', label: 'Unlimited (default)' },
  ...[1, 2, 5, 10, 25, 50, 100].map((size) => ({ value: `${size}G`, label: `${size} GiB` })),
] as const;

export const CACHE_AGE_PRESETS = [
  { value: '', label: 'Default (1h)' },
  { value: '15m', label: '15 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '6h', label: '6 hours' },
  { value: '12h', label: '12 hours' },
  { value: '24h', label: '24 hours' },
  { value: '168h', label: '7 days' },
  { value: '720h', label: '30 days' },
] as const;

export type MountOptionGroup = 'mount' | 'vfs';
export type MountOptionValue = string | boolean | number;
export type MountOptionMap = Record<string, MountOptionValue>;
type Platform = 'win32' | 'darwin' | 'linux';

export interface MountOption {
  key: string;
  group: MountOptionGroup;
  flag: `--${string}`;
  type: 'bool' | 'duration' | 'size' | 'int' | 'string' | 'tristate';
  defaultValue: string | boolean;
  description: string;
  platforms: 'all' | readonly Platform[];
  format?: 'octal' | 'id';
}

const UNIX = ['darwin', 'linux'] as const;
const APPLE = ['darwin'] as const;
const WINDOWS = ['win32'] as const;
const DESKTOP_VOLUME = ['win32', 'darwin'] as const;
const LINUX = ['linux'] as const;

export const MOUNT_OPTION_CATALOG: readonly MountOption[] = [
  { key: 'VolumeName', group: 'mount', flag: '--volname', type: 'string', defaultValue: '', description: 'Name shown for the mounted volume', platforms: DESKTOP_VOLUME },
  { key: 'NetworkMode', group: 'mount', flag: '--network-mode', type: 'bool', defaultValue: false, description: 'Mount as a network drive', platforms: WINDOWS },
  { key: 'DeviceName', group: 'mount', flag: '--devname', type: 'string', defaultValue: '', description: 'Override the remote path as the device name', platforms: 'all' },
  { key: 'AttrTimeout', group: 'mount', flag: '--attr-timeout', type: 'duration', defaultValue: '1s', description: 'Time to cache file attributes', platforms: 'all' },
  { key: 'DirectIO', group: 'mount', flag: '--direct-io', type: 'bool', defaultValue: false, description: 'Bypass kernel data caching', platforms: 'all' },
  { key: 'DefaultPermissions', group: 'mount', flag: '--default-permissions', type: 'bool', defaultValue: false, description: 'Enforce file permissions in the kernel', platforms: UNIX },
  { key: 'AllowOther', group: 'mount', flag: '--allow-other', type: 'bool', defaultValue: false, description: 'Let other users access the mount', platforms: UNIX },
  { key: 'AllowNonEmpty', group: 'mount', flag: '--allow-non-empty', type: 'bool', defaultValue: false, description: 'Mount over a nonempty directory', platforms: UNIX },
  { key: 'AllowRoot', group: 'mount', flag: '--allow-root', type: 'bool', defaultValue: false, description: 'Let the root user access the mount', platforms: UNIX },
  { key: 'AllowIDMap', group: 'mount', flag: '--allow-idmap', type: 'bool', defaultValue: false, description: 'Allow ID mapping with mount2 on Linux 6.12+', platforms: LINUX },
  { key: 'AsyncRead', group: 'mount', flag: '--async-read', type: 'bool', defaultValue: true, description: 'Allow asynchronous reads', platforms: UNIX },
  { key: 'WritebackCache', group: 'mount', flag: '--write-back-cache', type: 'bool', defaultValue: false, description: 'Buffer writes in the kernel', platforms: UNIX },
  { key: 'MaxReadAhead', group: 'mount', flag: '--max-read-ahead', type: 'size', defaultValue: '128Ki', description: 'Kernel prefetch limit for sequential reads', platforms: UNIX },
  { key: 'NoAppleDouble', group: 'mount', flag: '--noappledouble', type: 'bool', defaultValue: true, description: 'Ignore AppleDouble and .DS_Store files', platforms: APPLE },
  { key: 'NoAppleXattr', group: 'mount', flag: '--noapplexattr', type: 'bool', defaultValue: false, description: 'Ignore Apple extended attributes', platforms: APPLE },
  { key: 'CaseInsensitive', group: 'mount', flag: '--mount-case-insensitive', type: 'tristate', defaultValue: 'unset', description: 'Override case sensitivity reported to the OS', platforms: 'all' },
  { key: 'DebugFUSE', group: 'mount', flag: '--debug-fuse', type: 'bool', defaultValue: false, description: 'Log FUSE internals at verbose log levels', platforms: 'all' },
  { key: 'DirCacheTime', group: 'vfs', flag: '--dir-cache-time', type: 'duration', defaultValue: '5m', description: 'Time to cache directory entries', platforms: 'all' },
  { key: 'PollInterval', group: 'vfs', flag: '--poll-interval', type: 'duration', defaultValue: '1m', description: 'Time between remote change checks', platforms: 'all' },
  { key: 'WriteBack', group: 'vfs', flag: '--vfs-write-back', type: 'duration', defaultValue: '5s', description: 'Delay before uploading closed cached files', platforms: 'all' },
  { key: 'ChunkSize', group: 'vfs', flag: '--vfs-read-chunk-size', type: 'size', defaultValue: '128Mi', description: 'Initial download chunk size', platforms: 'all' },
  { key: 'ChunkSizeLimit', group: 'vfs', flag: '--vfs-read-chunk-size-limit', type: 'size', defaultValue: 'off', description: 'Maximum download chunk size', platforms: 'all' },
  { key: 'ChunkStreams', group: 'vfs', flag: '--vfs-read-chunk-streams', type: 'int', defaultValue: '0', description: 'Number of parallel download streams', platforms: 'all' },
  { key: 'ReadAhead', group: 'vfs', flag: '--vfs-read-ahead', type: 'size', defaultValue: '0', description: 'Extra prefetch in full cache mode', platforms: 'all' },
  { key: 'CacheMinFreeSpace', group: 'vfs', flag: '--vfs-cache-min-free-space', type: 'size', defaultValue: 'off', description: 'Minimum free space to leave on the cache disk', platforms: 'all' },
  { key: 'CachePollInterval', group: 'vfs', flag: '--vfs-cache-poll-interval', type: 'duration', defaultValue: '1m', description: 'Time between cache cleanup checks', platforms: 'all' },
  { key: 'DiskSpaceTotalSize', group: 'vfs', flag: '--vfs-disk-space-total-size', type: 'size', defaultValue: 'off', description: 'Override the reported disk capacity', platforms: 'all' },
  { key: 'FastFingerprint', group: 'vfs', flag: '--vfs-fast-fingerprint', type: 'bool', defaultValue: false, description: 'Use faster, less precise file change detection', platforms: 'all' },
  { key: 'HandleCaching', group: 'vfs', flag: '--vfs-handle-caching', type: 'duration', defaultValue: '5s', description: 'Keep file handles and downloads alive after close', platforms: 'all' },
  { key: 'NoChecksum', group: 'vfs', flag: '--no-checksum', type: 'bool', defaultValue: false, description: 'Skip checksum comparisons on transfer', platforms: 'all' },
  { key: 'NoModTime', group: 'vfs', flag: '--no-modtime', type: 'bool', defaultValue: false, description: 'Skip reading and writing modification times', platforms: 'all' },
  { key: 'NoSeek', group: 'vfs', flag: '--no-seek', type: 'bool', defaultValue: false, description: 'Disable seeking within files', platforms: 'all' },
  { key: 'Links', group: 'vfs', flag: '--vfs-links', type: 'bool', defaultValue: false, description: 'Represent symbolic links with .rclonelink files', platforms: 'all' },
  { key: 'Refresh', group: 'vfs', flag: '--vfs-refresh', type: 'bool', defaultValue: false, description: 'Refresh the directory cache recursively at startup', platforms: 'all' },
  { key: 'UsedIsSize', group: 'vfs', flag: '--vfs-used-is-size', type: 'bool', defaultValue: false, description: 'Calculate used space by listing files', platforms: 'all' },
  { key: 'CaseInsensitive', group: 'vfs', flag: '--vfs-case-insensitive', type: 'bool', defaultValue: 'On Windows and macOS', description: 'Fall back to case-insensitive filename matching', platforms: 'all' },
  { key: 'BlockNormDupes', group: 'vfs', flag: '--vfs-block-norm-dupes', type: 'bool', defaultValue: false, description: 'Hide filenames that match after normalization', platforms: 'all' },
  { key: 'WriteWait', group: 'vfs', flag: '--vfs-write-wait', type: 'duration', defaultValue: '1s', description: 'Wait for sequential writes before failing', platforms: 'all' },
  { key: 'ReadWait', group: 'vfs', flag: '--vfs-read-wait', type: 'duration', defaultValue: '20ms', description: 'Wait for sequential reads before seeking', platforms: 'all' },
  { key: 'DirPerms', group: 'vfs', flag: '--dir-perms', type: 'int', defaultValue: '777', description: 'Directory permissions in octal', platforms: 'all', format: 'octal' },
  { key: 'FilePerms', group: 'vfs', flag: '--file-perms', type: 'int', defaultValue: '666', description: 'File permissions in octal', platforms: 'all', format: 'octal' },
  { key: 'LinkPerms', group: 'vfs', flag: '--link-perms', type: 'int', defaultValue: '666', description: 'Symbolic link permissions in octal', platforms: 'all', format: 'octal' },
  { key: 'Umask', group: 'vfs', flag: '--umask', type: 'int', defaultValue: '000', description: 'Permission bits to mask out in octal', platforms: UNIX, format: 'octal' },
  { key: 'UID', group: 'vfs', flag: '--uid', type: 'int', defaultValue: 'Current user ID', description: 'Override the reported owner ID', platforms: UNIX, format: 'id' },
  { key: 'GID', group: 'vfs', flag: '--gid', type: 'int', defaultValue: 'Current group ID', description: 'Override the reported group ID', platforms: UNIX, format: 'id' },
  { key: 'MetadataExtension', group: 'vfs', flag: '--vfs-metadata-extension', type: 'string', defaultValue: '', description: 'File extension for sidecar metadata', platforms: 'all' },
];

const UINT32_MAX = 0xffff_ffff;
const DURATION = /^(?:off|[+-]?(?:\d+(?:\.\d*)?|\.\d+)|[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:ns|[uµμ]s|ms|[smhdwMy]))+)$/u;
const SIZE = /^(?:off|\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:[kmgtpe](?:iB?)?|B)?)$/i;

function validValue(option: MountOption, value: unknown): value is MountOptionValue {
  if (option.type === 'bool') return typeof value === 'boolean';
  if (option.type === 'int' && option.format !== 'octal') {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && (option.format !== 'id' || value <= UINT32_MAX);
  }
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return false;
  switch (option.type) {
    case 'duration': return DURATION.test(value);
    case 'size': return SIZE.test(value);
    case 'int': return /^0*[0-7]{1,4}$/.test(value);
    case 'tristate': return value === 'true' || value === 'false';
    default: return true;
  }
}

export function validateOptionMap(group: MountOptionGroup, raw: unknown, invalid: 'throw' | 'discard' = 'throw'): MountOptionMap | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) {
    if (invalid === 'throw') throw new Error(`Invalid ${group.toUpperCase()} options.`);
    return undefined;
  }
  const validated: MountOptionMap = {};
  for (const [key, value] of Object.entries(raw)) {
    const option = MOUNT_OPTION_CATALOG.find((entry) => entry.group === group && entry.key === key);
    if (option && validValue(option, value)) validated[key] = value;
    else if (invalid === 'throw') throw new Error(option ? `Invalid value for ${option.flag}.` : `Unknown ${group} option.`);
  }
  return Object.keys(validated).length ? validated : undefined;
}
