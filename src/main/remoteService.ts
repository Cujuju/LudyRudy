import { randomBytes } from 'node:crypto';
import type { CryptDraft, ProviderInfo, RemoteDraft, RemoteParameters, RemoteSummary } from '@shared/types';
import type { RcloneAuth } from './rcloneAuth';
import { RcloneClient, remoteFs, validRemoteName } from './rcloneClient';
import { createSerialQueue } from './serialQueue';

const POPULAR = ['drive', 'crypt', 's3', 'b2', 'onedrive', 'dropbox', 'sftp', 'webdav', 'box', 'pcloud', 'mega', 'local'];
const OPTION_FIELDS = ['Name', 'Help', 'Type', 'Required', 'IsPassword', 'Advanced', 'Provider', 'Exclusive'];
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

function providerInfo(raw: Record<string, unknown>): ProviderInfo[] {
  const { Name, Description, Prefix, Options } = raw;
  if (typeof Name !== 'string' || typeof Description !== 'string' || typeof Prefix !== 'string') return [];
  const options = (Array.isArray(Options) ? Options : []).flatMap((value: unknown) => {
    if (!value || typeof value !== 'object' || !('Name' in value) || typeof value.Name !== 'string') return [];
    const option = value as Record<string, unknown>;
    const fields = Object.entries(option).filter(([key, field]) => OPTION_FIELDS.includes(key) && ['string', 'boolean'].includes(typeof field));
    if (option.IsPassword !== true && !/secret|password|token|pass$|private_key/i.test(value.Name)) {
      if (['string', 'boolean', 'number'].includes(typeof option.Default)) fields.push(['Default', option.Default]);
      const examples = (Array.isArray(option.Examples) ? option.Examples : []).flatMap((example: unknown) => {
        if (!example || typeof example !== 'object' || !('Value' in example) || !('Help' in example)) return [];
        return typeof example.Value === 'string' && typeof example.Help === 'string' ? [{ Value: example.Value, Help: example.Help }] : [];
      });
      fields.push(['Examples', examples]);
    }
    return [Object.fromEntries(fields) as Record<string, unknown>];
  });
  return [{ name: Name, prefix: Prefix, description: Description, options, popular: POPULAR.includes(Name),
    isOAuth: options.some((option) => option.Name === 'token'), isCrypt: Name === 'crypt' }];
}

function parameters(raw: RemoteParameters): RemoteParameters {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid remote parameters.');
  const values = Object.entries(raw);
  if (values.some(([key, value]) => !/^[a-z][a-z0-9_]*$/i.test(key) || key.toLowerCase() === 'type'
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

  async function listProviders(): Promise<ProviderInfo[]> {
    const { providers } = await client().call('config/providers');
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
      const provider = (await listProviders()).find(({ name }) => name === draft.type);
      if (!provider) throw new Error('Unknown rclone provider.');
      const config = configFor(draft, provider.name);
      if (provider.isCrypt) validateCryptParameters(remotes, draft.name, config);
      await rc.call('config/create', { name: draft.name, type: provider.name, parameters: config, opt: WRITE_OPTIONS });
    });
  }

  return {
    listProviders,
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
