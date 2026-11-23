import { Menu } from 'electron';
import { APP_NAME } from '@shared/app';
import { showMainWindow } from './window';

export function installAppMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{
      label: APP_NAME,
      submenu: [
        { role: 'about' as const, label: `About ${APP_NAME}` },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const, label: `Hide ${APP_NAME}` },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const, label: `Quit ${APP_NAME}` },
      ],
    }] : []),
    { role: 'editMenu' },
    { label: 'Window', submenu: [
      { label: `Open ${APP_NAME}`, click: showMainWindow }, { role: 'minimize' }, { role: 'close' },
    ] },
  ]));
}
