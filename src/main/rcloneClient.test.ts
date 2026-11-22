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
