import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CryptDraft } from '@shared/types';
import { generateSecret, openRemotes, requireRemoteName } from './remoteService';
import { RcloneClient } from './rcloneClient';

const secret = () => crypto.randomUUID();
const fixture = (dump: Record<string, Record<string, string>>, responses: Record<string, unknown>[] = []) => {
  const daemon = { executeId: 'rclone-instance', configPath: '/fixture/rclone.conf', connected: true };
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input, options) => {
    switch (new URL(String(input)).pathname) {
      case '/job/list': return Response.json({ jobids: [], executeId: daemon.executeId });
      case '/config/paths': return Response.json({ config: daemon.configPath });
      case '/config/listremotes': return Response.json({ remotes: Object.keys(dump) });
      case '/config/dump': return Response.json(dump);
      case '/config/get': return Response.json(dump[JSON.parse(String(options?.body)).name] ?? {});
      case '/config/create': {
        const { name, type } = JSON.parse(String(options?.body));
        dump[name] = { type };
        return Response.json(responses.shift() ?? {});
      }
      case '/config/update': return Response.json(responses.shift() ?? {});
      case '/config/providers': return Response.json({ providers: [
        { Name: 'z-other', Prefix: 'other', Description: 'Other', Options: [] },
        { Name: 'crypt', Prefix: 'crypt', Description: 'Crypt', Options: [{ Name: 'password', IsPassword: true, Default: secret() }] },
        { Name: 'drive', Prefix: 'drive', Description: 'Drive', Options: [
          { Name: 'token' }, { Name: 'client_id' }, { Name: 'client_secret', Sensitive: true }, { Name: 'scope' }, { Name: 'chunk_size' },
        ] },
        { Name: 'sftp', Prefix: 'sftp', Description: 'SFTP', Options: [
          { Name: 'user', Sensitive: true, Default: secret(), ValueStr: secret(), Examples: [{ Value: secret(), Help: secret() }], Exclusive: true },
          { Name: 'pass', IsPassword: true, DefaultStr: secret() },
          { Name: 'key_use_agent', Type: 'bool', Default: false },
          { Name: 'port', Default: 22 },
          { Name: 'idle_timeout', Type: 'Duration', Default: 60_000_000_000, DefaultStr: '1m0s' },
          { Name: 'remote' },
          { Name: 'url', Default: 'https://default.example.test/' },
          { Name: 'headers' },
          { Name: 'ibm_api_key' },
          { Name: 'sse_customer_key' },
          { Name: 'sse_customer_key_file' },
        ] },
      ] });
      default: return Response.json({});
    }
  });
  vi.stubGlobal('fetch', fetch);
  const client = new RcloneClient('http://localhost:5572');
  const token = vi.fn(() => secret());
  return { fetch, daemon, token, service: openRemotes({ client: () => client, isCurrentClient: () => daemon.connected }, { token }) };
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
    expect(providers.map(({ name }) => name)).toEqual(['drive', 'crypt', 'sftp', 'z-other']);
    expect(providers[0]).toMatchObject({ popular: true, isOAuth: true });
    expect(providers[1]?.options[0]).toEqual({ name: 'password', input: 'password', sensitive: true });
    expect(providers[2]?.options[0]).toEqual({ name: 'user', input: 'text', sensitive: true });
    expect(providers[2]?.options).toContainEqual({ name: 'idle_timeout', input: 'text', defaultValue: '1m0s' });
  });

  it('projects only registered non-sensitive values from the actual saved provider', async () => {
    const { service } = fixture({ nas: {
      type: 'sftp', port: '2222', key_use_agent: 'true', user: secret(), pass: secret(),
      unknown: secret(), url: `https://example.test/?token=${secret()}`,
      remote: `drive,token=${secret()}:path`, headers: `Authorization,Bearer ${secret()}`,
      ibm_api_key: secret(), sse_customer_key: secret(), sse_customer_key_file: '/path/to/key-file',
    } });
    const editor = await service.remoteEditor({ name: 'nas', type: 'sftp' });
    expect(editor.providers.map(({ name }) => name)).toEqual(['sftp']);
    expect(editor.values).toEqual({ port: '2222', key_use_agent: 'true', sse_customer_key_file: '/path/to/key-file' });
    const options = editor.providers[0]?.options ?? [];
    for (const name of ['url', 'remote', 'headers', 'ibm_api_key', 'sse_customer_key']) {
      const option = options.find((field) => field.name === name);
      expect(option?.sensitive).toBe(true);
      expect(option?.defaultValue).toBeUndefined();
    }
    await expect(service.remoteEditor({ name: 'nas', type: 'drive' })).rejects.toThrow('The remote changed');
  });
});

