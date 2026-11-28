import { safeStorage } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { normalizeSettings, type AppSettings } from '@shared/settings';
import { profileFile } from './paths';
import { createSerialQueue } from './serialQueue';

export function writeFileAtomic(file: string, value: Buffer | string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, value, { mode: 0o600, flag: 'wx' });
    renameSync(tmp, file);
  } finally {
    rmSync(tmp, { force: true });
  }
}

function readOptional(file: string): Buffer | null {
  try {
    return readFileSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

let current: AppSettings | undefined;
const listeners = new Set<(value: AppSettings) => void>();

export function getSettings(): AppSettings {
  if (current) return current;
  try {
    const file = readOptional(profileFile('settings.json'));
    current = normalizeSettings(file ? JSON.parse(file.toString('utf8')) : undefined);
  } catch (error) {
    console.error('[settings] Could not read settings.json:', error);
    current = normalizeSettings(undefined);
  }
  return current;
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next = normalizeSettings({ ...getSettings(), ...patch });
  writeFileAtomic(profileFile('settings.json'), JSON.stringify(next, null, 2));
  current = next;
  for (const listener of listeners) listener(next);
  return next;
}

export function onSettingsChange(listener: (settings: AppSettings) => void): void {
  listeners.add(listener);
}

async function requireEncryption(): Promise<void> {
  if (!await safeStorage.isAsyncEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
    throw new Error('The OS key store is unavailable.');
  }
}

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const secretFile = (path: string) => profileFile(`rclone-secret-${digest(existsSync(path) ? realpathSync(path) : resolve(path))}`);

const withSecrets = createSerialQueue();

async function decrypt(data: Buffer): Promise<string> {
  await requireEncryption();
  return (await safeStorage.decryptStringAsync(data)).result;
}

async function encrypt(value: string): Promise<Buffer> {
  await requireEncryption();
  return safeStorage.encryptStringAsync(value);
}

async function storeSecret(file: string, password: string | null): Promise<void> {
  if (password === null) rmSync(file, { force: true });
  else writeFileAtomic(file, await encrypt(password));
}

export function readConfigPassword(path: string): Promise<string | null> {
  return withSecrets(async () => {
    const file = secretFile(path);
    const pendingFile = file + '.pending';
    const pending = readOptional(pendingFile);
    if (pending) {
      const { password, configDigest } = JSON.parse(await decrypt(pending)) as { password: string | null; configDigest: string };
      const config = readOptional(path);
      if (config && digest(config) === configDigest) await storeSecret(file, password);
      rmSync(pendingFile, { force: true });
    }
    const data = readOptional(file);
    if (data) return (await decrypt(data)) || null;
    const legacyFile = profileFile('rclone-secret');
    const legacy = readOptional(legacyFile);
    if (!legacy) return null;
    const password = await decrypt(legacy);
    await storeSecret(file, password);
    rmSync(legacyFile, { force: true });
    return password;
  });
}

export function saveConfigPassword(path: string, password: string | null): Promise<void> {
  return withSecrets(() => storeSecret(secretFile(path), password));
}

export function replaceConfigWithPassword(path: string, stage: string, password: string | null): Promise<void> {
  return withSecrets(async () => {
    const file = secretFile(path);
    const pendingFile = file + '.pending';
    const configDigest = digest(readFileSync(stage));
    const encryptedPassword = password === null ? null : await encrypt(password);
    // A staged credential survives interruption between the config and key-store writes.
    writeFileAtomic(pendingFile, await encrypt(JSON.stringify({ password, configDigest })));
    try {
      renameSync(stage, path);
    } catch (error) {
      rmSync(pendingFile, { force: true });
      throw error;
    }
    if (encryptedPassword === null) rmSync(file, { force: true });
    else writeFileAtomic(file, encryptedPassword);
    rmSync(pendingFile, { force: true });
  });
}
