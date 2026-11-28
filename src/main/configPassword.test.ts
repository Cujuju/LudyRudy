import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setConfigPassword } from './configPassword';
import { readConfigPassword, saveConfigPassword } from './settingsStore';
import type { RcloneSupervisor } from './rcloneSupervisor';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  configPath: vi.fn<() => string>(),
}));

vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));
vi.mock('electron', () => ({
  safeStorage: {
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => 'test',
    encryptStringAsync: async (value: string) => Buffer.from(value),
    decryptStringAsync: async (value: Buffer) => ({ result: value.toString() }),
  },
}));
vi.mock('./paths', () => ({
  argument: () => undefined,
  resolveRclone: () => ({ binaryPath: '/bundled/rclone' }),
  profileFile: (name: string) => join(mocks.configPath(), '..', name),
}));
vi.mock('./rcloneSupervisor', () => ({
  configEncrypted: async (path: string) => (await readFile(path, 'utf8')).startsWith('RCLONE_ENCRYPT_V0:'),
  managedPaths: () => ({ configPath: mocks.configPath() }),
}));

const whileStopped = vi.fn<(operation: () => Promise<void>, beforeStop?: (running: boolean) => void) => Promise<void>>();
const current = vi.fn();
const daemon = { current, whileStopped } as unknown as RcloneSupervisor;
let directory: string;
beforeEach(async () => {
  vi.resetAllMocks();
  current.mockReturnValue({ daemon: { state: 'stopped' } });
  whileStopped.mockImplementation((operation) => operation());
  directory = await mkdtemp(join(tmpdir(), 'ludyrudy-config-test-'));
  mocks.configPath.mockReturnValue(join(directory, 'rclone.conf'));
  await writeFile(mocks.configPath(), '[photos]\ntype = local\n');
});
afterEach(async () => rm(directory, { recursive: true, force: true }));

it('rejects whitespace in a new password before supplying it to rclone', async () => {
  await expect(setConfigPassword(daemon, ` ${randomUUID()} `)).rejects.toThrow('start or end with whitespace');
  expect(mocks.execFile).not.toHaveBeenCalled();
  expect(whileStopped).not.toHaveBeenCalled();
});

it('rejects whitespace without stopping a running daemon for rotation', async () => {
  current.mockReturnValue({ daemon: { state: 'running' } });
  await writeFile(mocks.configPath(), 'RCLONE_ENCRYPT_V0:\n');
  await expect(setConfigPassword(daemon, ` ${randomUUID()}`)).rejects.toThrow('start or end with whitespace');
  expect(whileStopped).not.toHaveBeenCalled();
});

it('permits the untrimmed password when unlocking an existing config', async () => {
  await writeFile(mocks.configPath(), 'RCLONE_ENCRYPT_V0:\n');
  const existing = ` ${randomUUID()} `;
  mocks.execFile.mockImplementation((_binary: string, _args: string[], _options: unknown, done: (error: null) => void) => {
    queueMicrotask(() => done(null));
    return {};
  });
  await setConfigPassword(daemon, existing);
  expect(mocks.execFile.mock.calls[0]?.[2].env.RCLONE_CONFIG_PASS).toBe(existing);
  await expect(readConfigPassword(mocks.configPath())).resolves.toBe(existing);
});

it('rejects whitespace for an already-unlocked config even when stopped', async () => {
  await writeFile(mocks.configPath(), 'RCLONE_ENCRYPT_V0:\n');
  await saveConfigPassword(mocks.configPath(), randomUUID());
  mocks.execFile.mockImplementation((_binary: string, _args: string[], _options: unknown, done: (error: null) => void) => {
    queueMicrotask(() => done(null));
    return {};
  });
  await expect(setConfigPassword(daemon, ` ${randomUUID()}`)).rejects.toThrow('start or end with whitespace');
  expect(mocks.execFile).toHaveBeenCalledTimes(1);
  expect(mocks.execFile.mock.calls[0]?.[1][0]).toBe('listremotes');
});

it('preserves an external edit while verifying the staged config', async () => {
  const staged = 'RCLONE_ENCRYPT_V0:\n';
  const updated = '[work]\ntype = local\n';
  mocks.execFile.mockImplementation((_binary: string, args: string[], _options: unknown, done: (error: null) => void) => {
    if (args[0] === 'config') writeFileSync(args.at(-1)!, staged);
    else writeFileSync(mocks.configPath(), updated);
    queueMicrotask(() => done(null));
    return {};
  });

  await expect(setConfigPassword(daemon, randomUUID())).rejects.toThrow('config changed');
  expect(await readFile(mocks.configPath(), 'utf8')).toBe(updated);
});
