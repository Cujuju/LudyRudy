import { safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalizeSettings, type AppSettings } from '@shared/settings';
import { profileFile } from './paths';

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

export function updateGeneral(patch: Partial<AppSettings['general']>): AppSettings {
  const settings = getSettings();
  const next = normalizeSettings({ ...settings, general: { ...settings.general, ...patch } });
  writeFileAtomic(profileFile('settings.json'), JSON.stringify(next, null, 2));
  current = next;
  for (const listener of listeners) listener(next);
  return next;
}

export function onSettingsChange(listener: (settings: AppSettings) => void): void {
  listeners.add(listener);
}

function requireEncryption(): void {
  if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
    throw new Error('The OS key store is unavailable.');
  }
}

export function readConfigPassword(): string | null {
  const data = readOptional(profileFile('rclone-secret'));
  if (!data) return null;
  requireEncryption();
  return safeStorage.decryptString(data);
}

export function saveConfigPassword(value: string | null): void {
  const file = profileFile('rclone-secret');
  if (value === null) { rmSync(file, { force: true }); return; }
  requireEncryption();
  writeFileAtomic(file, safeStorage.encryptString(value));
}
