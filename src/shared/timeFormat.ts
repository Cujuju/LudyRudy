export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/** The system clock's hour cycle: 24-hour, 12-hour, or null for the language's own default. */
export type HourCycle = 'h23' | 'h12' | null;
/** Main passes the hour cycle to renderers as this command-line argument. */
export const HOUR_CYCLE_ARG = '--ludyrudy-hour-cycle=';
let hourCycle: HourCycle = null;
export function setHourCycle(cycle: HourCycle): void { hourCycle = cycle; }
export const parseHourCycle = (value: unknown): HourCycle => value === 'h23' || value === 'h12' ? value : null;
/** Locale for every date, time and number format: Chromium ignores the OS clock setting, so its hour cycle rides on the tag. */
export function appLocale(): string {
  const base = new Intl.DateTimeFormat().resolvedOptions().locale;
  return hourCycle ? `${base}-u-hc-${hourCycle}` : base;
}

/** "HH:MM" for an `<input type="time">`. */
export const minuteToTime = (minute: number): string =>
  `${String(Math.floor(minute / MINUTES_PER_HOUR)).padStart(2, '0')}:${String(minute % MINUTES_PER_HOUR).padStart(2, '0')}`;

/** The user's short clock time ("3:00 AM") for minutes after local midnight. */
export function minuteToClock(minute: number): string {
  const at = new Date();
  at.setHours(0, minute, 0, 0);
  return at.toLocaleTimeString(appLocale(), { hour: 'numeric', minute: '2-digit' });
}

/** Minutes after midnight from "HH:MM"; null when malformed. */
export function timeToMinute(text: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const value = Number(match[1]) * MINUTES_PER_HOUR + Number(match[2]);
  return Number(match[2]) < MINUTES_PER_HOUR && value < MINUTES_PER_DAY ? value : null;
}
