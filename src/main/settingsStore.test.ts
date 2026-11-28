import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ profileFile: vi.fn<(name: string) => string>() }));
vi.mock('./paths', () => ({ profileFile: mocks.profileFile }));
vi.mock('electron', () => ({
  safeStorage: {
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => 'test',
    encryptStringAsync: async (value: string) => Buffer.from(value),
  },
}));

let directory: string;
beforeEach(async () => {
  vi.resetModules();
  directory = await mkdtemp(join(tmpdir(), 'ludyrudy-settings-test-'));
  mocks.profileFile.mockImplementation((name) => join(directory, name));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

it.each(['{invalid json', '42'])('preserves unreadable settings and reports recovery', async (source) => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const file = join(directory, 'settings.json');
  await writeFile(file, source);
  const { getSettings, getSettingsProblem, updateSettings } = await import('./settingsStore');
  const defaults = getSettings();
  expect(getSettingsProblem()).toContain('Repair the file');
  expect(() => updateSettings({ general: { ...defaults.general, sidebarCollapsed: true } })).toThrow('Repair the file');
  expect(await readFile(file, 'utf8')).toBe(source);
});

it('creates settings when no prior settings file exists', async () => {
  const { getSettings, getSettingsProblem, updateSettings } = await import('./settingsStore');
  const general = { ...getSettings().general, sidebarCollapsed: true };
  expect(updateSettings({ general }).general).toEqual(general);
  expect(getSettingsProblem()).toBeNull();
  expect(await readdir(directory)).toEqual(['settings.json']);
});

it('checks the config precondition before replacing it and cleans up the pending credential on conflict', async () => {
  const { replaceConfigWithPassword } = await import('./settingsStore');
  const path = join(directory, 'rclone.conf');
  const stage = join(directory, 'staged.conf');
  await writeFile(path, 'external edit');
  await writeFile(stage, 'staged change');
  const conflict = new Error('config changed');

  await expect(replaceConfigWithPassword(path, stage, randomUUID(), () => { throw conflict; })).rejects.toBe(conflict);
  expect(await readFile(path, 'utf8')).toBe('external edit');
  expect(await readdir(directory)).toEqual(['rclone.conf', 'staged.conf']);
});
