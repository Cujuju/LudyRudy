import { randomBytes } from 'node:crypto';
import type { CryptDraft, ProviderInfo, ProviderOptionSpec, RemoteDraft, RemoteEditorData, RemoteParameters, RemoteSummary } from '@shared/types';
import type { RcloneAuth } from './rcloneAuth';
import { describeFs, RcloneClient, remoteFs, validRemoteName } from './rcloneClient';
import { createSerialQueue } from './serialQueue';

const POPULAR = ['drive', 'crypt', 's3', 'b2', 'onedrive', 'dropbox', 'sftp', 'webdav', 'box', 'pcloud', 'mega', 'local'];
const OPTION_NAME = /^[a-z][a-z0-9_]*$/i;
const PASSWORD_NAME = /secret|password|token|pass$|private_key|key_pem|(?:api_key|sse_customer_key)$/i;
const CREDENTIAL_CONTAINERS = new Set(['headers', 'upstreams']);
const DEFAULT_SECRET_BITS = 256;
const MAX_SECRET_BITS = 4096;
const BITS_PER_BYTE = 8;
const WRITE_OPTIONS = { obscure: true, nonInteractive: true };

export function requireRemoteName(name: unknown): asserts name is string {
  if (!validRemoteName(name)) throw new Error('Invalid rclone remote name.');
}

export function generateSecret(bits = DEFAULT_SECRET_BITS): string {
  if (!Number.isSafeInteger(bits) || bits < BITS_PER_BYTE || bits > MAX_SECRET_BITS || bits % BITS_PER_BYTE) {
    throw new Error('Secret size must be a multiple of 8 between 8 and 4096 bits.');
  }
  return randomBytes(bits / BITS_PER_BYTE).toString('hex');
}

function optionSpec(raw: unknown): ProviderOptionSpec[] {
  if (!raw || typeof raw !== 'object') return [];
  const option = raw as Record<string, unknown>;
  const { Name, Help, Type, Required, Advanced, Provider, Default, DefaultStr, Exclusive, Examples, Sensitive, IsPassword } = option;
  if (typeof Name !== 'string' || !OPTION_NAME.test(Name)) return [];
  const password = IsPassword === true || PASSWORD_NAME.test(Name);
  const sensitive = password || Sensitive === true || CREDENTIAL_CONTAINERS.has(Name);
  const boolean = Type === 'bool' || typeof Default === 'boolean';
  const result: ProviderOptionSpec = {
    name: Name,
    input: password ? 'password' : boolean ? 'boolean' : 'text',
    ...(typeof Help === 'string' && Help ? { help: Help } : {}),
    ...(Required === true ? { required: true } : {}),
    ...(Advanced === true ? { advanced: true } : {}),
    ...(typeof Provider === 'string' && Provider ? { provider: Provider } : {}),
  };
  if (sensitive) return [{ ...result, sensitive: true }];
  if (typeof Default === 'boolean') result.defaultValue = Default;
  else if (typeof DefaultStr === 'string') result.defaultValue = DefaultStr;
  else if (typeof Default === 'string' || typeof Default === 'number') result.defaultValue = Default;
  if (Exclusive === true && !boolean && Array.isArray(Examples)) {
    result.choices = Examples.flatMap((raw: unknown) => {
      if (!raw || typeof raw !== 'object') return [];
      const { Value, Help, Provider } = raw as Record<string, unknown>;
      if (typeof Value !== 'string' || typeof Help !== 'string') return [];
      return [{ value: Value, help: Help, ...(typeof Provider === 'string' && Provider ? { provider: Provider } : {}) }];
    });
  }
  return [result];
}

function providerInfo(raw: Record<string, unknown>): ProviderInfo[] {
  if (!raw || typeof raw !== 'object') return [];
  const { Name, Description, Prefix, Options } = raw;
  if (typeof Name !== 'string' || typeof Description !== 'string' || typeof Prefix !== 'string') return [];
  const options = (Array.isArray(Options) ? Options : []).flatMap(optionSpec);
  return [{ name: Name, prefix: Prefix, description: Description, options, popular: POPULAR.includes(Name),
    isOAuth: options.some((option) => option.name === 'token'), isCrypt: Name === 'crypt' }];
}

function projectRemoteEditor(provider: ProviderInfo, config: Record<string, unknown>): RemoteEditorData {
  const sensitive = new Set(provider.options.filter((option) => option.sensitive).map(({ name }) => name));
  const values = Object.fromEntries(provider.options.flatMap(({ name }) => {
    if (sensitive.has(name) || !Object.hasOwn(config, name)) return [];
    const value = config[name];
    if (typeof value !== 'string') return [];
    // Connection strings can carry inline credentials even on options rclone doesn't mark sensitive.
    const url = URL.parse(value);
    if (url?.username || url?.password || url?.search || url?.hash ||
      (name === 'remote' && value && describeFs(value, false).path === null)) {
      sensitive.add(name);
      return [];
    }
    return [[name, value]];
  }));
  const options = provider.options.map((option) => sensitive.has(option.name) && !option.sensitive
    ? { ...option, sensitive: true, defaultValue: undefined, choices: undefined }
    : option);
  return { providers: [{ ...provider, options }], values };
}

