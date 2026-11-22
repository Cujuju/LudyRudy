import { appLocale } from '@shared/timeFormat';
import { resolveTheme, themeTokens } from '@shared/themes';

const BYTE_BASE = 1024;
const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const unavailable = '—';

export function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return unavailable;
  let amount = value;
  let unit = 0;
  while (amount >= BYTE_BASE && unit < BYTE_UNITS.length - 1) {
    amount /= BYTE_BASE;
    unit++;
  }
  return `${amount.toLocaleString(appLocale(), { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${BYTE_UNITS[unit]}`;
}

export function formatSpeed(value: number | null): string {
  const bytes = formatBytes(value);
  return bytes === unavailable ? bytes : `${bytes}/s`;
}

export function formatDuration(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return unavailable;
  const seconds = Math.floor(value);
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  if (minutes >= MINUTES_PER_HOUR) return `${Math.floor(minutes / MINUTES_PER_HOUR)}h ${minutes % MINUTES_PER_HOUR}m`;
  return minutes ? `${minutes}m ${seconds % SECONDS_PER_MINUTE}s` : `${seconds}s`;
}

export function formatTime(value: string): string {
  if (!value) return unavailable;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? unavailable : date.toLocaleString(appLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

export function applyTheme(choice: string, prefersDark: boolean): void {
  const theme = resolveTheme(choice, prefersDark);
  const root = document.documentElement;
  root.style.colorScheme = theme.scheme;
  for (const [name, value] of Object.entries(themeTokens(theme))) root.style.setProperty(name, value);
}
