import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CryptDraft } from '@shared/types';
import { generateSecret, openRemotes, requireRemoteName } from './remoteService';
import { RcloneClient } from './rcloneClient';

const secret = () => crypto.randomUUID();
const fixture = (dump: Record<string, Record<string, string>>) => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input) => {
    switch (new URL(String(input)).pathname) {
      case '/config/listremotes': return Response.json({ remotes: Object.keys(dump) });
      case '/config/dump': return Response.json(dump);
      case '/config/providers': return Response.json({ providers: [
        { Name: 'z-other', Prefix: 'other', Description: 'Other', Options: [] },
        { Name: 'crypt', Prefix: 'crypt', Description: 'Crypt', Options: [{ Name: 'password', IsPassword: true, Default: secret() }] },
        { Name: 'drive', Prefix: 'drive', Description: 'Drive', Options: [{ Name: 'token' }] },
      ] });
      default: return Response.json({});
    }
  });
  vi.stubGlobal('fetch', fetch);
  const client = new RcloneClient('http://localhost:5572');
  return { fetch, service: openRemotes(() => client, { token: vi.fn() }) };
};

const crypt = (targetRemote: string): CryptDraft => ({
  name: 'vault', targetRemote, targetPath: 'private', password: secret(), salt: secret(),
  filenameEncryption: 'standard', directoryNameEncryption: true,
});

afterEach(() => vi.unstubAllGlobals());

describe('remote names and catalog', () => {
  it.each(['-remote', 'a:b', 'a/b', 'a\\b', '', ' remote', 'remote ', 'remote\n', 'drive,token=secret'])('rejects %j', (name) => {
    expect(() => requireRemoteName(name)).toThrow('Invalid rclone remote name');
  });

  it('accepts valid Unicode names and generates random secrets by bit size', () => {
    expect(() => requireRemoteName('Résumés 2026-a')).not.toThrow();
    expect(generateSecret(128)).toMatch(/^[0-9a-f]{32}$/);
    expect(generateSecret()).not.toBe(generateSecret());
    expect(() => generateSecret(9)).toThrow();
  });

  it('prioritizes popular providers and removes password defaults', async () => {
    const { service } = fixture({});
    const providers = await service.listProviders();
    expect(providers.map(({ name }) => name)).toEqual(['drive', 'crypt', 'z-other']);
    expect(providers[0]).toMatchObject({ popular: true, isOAuth: true });
    expect(providers[1]?.options[0]).toEqual({ Name: 'password', IsPassword: true });
  });
});

describe('crypt service', () => {
  it('writes named crypt options and requests rclone obscuring', async () => {
    const { service, fetch } = fixture({ drive: { type: 'drive' } });
    const draft = crypt('drive');
    await service.createCryptRemote(draft);
    const [url, options] = fetch.mock.lastCall!;
    expect(new URL(String(url)).pathname).toBe('/config/create');
    expect(JSON.parse(String(options?.body))).toEqual({
      name: 'vault', type: 'crypt', opt: { obscure: true, nonInteractive: true }, parameters: {
        remote: 'drive:private', password: draft.password, password2: draft.salt,
        filename_encryption: 'standard', directory_name_encryption: true,
      },
    });
  });

  it('rejects unknown targets, self-targets, and existing cycles', async () => {
    const { service, fetch } = fixture({ a: { type: 'crypt', remote: 'b:' }, b: { type: 'crypt', remote: 'a:' } });
    await expect(service.createCryptRemote(crypt('missing'))).rejects.toThrow('Unknown crypt target');
    await expect(service.createCryptRemote(crypt('vault'))).rejects.toThrow('Circular crypt');
    await expect(service.createCryptRemote(crypt('a'))).rejects.toThrow('Circular crypt');
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/config/create'))).toBe(false);
  });

  it('rejects an update that introduces a cycle through another crypt remote', async () => {
    const { service } = fixture({ a: { type: 'crypt', remote: 'b:' }, b: { type: 'crypt', remote: 'drive:' }, drive: { type: 'drive' } });
    await expect(service.updateRemote({ name: 'b', type: 'crypt', parameters: { remote: 'a:' } })).rejects.toThrow('Circular crypt');
  });
});
