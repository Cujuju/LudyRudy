import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveRclone, supportsLaunchAtLogin } from './paths';

vi.mock('electron', () => ({ app: { isPackaged: true, commandLine: { hasSwitch: () => false } } }));
afterEach(() => vi.unstubAllGlobals());

it.each([
  ['darwin', true, false, true],
  ['win32', true, false, true],
  ['linux', true, false, false],
  ['darwin', false, false, false],
  ['win32', true, true, false],
] as const)('supports login items on %s (packaged: %s, custom profile: %s)', (platform, packaged, custom, expected) => {
  expect(supportsLaunchAtLogin(platform, packaged, custom)).toBe(expected);
});

it('disables login items when the app recognizes a profile after the switch delimiter', () => {
  vi.stubGlobal('process', { ...process, argv: ['app', '--', '--user-data-dir=custom-profile'] });
  expect(supportsLaunchAtLogin('darwin')).toBe(false);
});


it('keeps an explicit missing override from using a bundled executable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ludyrudy-rclone-path-'));
  try {
    vi.stubGlobal('process', { ...process, env: process.env, platform: process.platform, resourcesPath: directory });
    const bundled = join(directory, 'bin', process.platform === 'win32' ? 'rclone.exe' : 'rclone');
    await mkdir(join(directory, 'bin'));
    await writeFile(bundled, '', { mode: 0o755 });
    expect(resolveRclone(join(directory, 'missing'))).toEqual({ binarySource: 'missing', binaryPath: null });
    expect(resolveRclone('')).toEqual({ binarySource: 'bundled', binaryPath: bundled });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
