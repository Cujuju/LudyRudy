import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { posix } from 'node:path';
import { VAULT_MOUNT } from './fixtures.mts';
import type { RcItem } from '../../src/main/rcloneClient.ts';

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
const DEMO_TIMESTAMP = '2026-11-20T18:45:00Z';
const REMOTES = {
  gdrive: { type: 'drive' },
  'gdrive-vault': { type: 'crypt', remote: 'gdrive:vault', filename_encryption: 'standard', directory_name_encryption: 'true' },
  'b2-backups': { type: 'b2' },
  's3-media': { type: 's3', provider: 'AWS', region: 'us-west-2' },
  'nas-sftp': { type: 'sftp', host: 'nas.example.test', port: '2222', key_use_agent: 'true' },
};

function item(path: string, type?: string, size = 0): RcItem {
  return { Path: path, Name: path.split('/').at(-1)!, Size: type ? size : -1, MimeType: type ?? 'inode/directory', ModTime: DEMO_TIMESTAMP, IsDir: !type };
}

const LISTINGS: Record<string, Record<string, RcItem[]>> = {
  gdrive: {
    '': [item('Documents'), item('Photos'), item('schedule.pdf', 'application/pdf', 850_000)],
    Documents: [item('Documents/field-notes.txt', 'text/plain', 12_000)],
  },
  'gdrive-vault': { '': [item('Archive'), item('Private'), { ...item('journal.txt', 'text/plain', 14_100), Encrypted: 'encrypted-journal' }] },
  'b2-backups': { '': [item('laptop-backups'), item('photo-backups')] },
  's3-media': { '': [item('media-library'), item('raw-uploads')] },
  'nas-sftp': { '': [item('home'), item('shared')] },
};
const PROVIDERS = [
  ['drive', 'Google Drive'], ['crypt', 'Encrypt and decrypt a remote'], ['b2', 'Backblaze B2'], ['s3', 'Amazon S3'],
  ['sftp', 'SSH File Transfer Protocol'], ['onedrive', 'Microsoft OneDrive'], ['dropbox', 'Dropbox'], ['webdav', 'WebDAV'],
  ['box', 'Box'], ['pcloud', 'pCloud'], ['mega', 'MEGA'], ['local', 'Local filesystem'], ['memory', 'In-memory storage'],
].map(([Name, Description]) => ({
  Name, Prefix: Name, Description, Options: Name === 'crypt' ? [
    { Name: 'remote', Required: true }, { Name: 'password', IsPassword: true, Required: true },
    { Name: 'filename_encryption', Default: 'standard', Exclusive: true, Examples: [
      { Value: 'standard', Help: 'Encrypt filenames' }, { Value: 'obfuscate', Help: 'Obfuscate filenames' },
      { Value: 'off', Help: 'Keep filenames visible' },
    ] }, { Name: 'directory_name_encryption', Default: true, Type: 'bool' },
  ] : Name === 'sftp' ? [
    { Name: 'host', Required: true, Sensitive: true }, { Name: 'user', Sensitive: true }, { Name: 'pass', IsPassword: true },
    { Name: 'key_use_agent', Default: false, Type: 'bool' },
    { Name: 'port', Default: 22, Advanced: true }, { Name: 'key_file', Advanced: true },
  ] : ['drive', 'onedrive', 'dropbox', 'box', 'pcloud'].includes(Name ?? '') ? [{ Name: 'token' }] : [],
}));
const TRANSFER = {
  name: 'Photos/field-trip.zip', size: 512 * MIB, bytes: 256 * MIB, speed: 8 * MIB, eta: 32,
  srcFs: 'gdrive:Photos', dstFs: 'gdrive-vault:Archive',
};