describe('effective OAuth configuration', () => {
  it('uses draft options for a new remote and never accepts a pre-existing token', async () => {
    const { service, token } = fixture({});
    const draft = { type: 'drive', parameters: { client_id: 'app-client', client_secret: secret(), token: secret(), scope: 'drive.readonly' } };
    const prepared = await service.authorization(draft);
    expect(prepared.values).toEqual({ client_id: 'app-client', client_secret: draft.parameters.client_secret, scope: 'drive.readonly' });
    await service.createRemote({ ...draft, name: 'new-drive', authSessionId: 'session' });
    expect(token).toHaveBeenCalledWith('session', prepared);
  });

  it('reconnects with saved write-only credentials and applies explicit changes', async () => {
    const saved = { type: 'drive', client_id: 'saved-client', client_secret: secret(), token: secret(), scope: 'drive', unrelated: secret(), chunk_size: '' };
    const { service, token, fetch } = fixture({ photos: saved });
    const draft = { name: 'photos', type: 'drive', parameters: { scope: 'drive.readonly' } };
    const prepared = await service.authorization(draft);
    expect(prepared.values).toEqual({ client_id: 'saved-client', client_secret: saved.client_secret, scope: 'drive.readonly' });
    const editor = await service.remoteEditor(draft);
    expect(JSON.stringify(editor)).not.toContain(saved.client_secret);
    await service.updateRemote({ ...draft, authSessionId: 'session' });
    expect(token).toHaveBeenCalledWith('session', prepared);
    const body = JSON.parse(String(fetch.mock.lastCall?.[1]?.body));
    expect(body.parameters).toEqual({ scope: 'drive.readonly', token: token.mock.results[0]?.value });
  });

  it('omits explicitly cleared options after merging the saved config', async () => {
    const { service } = fixture({ photos: { type: 'drive', scope: 'drive', chunk_size: '32Mi' } });
    const prepared = await service.authorization({ name: 'photos', type: 'drive', parameters: { scope: '', chunk_size: '' } });
    expect(prepared.values).toEqual({});
  });

  it('requires a valid request and a verifiable daemon identity before authorization or token use', async () => {
    const { daemon, fetch, service, token } = fixture({});
    await expect(service.authorization(null!)).rejects.toThrow('Invalid authorization request');
    expect(fetch).not.toHaveBeenCalled();
    daemon.executeId = '';
    const draft = { name: 'new-drive', type: 'drive', parameters: {} };
    await expect(service.authorization(draft)).rejects.toThrow('Could not identify the rclone daemon');
    await expect(service.createRemote({ ...draft, authSessionId: 'session' })).rejects.toThrow('Could not identify the rclone daemon');
    expect(token).not.toHaveBeenCalled();
  });
});

