import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { RcItem } from '../../src/main/rcloneClient.ts';

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
const DEMO_TIMESTAMP = '2026-11-20T18:45:00Z';
const REMOTES = {
  gdrive: { type: 'drive' },
  'gdrive-vault': { type: 'crypt', remote: 'gdrive:vault', filename_encryption: 'standard', directory_name_encryption: 'true' },
  'b2-backups': { type: 'b2' },
  's3-media': { type: 's3', provider: 'AWS', region: 'us-west-2' },
  'nas-sftp': { type: 'sftp', host: 'nas.example.test' },
};

function item(path: string, type?: string, size = 0): RcItem {
  return { Path: path, Name: path.split('/').at(-1)!, Size: type ? size : -1, MimeType: type ?? 'inode/directory', ModTime: DEMO_TIMESTAMP, IsDir: !type };
}

const LISTINGS: Record<string, Record<string, RcItem[]>> = {
  gdrive: {
    '': [item('Documents'), item('Photos'), item('schedule.pdf', 'application/pdf', 850_000)],
    Documents: [item('Documents/field-notes.txt', 'text/plain', 12_000)],
  },
  'gdrive-vault': { '': [item('Archive'), item('Private'), item('journal.txt', 'text/plain', 14_100)] },
  'b2-backups': { '': [item('laptop-backups'), item('photo-backups')] },
  's3-media': { '': [item('media-library'), item('raw-uploads')] },
  'nas-sftp': { '': [item('home'), item('shared')] },
};
const PROVIDERS = [
  { Name: 'drive', Prefix: 'drive', Description: 'Google Drive', Options: [{ Name: 'token' }] },
  { Name: 'crypt', Prefix: 'crypt', Description: 'Encrypt and decrypt a remote', Options: [{ Name: 'remote', Required: true }, { Name: 'password', IsPassword: true }] },
  { Name: 'b2', Prefix: 'b2', Description: 'Backblaze B2', Options: [] },
  { Name: 's3', Prefix: 's3', Description: 'Amazon S3', Options: [] },
  { Name: 'sftp', Prefix: 'sftp', Description: 'SSH File Transfer Protocol', Options: [] },
];
const TRANSFER = { name: 'Photos/field-trip.zip', size: 512 * MIB, bytes: 256 * MIB, speed: 8 * MIB, eta: 32 };

export async function startDemoRclone() {
  const auth = `demo:${randomUUID()}`;
  const authorization = `Basic ${Buffer.from(auth).toString('base64')}`;
  const mountPoints = new Map([['/demo/vault', { Fs: 'gdrive-vault:', MountPoint: '/demo/vault', MountedOn: DEMO_TIMESTAMP }]]);
  let bandwidth = 'off';
  const methods: Record<string, (input: Record<string, unknown>) => object> = {
    '/rc/noop': (input) => input,
    '/core/version': () => ({ version: 'v1.76.0' }),
    '/core/pid': () => ({ pid: process.pid }),
    '/core/stats': () => ({
      bytes: 768 * MIB, totalBytes: GIB, speed: TRANSFER.speed, eta: TRANSFER.eta,
      transfers: 2, totalTransfers: 3, checks: 12, errors: 0, transferring: [TRANSFER],
    }),
    '/core/transferred': () => ({ transferred: [{ name: 'Documents/reports.zip', size: 512 * MIB, bytes: 512 * MIB, checked: false }] }),
    '/core/bwlimit': ({ rate }) => {
      if (typeof rate === 'string') bandwidth = rate;
      return { rate: bandwidth };
    },
    '/config/listremotes': () => ({ remotes: Object.keys(REMOTES) }),
    '/config/dump': () => REMOTES,
    '/config/paths': () => ({ config: '/demo/rclone.conf' }),
    '/config/providers': () => ({ providers: PROVIDERS }),
    '/mount/listmounts': () => ({ mountPoints: [...mountPoints.values()] }),
    '/mount/mount': ({ fs, mountPoint }) => {
      if (typeof fs !== 'string' || typeof mountPoint !== 'string') throw new Error('fs and mountPoint are required.');
      mountPoints.set(mountPoint, { Fs: fs, MountPoint: mountPoint, MountedOn: new Date().toISOString() });
      return { mountPoint };
    },
    '/mount/unmount': ({ mountPoint }) => {
      if (typeof mountPoint !== 'string' || !mountPoints.delete(mountPoint)) throw new Error('Unknown mount point.');
      return {};
    },
    '/operations/list': ({ fs, remote }) => {
      const name = typeof fs === 'string' ? fs.split(':')[0] ?? '' : '';
      if (!Object.hasOwn(LISTINGS, name) || typeof remote !== 'string') throw new Error('Unknown remote.');
      const listings = LISTINGS[name]!;
      return { list: Object.hasOwn(listings, remote) ? listings[remote] : [] };
    },
    '/operations/about': () => ({ total: 100 * GIB, used: 42 * GIB, free: 58 * GIB, trashed: 0, other: 0 }),
    '/job/list': () => ({ executeId: 'demo', jobids: [1, 2], runningIds: [2], finishedIds: [1] }),
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
  return {
    endpoint: `http://127.0.0.1:${address.port}`, auth,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