export async function startDemoRclone() {
  const auth = `demo:${randomUUID()}`;
  const authorization = `Basic ${Buffer.from(auth).toString('base64')}`;
  const mountPoints = new Map([[VAULT_MOUNT, { Fs: 'gdrive-vault:', MountPoint: VAULT_MOUNT, MountedOn: DEMO_TIMESTAMP }]]);
  const remotes: Record<string, Record<string, unknown>> = Object.assign(Object.create(null), structuredClone(REMOTES));
  const listings = new Map(Object.entries(structuredClone(LISTINGS)).map(([name, dirs]) => [
    name, new Map(Object.values(dirs).flatMap((entries) => entries.map((entry) => [entry.Path, entry] as const))),
  ]));
  const jobs = new Map<number, { stopped: boolean; started: number; work: () => void; success?: boolean }>();
  const JOB_DURATION_MS = 500;
  let nextJob = 0;
  let bandwidth = 'off';
  let statsReset = false;
  let failHistory = false;
  let completedName = 'Documents/reports.zip';
  let closing: Promise<void> | undefined;

  function asString(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Expected a string.');
    return value;
  }

  function configValues(parameters: unknown): Record<string, string> {
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new Error('Expected config parameters.');
    return Object.fromEntries(Object.entries(parameters).map(([key, value]) => [
      key, /^(password2?|pass)$/.test(key) ? '<obscured>' : String(value),
    ]));
  }

  function fsPath(fs: unknown, path: unknown = '') {
    const name = asString(fs).split(':')[0] ?? '';
    const entries = listings.get(name);
    if (!entries) throw new Error('Unknown remote.');
    const root = asString(fs).slice(name.length + 1).replace(/\/$/, '');
    const key = posix.join(root, asString(path)).replace(/^\.\/?$/, '');
    return { entries, key };
  }

  function children(entries: Map<string, RcItem>, path: string): RcItem[] {
    return [...entries.values()].filter(({ Path }) => Path === path || !path || Path.startsWith(path + '/'));
  }

  function makeDir(entries: Map<string, RcItem>, path: string): void {
    for (let dir = path; dir && dir !== '.'; dir = posix.dirname(dir)) {
      if (!entries.has(dir)) entries.set(dir, item(dir));
    }
  }

  function copyEntry(entries: Map<string, RcItem>, key: string, entry: RcItem): void {
    makeDir(entries, posix.dirname(key));
    entries.set(key, { ...entry, Path: key, Name: posix.basename(key) });
  }

  function transfer(input: Record<string, unknown>, move = false) {
    const source = fsPath(input.srcFs, input.srcRemote);
    const target = fsPath(input.dstFs, input.dstRemote);
    const entry = source.entries.get(source.key);
    if (!entry || entry.IsDir) throw new Error('Source file does not exist.');
    if (source.entries === target.entries && source.key === target.key) return {};
    copyEntry(target.entries, target.key, entry);
    if (move) source.entries.delete(source.key);
    return {};
  }

  function sync(input: Record<string, unknown>, mode: 'copy' | 'sync' | 'move') {
    const source = fsPath(input.srcFs);
    const target = fsPath(input.dstFs);
    const dryRun = (input._config as { DryRun?: boolean } | undefined)?.DryRun;
    const rules = (input._filter as { ExcludeRule?: string[] } | undefined)?.ExcludeRule ?? [];
    const excluded = (name: string) => rules.some((rule) => posix.matchesGlob(name, rule) || posix.matchesGlob(posix.basename(name), rule));
    const relative = (root: string, path: string) => root ? path.slice(root.length + 1) : path;
    const work = () => {
      if (dryRun) return;
      const registry = new Set<string>();
      const sourceEntries = children(source.entries, source.key);
      if (mode === 'move') makeDir(target.entries, target.key);
      for (const entry of sourceEntries) {
        const name = relative(source.key, entry.Path);
        if (!name || excluded(name)) continue;
        const key = posix.join(target.key, name);
        registry.add(key);
        copyEntry(target.entries, key, entry);
      }
      if (mode === 'move') for (const { Path } of sourceEntries) source.entries.delete(Path);
      if (mode === 'sync') {
        for (const entry of children(target.entries, target.key)) {
          const name = relative(target.key, entry.Path);
          if (name && !excluded(name) && !registry.has(entry.Path)) target.entries.delete(entry.Path);
        }
      }
    };
    if (input._async !== true) { work(); return {}; }
    const jobid = ++nextJob;
    jobs.set(jobid, { started: Date.now(), stopped: false, work });
    return { jobid, executeId: 'demo' };
  }

  function jobStatus(id: unknown) {
    if (typeof id !== 'number') throw new Error('Expected a job ID.');
    const job = jobs.get(id);
    if (!job) throw new Error('Unknown job.');
    if (job.success === undefined && (job.stopped || Date.now() - job.started >= JOB_DURATION_MS)) {
      try {
        if (!job.stopped) job.work();
        job.success = !job.stopped;
      } catch {
        job.success = false;
      }
    }
    return { id, executeId: 'demo', finished: job.success !== undefined, success: job.success ?? false, error: job.success === false ? 'Demo job failed or stopped.' : '' };
  }
  const methods: Record<string, (input: Record<string, unknown>) => object> = {
    '/rc/noop': (input) => input,
    '/core/version': () => ({ version: 'v1.76.0', os: process.platform === 'win32' ? 'windows' : process.platform }),
    '/core/pid': () => ({ pid: process.pid }),
    '/core/quit': () => { setImmediate(() => { void close().catch((error) => console.error('[demo]', error)); }); return {}; },
    '/core/stats-reset': () => { statsReset = true; return {}; },
    '/core/stats': () => statsReset ? { bytes: 0, totalBytes: 0, speed: 0, eta: null, transfers: 0, totalTransfers: 0, checks: 0, errors: 0 } : ({
      bytes: 768 * MIB, totalBytes: GIB, speed: TRANSFER.speed, eta: TRANSFER.eta,
      transfers: 2, totalTransfers: 3, checks: 12, errors: 0, transferring: [TRANSFER],
    }),
    '/core/transferred': () => {
      if (failHistory) {
        failHistory = false;
        throw new Error('Transfer history temporarily unavailable.');
      }
      return { transferred: statsReset ? [] : [{ name: completedName, size: 512 * MIB, bytes: 512 * MIB, checked: false, started_at: DEMO_TIMESTAMP, completed_at: DEMO_TIMESTAMP }] };
    },
    '/core/bwlimit': ({ rate }) => {
      if (typeof rate === 'string') bandwidth = rate;
      const mib = /^(\d+)Mi?$/.exec(bandwidth)?.[1];
      const bytes = bandwidth === 'off' ? -1 : mib === undefined ? undefined : Number(mib) * MIB;
      return { rate: mib === undefined ? bandwidth : `${mib}Mi`, bytesPerSecondTx: bytes, bytesPerSecondRx: bytes };
    },
    '/config/listremotes': () => ({ remotes: Object.keys(remotes) }),
    '/config/dump': () => remotes,
    '/config/get': ({ name }) => remotes[asString(name)] ?? {},
    '/config/paths': () => ({ config: '/demo/rclone.conf' }),
    '/config/providers': () => ({ providers: PROVIDERS }),
    '/config/create': ({ name: value, type, parameters }) => {
      const name = asString(value);
      if (listings.has(name) || !PROVIDERS.some(({ Name }) => Name === type)) throw new Error('Invalid remote configuration.');
      remotes[name] = { ...configValues(parameters), type };
      listings.set(name, new Map());
      return {};
    },
    '/config/update': ({ name: value, parameters, opt }) => {
      const name = asString(value);
      if (!listings.has(name)) throw new Error('Unknown remote.');
      remotes[name] = { ...remotes[name], ...configValues(parameters) };
      if (remotes[name].type === 'drive') {
        if (!opt || typeof opt !== 'object' || !('continue' in opt)) {
          return { State: 'client_id_warning', Option: { Name: 'config_shared_client_id', Type: 'bool' } };
        }
        if ('state' in opt && opt.state === 'client_id_warning' && 'result' in opt && opt.result === 'true') {
          return { State: '*oauth-confirm,teamdrive,oauth,', Option: { Name: 'config_refresh_token', Type: 'bool' } };
        }
        if ('state' in opt && opt.state === '*oauth-confirm,teamdrive,oauth,' && 'result' in opt && opt.result === 'false') {
          return { State: 'teamdrive_ok', Option: { Name: 'config_change_team_drive', Type: 'bool' } };
        }
        if (!('state' in opt) || opt.state !== 'teamdrive_ok' || !('result' in opt) || opt.result !== 'false') {
          return { Error: 'Unexpected demo continuation.' };
        }
      }
      return {};
    },
    '/config/delete': ({ name }) => {
      delete remotes[asString(name)];
      listings.delete(asString(name));
      return {};
    },
    '/mount/types': () => ({ mountTypes: ['mount', 'cmount'] }),
    '/mount/unmountall': () => { mountPoints.clear(); return {}; },
    '/mount/listmounts': () => ({ mountPoints: [...mountPoints.values()] }),
    '/mount/mount': ({ fs, mountPoint }) => {
      if (typeof fs !== 'string' || typeof mountPoint !== 'string') throw new Error('fs and mountPoint are required.');
      fsPath(fs);
      if (mountPoints.has(mountPoint)) throw new Error('Mount point is already in use.');
      mountPoints.set(mountPoint, { Fs: fs, MountPoint: mountPoint, MountedOn: new Date().toISOString() });
      return { mountPoint };
    },
    '/mount/unmount': ({ mountPoint }) => {
      if (typeof mountPoint !== 'string' || !mountPoints.delete(mountPoint)) throw new Error('Unknown mount point.');
      return {};
    },
    '/vfs/list': () => ({ vfses: [...new Set([...mountPoints.values()].map(({ Fs }) => Fs))] }),
    '/vfs/stats': ({ fs }) => {
      if (![...mountPoints.values()].some(({ Fs }) => Fs === fs)) throw new Error('Unknown VFS.');
      const { entries, key } = fsPath(fs);
      const mounted = children(entries, key);
      return { inUse: 0, metadataCache: { files: mounted.filter((entry) => !entry.IsDir).length, dirs: mounted.filter((entry) => entry.IsDir).length } };
    },
    '/vfs/refresh': ({ dir }) => ({ result: { [typeof dir === 'string' ? dir : '']: 'OK' } }),
    '/vfs/forget': ({ dir }) => ({ forgotten: typeof dir === 'string' ? [dir] : [] }),
    '/operations/list': ({ fs, remote, opt }) => {
      const { entries, key } = fsPath(fs, remote);
      const showEncrypted = opt && typeof opt === 'object' && 'showEncrypted' in opt && opt.showEncrypted === true;
      const list = children(entries, key).filter(({ Path }) => Path !== key && posix.dirname(Path) === (key || '.'));
      return { list: showEncrypted ? list : list.map(({ Encrypted: _, ...entry }) => entry) };
    },
    '/operations/stat': ({ fs, remote }) => {
      const { entries, key } = fsPath(fs, remote);
      return { item: key ? entries.get(key) ?? null : item('') };
    },
    '/operations/mkdir': ({ fs, remote }) => {
      const { entries, key } = fsPath(fs, remote);
      makeDir(entries, key);
      return {};
    },
    '/operations/deletefile': ({ fs, remote }) => {
      const { entries, key } = fsPath(fs, remote);
      if (entries.get(key)?.IsDir !== false) throw new Error('File does not exist.');
      entries.delete(key);
      return {};
    },
    '/operations/purge': ({ fs, remote }) => {
      const { entries, key } = fsPath(fs, remote);
      for (const { Path } of children(entries, key)) entries.delete(Path);
      return {};
    },
    '/operations/copyfile': (input) => transfer(input),
    '/operations/movefile': (input) => transfer(input, true),
    '/operations/about': () => ({ total: 100 * GIB, used: 42 * GIB, free: 58 * GIB, trashed: 0, other: 0 }),
    '/sync/copy': (input) => sync(input, 'copy'),
    '/sync/sync': (input) => sync(input, 'sync'),
    '/sync/move': (input) => sync(input, 'move'),
    '/job/list': () => ({ executeId: 'demo', jobids: [...jobs.keys()] }),
    '/job/status': ({ jobid }) => jobStatus(jobid),
    '/job/stop': ({ jobid }) => {
      const status = jobStatus(jobid);
      if (!status.finished) jobs.get(status.id)!.stopped = true;
      return {};
    },
  };

  const server = createServer(async (req, res) => {
    function reply(status: number, payload: object): void {
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload));
    }
    if (req.headers.authorization !== authorization) { reply(401, { error: 'Authentication required' }); return; }
    if (req.method !== 'POST') { reply(405, { error: 'Expected POST' }); return; }
    const method = methods[req.url ?? ''];
    if (!method) { reply(404, { error: 'Unknown RC method' }); return; }
    try {
      const body: Buffer[] = [];
      for await (const chunk of req as AsyncIterable<Buffer>) body.push(chunk);
      reply(200, method(JSON.parse(Buffer.concat(body).toString('utf8') || '{}')));
    } catch (error) {
      reply(400, { error: (error as Error).message });
    }
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Demo server did not bind a port.');
  function close(): Promise<void> {
    closing ??= new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    return closing;
  }
  return {
    endpoint: `http://127.0.0.1:${address.port}`, auth,
    close,
    replaceBrowserListing() {
      remotes.gdrive = { ...remotes.gdrive, root_folder_id: 'new-root' };
      const entry = item('Documents/new-root-file.txt', 'text/plain');
      listings.get('gdrive')?.set(entry.Path, entry);
    },
    replaceTransferHistory(name: string) { completedName = name; failHistory = true; },
  };
}
