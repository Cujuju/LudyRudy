import { type Cdp, until } from './cdp.mts';

export const PAGES = ['Dashboard', 'Remotes', 'Mounts', 'Browser', 'Transfers', 'Logs', 'Settings'] as const;

const LIVE_CONTENT: Record<typeof PAGES[number], string[]> = {
  Dashboard: ['Active drive bay', 'Personal Vault', '768 MiB'],
  Remotes: ['Encrypted vaults', 'gdrive:vault', 'standard filenames'],
  Mounts: ['Saved mount profiles', 'Personal Vault', 'Archive Bucket'],
  Browser: ['schedule.pdf', '42 GiB used'],
  Transfers: ['Photos/field-trip.zip', 'Photos to Encrypted Vault', 'Work Mirror', 'Documents/reports.zip'],
  Logs: ['Attached to rclone'],
  Settings: ['Window behavior', 'Start minimized'],
};

export async function openPage(cdp: Cdp, label: typeof PAGES[number], abort: () => string | null) {
  const selector = JSON.stringify(`.nav-btn[aria-label="${label}"]`);
  await until(`${label} navigation`, async () => (await cdp.eval<boolean>(`!!document.querySelector(${selector})`)) || null, abort);
  await cdp.eval(`document.querySelector(${selector}).click()`);
  await until(`${label} content`, async () => (await cdp.eval<boolean>(`
    document.querySelector('main h1')?.textContent === ${JSON.stringify(label)} &&
    ${JSON.stringify(LIVE_CONTENT[label])}.every((text) => document.querySelector('main')?.textContent.includes(text))
  `)) || null, abort);
}
