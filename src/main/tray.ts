import { app, Menu, nativeImage, Tray } from 'electron';
import { APP_NAME } from '@shared/app';
import type { AppSnapshot } from '@shared/ipc';
import type { MountProfile } from '@shared/types';
import type { openMountManager } from './mountManager';
import { appIconPath } from './paths';
import type { RcloneSupervisor } from './rcloneSupervisor';
import { enableTrayHiding, showMainWindow } from './window';

const TRAY_IMAGE_WIDTH = 18;

export function createTray(daemon: RcloneSupervisor, mounts: ReturnType<typeof openMountManager>, refresh: () => void, report: (error: unknown) => void) {
  const image = nativeImage.createFromPath(appIconPath()).resize({ width: TRAY_IMAGE_WIDTH });
  let tray: Tray;
  try {
    tray = new Tray(image);
  } catch (error) {
    console.error('[tray] Could not create the system tray:', error);
    return undefined;
  }
  enableTrayHiding();
  tray.on('click', showMainWindow);
  let current = '';
  const click = (action: () => Promise<unknown>) => () => { void action().then(refresh, report); };
  return ({ daemon: { state }, mounts: active }: AppSnapshot, profiles: MountProfile[]) => {
    const quickMounts = profiles.map(({ id, name, mountPoint }) => {
      const mounted = active.find((mount) => mount.profileId === id || mount.mountPoint === mountPoint);
      return { id, name, mounted };
    });
    const signature = JSON.stringify([state, quickMounts]);
    if (current === signature) return;
    current = signature;
    const running = state === 'running';
    tray.setToolTip(`${APP_NAME} · rclone ${state}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `Open ${APP_NAME}`, click: showMainWindow },
      { label: `rclone: ${state}`, enabled: false },
      { label: 'Start daemon', enabled: state === 'stopped', click: click(daemon.start) },
      { label: 'Stop daemon', enabled: running || state === 'error', click: click(daemon.stop) },
      { label: 'Restart daemon', enabled: state !== 'starting', click: click(daemon.restart) },
      ...quickMounts.map(({ id, name, mounted }) => ({
        label: `${mounted ? 'Unmount' : 'Mount'} ${name}`, enabled: running,
        click: click(() => mounted ? mounts.unmount(mounted.mountPoint) : mounts.mountProfile(id)),
      })),
      { type: 'separator' },
      { label: `Quit ${APP_NAME}`, click: () => app.quit() },
    ]));
  };
}
