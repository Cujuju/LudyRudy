import { app, Menu, nativeImage, Tray } from 'electron';
import { APP_NAME } from '@shared/app';
import type { DaemonStatus } from '@shared/types';
import { appIconPath } from './paths';
import { enableTrayHiding, showMainWindow } from './window';

const TRAY_IMAGE_WIDTH = 18;

export function createTray() {
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
  let current: DaemonStatus['state'] | undefined;
  return (state: DaemonStatus['state']) => {
    if (current === state) return;
    current = state;
    tray.setToolTip(`${APP_NAME} · rclone ${state}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `Open ${APP_NAME}`, click: showMainWindow },
      { label: `rclone: ${state}`, enabled: false },
      { type: 'separator' },
      { label: `Quit ${APP_NAME}`, click: () => app.quit() },
    ]));
  };
}
