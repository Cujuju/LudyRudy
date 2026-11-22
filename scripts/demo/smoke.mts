import { Cdp, freePort, until } from './cdp.mts';
import { launchDemo } from './launch.mts';

const PAGES = ['Dashboard', 'Remotes', 'Mounts', 'Browser', 'Transfers', 'Logs', 'Settings'];
const LIVE_CONTENT: Record<string, string> = {
  Dashboard: '768 MiB', Remotes: 'gdrive:vault', Mounts: '/demo/vault',
  Browser: 'schedule.pdf', Transfers: 'Photos/field-trip.zip', Logs: 'Attached to rclone', Settings: 'Window behavior',
};
const EXPECTED_REMOTES = ['gdrive', 'gdrive-vault', 'b2-backups', 's3-media', 'nas-sftp'];

export async function smoke(): Promise<string[]> {
  const port = await freePort();
  const app = await launchDemo({ debuggingPort: port });
  const errors: string[] = [];
  let cdp: Cdp | undefined;
  try {
    cdp = await Cdp.mainWindow(port, app.exitReason);
    const page = cdp;
    page.on<{ exceptionDetails: { text: string; exception?: { description?: string } } }>('Runtime.exceptionThrown',
      ({ exceptionDetails }) => errors.push(exceptionDetails.exception?.description ?? exceptionDetails.text));
    page.on('Inspector.targetCrashed', () => errors.push('Renderer crashed.'));
    await page.send('Inspector.enable');
    await page.send('Runtime.enable');
    const abort = () => app.exitReason() ?? (errors.length ? errors.join('\n') : null);
    const matches = async (expression: string) => (await page.eval<boolean>(expression)) || null;
    await until('initial renderer load', () => matches("document.readyState === 'complete'"), abort);

    let reloaded = false;
    await page.send('Page.enable');
    page.on('Page.loadEventFired', () => { reloaded = true; });
    await page.send('Page.reload');
    await until('instrumented renderer reload', () => Promise.resolve(reloaded || null), abort);
    await until('live rclone data', () => matches(`window.api.initialize().then(({snapshot}) => {
      const vault = snapshot.remotes.find((remote) => remote.name === 'gdrive-vault');
      return snapshot.daemon.attached && snapshot.daemon.endpoint === ${JSON.stringify(new URL(app.daemon.endpoint).href)} &&
        snapshot.stats?.bytes === 768 * 1024 ** 2 && vault?.isCrypt && vault.targetRemote === 'gdrive' &&
        vault.targetPath === 'vault' && ${JSON.stringify(EXPECTED_REMOTES)}.every(
          (name) => snapshot.remotes.some((remote) => remote.name === name));
    })`), abort);
    for (const label of PAGES) {
      const selector = `.nav-btn[aria-label="${label}"]`;
      await until(`${label} navigation`, () => matches(`!!document.querySelector(${JSON.stringify(selector)})`), abort);
      await page.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
      await until(`${label} content`, () => matches(`document.querySelector('main h1')?.textContent === ${JSON.stringify(label)} &&
        document.querySelector('main')?.textContent.includes(${JSON.stringify(LIVE_CONTENT[label])})`), abort);
    }
    const failure = abort();
    if (failure) throw new Error(failure);
    return PAGES;
  } finally {
    cdp?.close();
    await app.close();
  }
}
