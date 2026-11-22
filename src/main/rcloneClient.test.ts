import { afterEach, describe, expect, it, vi } from 'vitest';
import { RcloneClient } from './rcloneClient';

afterEach(() => vi.unstubAllGlobals());

describe('RcloneClient', () => {
  it('posts JSON with Basic auth and preserves the endpoint prefix', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    const auth = ['test-user', crypto.randomUUID()].join(':');
    const client = new RcloneClient('http://localhost:5572/rc-prefix', auth);
    await expect(client.call('rc/noop', { ok: true })).resolves.toEqual({ ok: true });
    const [url, opts] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('http://localhost:5572/rc-prefix/rc/noop');
    expect(opts).toMatchObject({ method: 'POST', body: '{"ok":true}', redirect: 'error' });
    expect(new Headers(opts?.headers).get('Authorization')).toBe(`Basic ${Buffer.from(auth).toString('base64')}`);
  });

  it('keeps secret config keys in the main process and identifies crypt target and defaults', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ remotes: ['vault'] }))
      .mockResolvedValueOnce(Response.json({ vault: { type: 'crypt', remote: 'drive:private', password: crypto.randomUUID() } })));
    const client = new RcloneClient('http://localhost:5572');
    await expect(client.listRemotes()).resolves.toEqual([{
      name: 'vault', type: 'crypt', isCrypt: true, targetRemote: 'drive', targetPath: 'private',
      filenameEncryption: 'standard', directoryNameEncryption: true,
      config: { type: 'crypt', remote: 'drive:private' },
    }]);
  });

  it('reports HTTP and malformed JSON failures', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      .mockResolvedValueOnce(Response.json([])));
    const client = new RcloneClient('http://localhost:5572');
    await expect(client.call('core/version')).rejects.toMatchObject({ status: 401 });
    await expect(client.call('core/version')).rejects.toThrow('invalid JSON data');
    expect(() => new RcloneClient('file:///tmp/rclone')).toThrow('HTTP(S)');
  });
});

describe('remote config projection', () => {
  it('keeps inline backend overrides out of IPC data', async () => {
    const secret = crypto.randomUUID();
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ remotes: ['vault'] }))
      .mockResolvedValueOnce(Response.json({ vault: { type: 'crypt', remote: `:s3,secret_access_key=${secret}:private` } })));
    const client = new RcloneClient('http://localhost:5572');
    const [vault] = await client.listRemotes();
    expect(vault).toMatchObject({ targetRemote: ':s3', targetPath: null, config: { remote: ':s3' } });
    expect(JSON.stringify(vault)).not.toContain(secret);
  });
});

describe('expanded RC transport', () => {
  it('posts optional options, filters, and job identifiers using the RC wire format', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({}));
    vi.stubGlobal('fetch', fetch);
    const client = new RcloneClient('http://localhost:5572');
    await client.call('config/update', { name: 'vault', parameters: { directory_name_encryption: true }, opt: { obscure: true } });
    await client.call('mount/mount', { fs: 'vault:', mountPoint: '/mnt/vault', mountType: 'mount', vfsOpt: { CacheMode: 'writes', ReadOnly: false } });
    await client.call('operations/copyfile', { srcFs: 'vault:', srcRemote: 'a', dstFs: 'drive:', dstRemote: 'b' });
    await client.call('sync/sync', {
      srcFs: 'vault:', dstFs: 'drive:', _async: true, _config: { DryRun: true }, _filter: { ExcludeRule: ['*.tmp'] },
    });
    await client.call('job/stop', { jobid: 12 });
    await client.call('core/quit');
    expect(fetch.mock.calls.map(([url, request]) => [new URL(String(url)).pathname, JSON.parse(String(request?.body))])).toEqual([
      ['/config/update', { name: 'vault', parameters: { directory_name_encryption: true }, opt: { obscure: true } }],
      ['/mount/mount', { fs: 'vault:', mountPoint: '/mnt/vault', mountType: 'mount', vfsOpt: { CacheMode: 'writes', ReadOnly: false } }],
      ['/operations/copyfile', { srcFs: 'vault:', srcRemote: 'a', dstFs: 'drive:', dstRemote: 'b' }],
      ['/sync/sync', { srcFs: 'vault:', dstFs: 'drive:', _async: true, _config: { DryRun: true }, _filter: { ExcludeRule: ['*.tmp'] } }],
      ['/job/stop', { jobid: 12 }],
      ['/core/quit', {}],
    ]);
  });

  it('omits transfer engine errors and inline FS parameters from projections', async () => {
    const secret = crypto.randomUUID();
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ transferred: [{ name: 'file.txt', size: 10, bytes: 0, checked: false, error: secret, srcFs: `:s3,token=${secret}:.` }] }))
      .mockResolvedValueOnce(Response.json({ mountPoints: [{ Fs: `:s3,token=${secret}:.`, MountPoint: '/mnt/s3' }] })));
    const client = new RcloneClient('http://localhost:5572');
    const data = [await client.transferred(), await client.mounts()];
    expect(data).toMatchObject([[{ name: 'file.txt', failed: true }], [{ fs: ':s3' }]]);
    expect(JSON.stringify(data)).not.toContain(secret);
  });
});
