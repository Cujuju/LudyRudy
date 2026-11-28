import type { DaemonStatus } from '@shared/types';

export const isMac = window.api.platform === 'darwin';
export const shortModifier = isMac ? '⌘' : 'Ctrl+';
export const trayName = isMac ? 'menu bar' : 'tray';

export function daemonHostLabel(daemon?: DaemonStatus): string {
  if (daemon?.mode === 'managed') return 'this computer';
  const host = daemon?.endpoint ? URL.parse(daemon.endpoint)?.host : undefined;
  const platform = daemon?.hostPlatform;
  const system = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : platform;
  return [host ?? 'the rclone host', system].filter(Boolean).join(' · ');
}
