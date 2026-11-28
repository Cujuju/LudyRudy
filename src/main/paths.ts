import { app } from 'electron';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import type { DaemonStatus } from '@shared/types';

export function supportsLaunchAtLogin(
  platform = process.platform,
  packaged = app.isPackaged,
  customProfile = app.commandLine.hasSwitch('user-data-dir') || argument('--user-data-dir') !== undefined,
): boolean {
  return packaged && !customProfile && (platform === 'darwin' || platform === 'win32');
}

export function argument(name: string): string | undefined {
  const index = process.argv.findIndex((value) => value === name || value.startsWith(`${name}=`));
  if (index < 0) return undefined;
  const value = process.argv[index]!;
  const next = process.argv[index + 1];
  return value === name ? next?.startsWith('--') ? '' : next ?? '' : value.slice(name.length + 1);
}

const resource = (name: string) => join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), name);
export const appIconPath = () => resource('icon.png');
export const profileFile = (name: string) => join(app.getPath('userData'), name);

function executable(file: string): boolean {
  try {
    accessSync(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

export function resolveRclone(override: string): { binaryPath: DaemonStatus['binaryPath']; binarySource: DaemonStatus['binarySource'] } {
  const name = process.platform === 'win32' ? 'rclone.exe' : 'rclone';
  if (override) {
    return isAbsolute(override) && executable(override)
      ? { binaryPath: override, binarySource: 'override' }
      : { binaryPath: null, binarySource: 'missing' };
  }
  const bin = app.isPackaged ? 'bin' : join('bin', `${process.platform}-${process.arch}`);
  const bundled = resource(join(bin, name));
  if (executable(bundled)) return { binaryPath: bundled, binarySource: 'bundled' };
  const binaryPath = (process.env.PATH ?? '').split(delimiter).map((dir) => dir.replace(/^"|"$/g, ''))
    .filter(isAbsolute).map((dir) => join(dir, name)).find(executable);
  return binaryPath ? { binaryPath, binarySource: 'path' } : { binaryPath: null, binarySource: 'missing' };
}
