import { afterEach, expect, it, vi } from 'vitest';
import { supportsLaunchAtLogin } from './paths';

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