function parameters(raw: RemoteParameters): RemoteParameters {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid remote parameters.');
  const values = Object.entries(raw);
  if (values.some(([key, value]) => !OPTION_NAME.test(key) || key.toLowerCase() === 'type'
    || (typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value))
    && !(typeof value === 'string' && !/[\r\n\0]/.test(value))))) {
    throw new Error('Invalid remote parameter.');
  }
  return Object.fromEntries(values);
}

function assertCryptTarget(remotes: RemoteSummary[], name: string, target: string): void {
  const visited = new Set([name]);
  let current: string | null = target;
  while (current) {
    if (visited.has(current)) throw new Error('Circular crypt remote chain.');
    visited.add(current);
    const remote: RemoteSummary | undefined = remotes.find((entry) => entry.name === current);
    if (!remote) throw new Error('Unknown crypt target remote.');
    current = remote.isCrypt ? remote.targetRemote : null;
  }
}

function validateCryptParameters(remotes: RemoteSummary[], name: string, config: RemoteParameters): void {
  const target = typeof config.remote === 'string' ? /^([^:]+):/.exec(config.remote)?.[1] : undefined;
  requireRemoteName(target);
  assertCryptTarget(remotes, name, target);
}

export function openRemotes(client: () => RcloneClient, auth: Pick<RcloneAuth, 'token'>) {
  const write = createSerialQueue();

  async function listProviders(rc = client()): Promise<ProviderInfo[]> {
    const { providers } = await rc.call('config/providers');
    if (!Array.isArray(providers)) throw new Error('rclone returned an invalid provider catalog.');
    const rank = (name: string) => POPULAR.includes(name) ? POPULAR.indexOf(name) : POPULAR.length;
    return providers.flatMap(providerInfo).sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  }

  function configFor(draft: RemoteDraft, provider: string): RemoteParameters {
    const config = parameters(draft.parameters);
    if (draft.authSessionId !== undefined) {
      if (typeof draft.authSessionId !== 'string') throw new Error('Invalid authorization session.');
      config.token = auth.token(draft.authSessionId, provider);
    }
    return config;
  }

  function createRemote(draft: RemoteDraft): Promise<void> {
    return write(async () => {
      requireRemoteName(draft?.name);
      const rc = client();
      const remotes = await rc.listRemotes();
      if (remotes.some(({ name }) => name === draft.name)) throw new Error('A remote with that name already exists.');
      const provider = (await listProviders(rc)).find(({ name }) => name === draft.type);
      if (!provider) throw new Error('Unknown rclone provider.');
      const config = configFor(draft, provider.name);
      if (provider.isCrypt) validateCryptParameters(remotes, draft.name, config);
      await rc.call('config/create', { name: draft.name, type: provider.name, parameters: config, opt: WRITE_OPTIONS });
    });
  }

  return {
    listProviders,
    async remoteEditor(remote?: Pick<RemoteSummary, 'name' | 'type'>): Promise<RemoteEditorData> {
      const rc = client();
      if (!remote) return { providers: await listProviders(rc), values: {} };
      requireRemoteName(remote.name);
      const [providers, config] = await Promise.all([listProviders(rc), rc.call('config/get', { name: remote.name })]);
      if (client() !== rc || config.type !== remote.type) throw new Error('The remote changed. Reopen the editor to reload its settings.');
      const provider = providers.find(({ name }) => name === config.type);
      if (!provider) throw new Error('Unknown rclone provider.');
      return projectRemoteEditor(provider, config);
    },
    createRemote,
    createCryptRemote(draft: CryptDraft): Promise<void> {
      requireRemoteName(draft?.targetRemote);
      if (typeof draft.targetPath !== 'string' || typeof draft.password !== 'string' || !draft.password ||
        (draft.salt !== undefined && typeof draft.salt !== 'string') ||
        !['standard', 'obfuscate', 'off'].includes(draft.filenameEncryption) || typeof draft.directoryNameEncryption !== 'boolean') {
        throw new Error('Invalid crypt remote settings.');
      }
      return createRemote({ name: draft.name, type: 'crypt', parameters: {
        remote: remoteFs(draft.targetRemote, draft.targetPath), password: draft.password,
        ...(draft.salt ? { password2: draft.salt } : {}), filename_encryption: draft.filenameEncryption,
        directory_name_encryption: draft.directoryNameEncryption,
      } });
    },
    updateRemote(draft: RemoteDraft): Promise<void> {
      return write(async () => {
        requireRemoteName(draft?.name);
        const rc = client();
        const remotes = await rc.listRemotes();
        const existing = remotes.find(({ name }) => name === draft.name);
        if (!existing) throw new Error('Unknown rclone remote.');
        if (draft.type !== existing.type) throw new Error('The remote provider cannot be changed.');
        const config = configFor(draft, existing.type);
        if (existing.isCrypt && 'remote' in config) validateCryptParameters(remotes, draft.name, config);
        await rc.call('config/update', { name: draft.name, parameters: config, opt: WRITE_OPTIONS });
      });
    },
    deleteRemote(name: string): Promise<void> {
      return write(async () => {
        requireRemoteName(name);
        await client().call('config/delete', { name });
      });
    },
    async testRemote(name: string): Promise<void> {
      requireRemoteName(name);
      const rc = client();
      const { remotes } = await rc.call('config/listremotes');
      if (!remotes?.includes(name)) throw new Error('Unknown rclone remote.');
      await rc.call('operations/stat', { fs: remoteFs(name), remote: '' });
    },
  };
}
