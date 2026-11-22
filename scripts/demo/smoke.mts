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
    const verified = await page.eval<boolean>(`(async () => {
      const api = window.api;
      const mountPoint = '${process.platform === 'win32' ? 'Z:/' : '/demo/smoke'}';
      const options = { name: 'Smoke', remote: 'smoke-files', remotePath: '', mountPoint, autoMount: false,
        vfsCacheMaxSize: '', vfsCacheMaxAge: '', readOnly: true, extraFlags: [] };
      await api.createRemote({ name: 'smoke-files', type: 'memory', parameters: {} });
      await api.createCryptRemote({ name: 'smoke-vault', targetRemote: 'smoke-files', targetPath: 'vault',
        password: await api.generateSecret(), filenameEncryption: 'standard', directoryNameEncryption: true });
      await api.updateRemote({ name: 'smoke-vault', type: 'crypt', parameters: { directory_name_encryption: false } });
      await api.testRemote('smoke-files');
      await api.mkdir('smoke-files', 'folder');
      await api.copyFile('gdrive', 'schedule.pdf', 'smoke-files', 'folder/copy.pdf');
      await api.moveFile('smoke-files', 'folder/copy.pdf', 'smoke-files', 'folder/moved.pdf');
      if (!(await api.stat('smoke-files', 'folder/moved.pdf')) || (await api.stat('smoke-files', 'folder/copy.pdf'))) return false;
      await api.deleteFile('smoke-files', 'folder/moved.pdf');
      await api.purge('smoke-files', 'folder');
      if (await api.stat('smoke-files', 'folder')) return false;
      const profile = await api.saveMountProfile(options);
      const mounted = await api.mountProfile(profile.id);
      if (!(await api.listVfs()).includes('smoke-files:')) return false;
      await api.vfsStats('smoke-files');
      await api.vfsRefresh('smoke-files');
      await api.vfsForget('smoke-files');
      await api.unmount(mounted);
      await api.deleteMountProfile(profile.id);
      const job = await api.saveJob({ name: 'Smoke', mode: 'copy', source: 'gdrive:', destination: 'smoke-files:',
        excludes: [], dryRunDefault: true, enabled: true });
      const run = await api.runJob(job.id);
      if (!run.dryRun) return false;
      await api.stopJob(run.rcloneJobId);
      if (await api.bandwidthLimit('1M') !== '1M' || !(await api.completedTransfers()).length) return false;
      const vault = (await api.refresh()).remotes.find(({ name }) => name === 'smoke-vault');
      if (vault?.directoryNameEncryption !== false || 'password' in vault.config) return false;
      await api.deleteRemote('smoke-vault');
      await api.deleteRemote('smoke-files');
      return true;
    })()`);
    if (!verified) throw new Error('Phase 2 backend smoke assertions failed.');
    const failure = abort();
    if (failure) throw new Error(failure);
    return PAGES;
  } finally {
    cdp?.close();
    await app.close();
  }
}
