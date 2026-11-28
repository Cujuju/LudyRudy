type Check<Value = unknown> = (value: unknown) => value is Value;
type Checked<C> = C extends Check<infer Value> ? Value : never;
type Fields<F> = {
  [K in keyof F as undefined extends Checked<F[K]> ? never : K]: Checked<F[K]>;
} & {
  [K in keyof F as undefined extends Checked<F[K]> ? K : never]?: Checked<F[K]>;
};

const isRecord: Check<Record<string, unknown>> = (value): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const string: Check<string> = (value): value is string => typeof value === 'string';
const nonEmptyString: Check<string> = (value): value is string => string(value) && value.length > 0;
const boolean: Check<boolean> = (value): value is boolean => typeof value === 'boolean';
const number: Check<number> = (value): value is number => typeof value === 'number' && Number.isFinite(value);
const id: Check<number> = (value): value is number => number(value) && Number.isSafeInteger(value) && value > 0;

const optional = <T>(check: Check<T>): Check<T | undefined> => (value): value is T | undefined =>
  value === undefined || check(value);
const nullable = <T>(check: Check<T>): Check<T | null> => (value): value is T | null =>
  value === null || check(value);
const arrayOf = <T>(check: Check<T>): Check<T[]> => (value): value is T[] =>
  Array.isArray(value) && value.every(check);
const recordOf = <T>(check: Check<T>): Check<Record<string, T>> => (value): value is Record<string, T> =>
  isRecord(value) && Object.values(value).every(check);

function shape<F extends Record<string, Check>>(fields: F): Check<Fields<F>> {
  const entries = Object.entries(fields);
  return (value): value is Fields<F> => {
    if (!isRecord(value)) return false;
    for (const [key, check] of entries) {
      if (!check(Object.hasOwn(value, key) ? value[key] : undefined)) return false;
    }
    return true;
  };
}

const item = shape({
  Path: string, Name: string, Size: number, IsDir: boolean,
  MimeType: optional(string), ModTime: optional(string), ID: optional(string),
  Tier: optional(string), Encrypted: optional(string),
});
export type RcItem = Checked<typeof item>;

const mount = shape({ Fs: nonEmptyString, MountPoint: nonEmptyString, MountedOn: optional(string) });
const transfer = shape({
  name: string, size: number, srcFs: optional(nullable(string)), dstFs: optional(nullable(string)),
  // rclone omits progress until the transfer has an accounting stream.
  bytes: optional(number), speed: optional(number), eta: optional(nullable(number)),
});
const completed = shape({
  name: string, size: number, bytes: number, checked: boolean,
  started_at: string, completed_at: string, error: optional(string),
});
const config = recordOf(string);
const provider = shape({
  Name: nonEmptyString, Description: string, Prefix: nonEmptyString,
  Options: nullable(arrayOf(shape({ Name: nonEmptyString }))),
});
const quota = optional(nullable(number));
const jobStarted = shape({ jobid: id, executeId: optional(nonEmptyString) });

const responses = {
  'rc/noop': isRecord,
  'core/version': shape({ version: nonEmptyString, os: optional(string) }),
  'core/pid': shape({ pid: id }),
  'core/quit': isRecord,
  'core/stats': shape({
    bytes: number, totalBytes: number, speed: number, eta: nullable(number),
    transfers: number, totalTransfers: number, checks: number, errors: number,
    transferring: optional(nullable(arrayOf(transfer))),
  }),
  'core/stats-reset': isRecord,
  'core/transferred': shape({ transferred: nullable(arrayOf(completed)) }),
  'core/bwlimit': shape({ rate: nonEmptyString, bytesPerSecondTx: optional(number), bytesPerSecondRx: optional(number) }),
  'config/listremotes': shape({ remotes: nullable(arrayOf(nonEmptyString)) }),
  'config/dump': recordOf(config),
  'config/get': config,
  'config/paths': shape({ config: string }),
  'config/providers': shape({ providers: arrayOf(provider) }),
  // The service recognizes supported prompts and can report partial writes.
  'config/create': isRecord,
  'config/update': isRecord,
  'config/delete': isRecord,
  'mount/listmounts': shape({ mountPoints: nullable(arrayOf(mount)) }),
  'mount/types': shape({ mountTypes: nullable(arrayOf(nonEmptyString)) }),
  // rclone before v1.74 returns an empty object after mounting.
  'mount/mount': shape({ mountPoint: optional(nonEmptyString) }),
  'mount/unmount': isRecord,
  'mount/unmountall': isRecord,
  'vfs/list': shape({ vfses: nullable(arrayOf(nonEmptyString)) }),
  'vfs/stats': shape({ inUse: number, metadataCache: shape({ files: number, dirs: number }) }),
  'vfs/refresh': isRecord,
  'vfs/forget': isRecord,
  'operations/list': shape({ list: nullable(arrayOf(item)) }),
  'operations/about': shape({ total: quota, used: quota, free: quota, trashed: quota, other: quota }),
  'operations/stat': shape({ item: nullable(item) }),
  'operations/mkdir': isRecord,
  'operations/deletefile': isRecord,
  'operations/purge': isRecord,
  'operations/copyfile': isRecord,
  'operations/movefile': isRecord,
  'sync/move': isRecord,
  'sync/copy': jobStarted,
  'sync/sync': jobStarted,
  'job/list': shape({ jobids: arrayOf(id), executeId: optional(nonEmptyString) }),
  'job/status': shape({ executeId: optional(nonEmptyString), finished: boolean, success: boolean, error: optional(string) }),
  'job/stop': isRecord,
};

export type RcResponse<K extends keyof typeof responses> = Checked<(typeof responses)[K]>;
export function decodeRcResponse<K extends keyof typeof responses>(method: K, value: unknown): RcResponse<K> {
  if (!isRecord(value)) throw new Error(`rclone ${method} returned invalid JSON data.`);
  const check: Check<RcResponse<K>> = responses[method] as Check<RcResponse<K>>;
  if (!check(value)) throw new Error(`rclone ${method} returned an invalid response.`);
  return value;
}
