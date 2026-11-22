import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_NAME } from '@shared/app';
import { EVENTS, NOTICE_OVERLAY_ARG } from '@shared/ipc';
import { resolveTheme } from '@shared/themes';
import { HOUR_CYCLE_ARG } from '@shared/timeFormat';
import { systemHourCycle } from './hourCycle';
import { appIconPath, profileFile } from './paths';
import { getSettings, writeFileAtomic } from './settingsStore';

const DEFAULT_BOUNDS = { width: 1120, height: 760 };
const MIN_WIDTH = 760;
const MIN_HEIGHT = 520;
const SAVE_DELAY_MS = 400;
const isMac = process.platform === 'darwin';
const TRAFFIC_LIGHTS = { x: 14, y: 11 };

let window: BrowserWindow | null = null;
let quitting = false;
let canHideToTray = false;
export const enableTrayHiding = () => { canHideToTray = true; };
export const isQuitting = () => quitting;
export const markQuitting = () => { quitting = true; };
export const mainWindow = () => window;
const background = () => resolveTheme(getSettings().general.theme, nativeTheme.shouldUseDarkColors).palette.background;
export const syncWindowBackground = () => window?.setBackgroundColor(background());

function loadState(): { bounds: Electron.Rectangle | Electron.Size; maximized: boolean } {
  try {
    const { x, y, width, height, maximized } = JSON.parse(readFileSync(profileFile('window-state.json'), 'utf8')) as Electron.Rectangle & { maximized?: boolean };
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < MIN_WIDTH || height < MIN_HEIGHT) {
      return { bounds: DEFAULT_BOUNDS, maximized: false };
    }
    const visible = Number.isSafeInteger(x) && Number.isSafeInteger(y) && screen.getAllDisplays().some(({ workArea }) =>
      x >= workArea.x && x < workArea.x + workArea.width && y >= workArea.y && y < workArea.y + workArea.height,
    );
    return { bounds: visible ? { x, y, width, height } : { width, height }, maximized: maximized === true };
  } catch {
    return { bounds: DEFAULT_BOUNDS, maximized: false };
  }
}

const ozonePlatform = app.commandLine.getSwitchValue('ozone-platform');
export const noticeOverlaySupported = process.platform !== 'linux' || (
  ozonePlatform === 'x11' || (ozonePlatform !== 'wayland' && process.env.XDG_SESSION_TYPE !== 'wayland' && !process.env.WAYLAND_DISPLAY)
);

export function rendererPreferences(): Electron.WebPreferences {
  return {
    preload: join(import.meta.dirname, '../preload/index.cjs'),
    sandbox: true, contextIsolation: true, nodeIntegration: false,
    additionalArguments: [HOUR_CYCLE_ARG + (systemHourCycle() ?? ''), ...(noticeOverlaySupported ? [NOTICE_OVERLAY_ARG] : [])],
  };
}

export function loadRendererPage(win: BrowserWindow, page: 'index.html' | 'notice.html'): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  const url = !app.isPackaged && process.env.ELECTRON_RENDERER_URL;
  const loading = url ? win.loadURL(new URL(page, url).href) : win.loadFile(join(import.meta.dirname, '../renderer', page));
  void loading.catch((error: unknown) => {
    if (!quitting && !win.isDestroyed()) console.error(`[window] Could not load ${page}:`, error);
  });
}

export function showMainWindow(): void {
  if (!window) { createMainWindow(); return; }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

export function createMainWindow(startMinimized = false): void {
  const { bounds, maximized } = loadState();
  const win = new BrowserWindow({
    ...bounds, minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT, show: false,
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: TRAFFIC_LIGHTS } : { frame: false }),
    title: APP_NAME, icon: appIconPath(), backgroundColor: background(), webPreferences: rendererPreferences(),
  });
  window = win;
  let saveTimer: NodeJS.Timeout | undefined;
  const save = () => {
    clearTimeout(saveTimer);
    try {
      writeFileAtomic(profileFile('window-state.json'), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
    } catch (error) {
      console.error('[window] Could not save bounds:', error);
    }
  };
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
  };
  if (maximized) win.maximize();
  win.setMenuBarVisibility(false);
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('maximize', () => win.webContents.send(EVENTS.onMaximized, true));
  win.on('unmaximize', () => win.webContents.send(EVENTS.onMaximized, false));
  win.on('close', (event) => {
    save();
    if (!quitting && canHideToTray && getSettings().general.closeToTray) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on('minimize', () => { if (canHideToTray && getSettings().general.minimizeToTray) win.hide(); });
  win.on('closed', () => {
    window = null;
    clearTimeout(saveTimer);
    if (!quitting && !isMac) app.quit();
  });
  win.once('ready-to-show', () => {
    if (!startMinimized || !canHideToTray) win.show();
    if (startMinimized && !canHideToTray) win.minimize();
  });
  loadRendererPage(win, 'index.html');
}