describe('configuration continuation', () => {
  const drive = { name: 'drive', type: 'drive', parameters: {} };
  const sharedClient = { State: 'client_id_warning', Option: { Name: 'config_shared_client_id', Type: 'bool' } };

  it('reopens a pending create and continues using its main-process state', async () => {
    const opaqueState = secret();
    const dump: Record<string, Record<string, string>> = {};
    const { fetch, service } = fixture(dump, [
      { ...sharedClient, State: opaqueState },
      { State: '*oauth-confirm,teamdrive,oauth,', Option: { Name: 'config_refresh_token', Type: 'bool' } },
      { State: 'teamdrive_ok', Option: { Name: 'config_change_team_drive', Type: 'bool' } },
      { State: '', Option: null, Error: '', Result: '' },
    ]);
    const reply = await service.createRemote(drive);
    if (reply.state !== 'pending') throw new Error('Missing shared client prompt.');
    expect(reply).toEqual({ state: 'pending', id: expect.any(String), question: 'shared-client' });
    expect(JSON.stringify(reply)).not.toContain(opaqueState);
    const editor = await service.remoteEditor(drive);
    expect(editor.configuration).toEqual(reply);
    const next = await service.continueRemoteConfig(reply.id, true);
    if (next.state !== 'pending') throw new Error('Missing token confirmation.');
    expect(next.question).toBe('refresh-token');
    expect(fetch.mock.calls.some(([url, options]) => new URL(String(url)).pathname === '/config/update'
      && JSON.parse(String(options?.body)).opt.state === opaqueState)).toBe(true);
    await expect(service.continueRemoteConfig(reply.id, true)).resolves.toMatchObject({ state: 'incomplete' });
    await expect(service.continueRemoteConfig(next.id, true)).rejects.toThrow('Invalid configuration answer');
    const last = await service.continueRemoteConfig(next.id, false);
    if (last.state !== 'pending') throw new Error('Missing shared drive prompt.');
    expect(last.question).toBe('shared-drive');
    await expect(service.continueRemoteConfig(last.id, true)).rejects.toThrow('Invalid configuration answer');
    await expect(service.continueRemoteConfig(last.id, false)).resolves.toEqual({ state: 'complete' });
    expect((await service.remoteEditor(drive)).configuration).toBeUndefined();
  });

  it('rejects continuing after an external edit to the same remote', async () => {
    const dump = { drive: { type: 'drive', scope: 'drive' } };
    const { fetch, service } = fixture(dump, [sharedClient]);
    const reply = await service.updateRemote(drive);
    if (reply.state !== 'pending') throw new Error('Missing continuation.');
    dump.drive.scope = 'drive.readonly';
    const calls = fetch.mock.calls.length;
    await expect(service.continueRemoteConfig(reply.id, true)).resolves.toMatchObject({ state: 'incomplete', message: expect.stringContaining('remote changed') });
    expect(fetch.mock.calls.slice(calls).map(([url]) => new URL(String(url)).pathname)).not.toContain('/config/update');
  });

  it.each(['executeId', 'configPath'] as const)('checks the saved %s even when an attached client is reused', async (field) => {
    const { daemon, service } = fixture({ drive: { type: 'drive' } }, [sharedClient]);
    const reply = await service.updateRemote(drive);
    if (reply.state !== 'pending') throw new Error('Missing continuation.');
    daemon[field] += '-changed';
    expect((await service.remoteEditor(drive)).configuration).toBeUndefined();
    await expect(service.continueRemoteConfig(reply.id, true)).resolves.toMatchObject({ state: 'incomplete' });
  });

  it.each(['disconnect', 'missing remote'])('reports an incomplete write when the post-write check finds %s', async (failure) => {
    const dump = { drive: { type: 'drive' } };
    const { daemon, fetch, service } = fixture(dump, [sharedClient]);
    const implementation = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (input, options) => {
      if (new URL(String(input)).pathname === '/config/get') {
        if (failure === 'missing remote') return Response.json({});
        daemon.connected = false;
      }
      return implementation(input, options);
    });
    await expect(service.updateRemote(drive)).resolves.toMatchObject({
      state: 'incomplete', message: expect.stringContaining('could not be resumed'),
    });
  });

  it('reports unsupported questions and embedded errors without returning backend values', async () => {
    const privateValue = secret();
    const { service } = fixture({ drive: { type: 'drive' } }, [
      { State: privateValue, Option: { Name: 'config_token', Default: privateValue } },
      { Error: privateValue },
      {},
    ]);
    const unsupported = await service.updateRemote(drive);
    const failure = await service.updateRemote(drive);
    expect(unsupported).toMatchObject({ state: 'incomplete', message: expect.stringContaining('cannot display') });
    expect(failure).toMatchObject({ state: 'incomplete', message: expect.stringContaining('configuration error') });
    expect(JSON.stringify([unsupported, failure])).not.toContain(privateValue);
    await expect(service.updateRemote(drive)).resolves.toEqual({ state: 'complete' });
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
