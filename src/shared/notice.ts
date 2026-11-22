import { BASIC_TONES, type NoticeDelivery, type NoticeInput, type NoticeView } from '@cujuju/electron-notices';
import type { AppSettings } from './settings';
import { darkTheme, resolveTheme, type Palette } from './themes';

export const NOTICE_KINDS = {
  daemonError: { tone: 'error', tag: 'DAEMON' },
  daemonCrashed: { tone: 'error', tag: 'DAEMON' },
  mountFailed: { tone: 'error', tag: 'MOUNT' },
  jobCompleted: { tone: 'ok', tag: 'JOB' },
  jobFailed: { tone: 'error', tag: 'JOB' },
  mountReady: { tone: 'ok', tag: 'MOUNT' },
  transferDone: { tone: 'ok', tag: 'TRANSFER' },
} as const;
export type NoticeKind = keyof typeof NOTICE_KINDS;

export function appNotice(kind: NoticeKind, input: Pick<NoticeInput, 'title' | 'body'>): NoticeInput {
  return { ...input, ...NOTICE_KINDS[kind], icon: kind };
}

const vars = (p: Palette): Record<string, string> => ({
  '--notice-surface': p.raised, '--notice-sunken': p.sunken, '--notice-hover': p.hover,
  '--notice-text': p.text, '--notice-text-secondary': p.secondary,
  '--notice-border': p.border, '--notice-border-strong': p.borderStrong,
  '--notice-accent': p.accentLight, '--notice-info': p.accentLight,
  '--notice-ok': p.green, '--notice-warn': p.amber, '--notice-error': p.red,
});

export const noticeDelivery = (settings: AppSettings, supported: boolean): NoticeDelivery =>
  supported ? settings.notifications.delivery : 'system';

export function noticeView(settings: AppSettings, prefersDark: boolean, supported: boolean): NoticeView {
  const theme = resolveTheme(settings.general.theme, prefersDark);
  return {
    tones: BASIC_TONES,
    config: { ...settings.notifications, delivery: noticeDelivery(settings, supported) },
    appearance: { vars: vars(theme.palette), dripVars: vars(darkTheme(theme).palette), colorScheme: theme.scheme },
  };
}
