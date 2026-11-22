import { Menu } from 'electron';
import { APP_NAME } from '@shared/app';
import { showMainWindow } from './window';

export function installAppMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: APP_NAME, role: 'appMenu' } as const] : []),
    { role: 'editMenu' },
    { label: 'Window', submenu: [
      { label: `Open ${APP_NAME}`, click: showMainWindow }, { role: 'minimize' }, { role: 'close' },
    ] },
  ]));
}
