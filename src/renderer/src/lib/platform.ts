export const isMac = window.api.platform === 'darwin';
export const shortModifier = isMac ? '⌘' : 'Ctrl+';
export const trayName = isMac ? 'menu bar' : 'tray';
