import { createNoticeOverlay, createNotifier, handleNoticeIpc, OVERLAY_WINDOW_OPTIONS, type NoticeInput } from '@cujuju/electron-notices';
import { BrowserWindow, Notification, ipcMain, nativeTheme, screen } from 'electron';
import { APP_NAME } from '@shared/app';
import { EVENTS } from '@shared/ipc';
import { noticeDelivery, noticeView } from '@shared/notice';
import { appIconPath } from './paths';
import { getSettings, onSettingsChange } from './settingsStore';
import { loadRendererPage, noticeOverlaySupported, rendererPreferences, showMainWindow, showWindowAndSend } from './window';

function openNoticeTarget(target: string | undefined): void {
  if (target === 'updates') showWindowAndSend(EVENTS.onOpenSettings, 'Updates');
  else showMainWindow();
}

export function startNotices() {
  const overlay = createNoticeOverlay({
    createWindow() {
      const win = new BrowserWindow({ ...OVERLAY_WINDOW_OPTIONS, title: `${APP_NAME} notifications`, webPreferences: rendererPreferences() });
      loadRendererPage(win, 'notice.html');
      return win;
    },
    primaryDisplay: () => screen.getPrimaryDisplay(),
    view: () => noticeView(getSettings(), nativeTheme.shouldUseDarkColors, noticeOverlaySupported),
    platform: process.platform,
    onOpen: (notice) => openNoticeTarget(notice.target),
  });
  const notifier = createNotifier({
    overlay,
    delivery: () => noticeDelivery(getSettings(), noticeOverlaySupported),
    system(input) {
      if (!Notification.isSupported()) return;
      const notice = new Notification({ title: input.title, body: input.body, icon: appIconPath() });
      notice.on('click', () => openNoticeTarget(input.target));
      notice.show();
    },
  });
  handleNoticeIpc(ipcMain, overlay);
  overlay.refresh();
  onSettingsChange(() => overlay.refresh());
  nativeTheme.on('updated', overlay.refresh);
  screen.on('display-metrics-changed', overlay.refresh);
  screen.on('display-added', overlay.refresh);
  screen.on('display-removed', overlay.refresh);

  return {
    notify: (input: NoticeInput) => {
      void notifier.notify(input).catch((error: unknown) => console.error('[notifications]', error));
    },
    destroy: () => overlay.destroy(),
  };
}
