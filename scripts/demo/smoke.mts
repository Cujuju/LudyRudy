import { Cdp, freePort, until } from './cdp.mts';
import { launchDemo } from './launch.mts';

import { VAULT_MOUNT } from './fixtures.mts';
import { openPage, PAGES } from './pages.mts';

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
        snapshot.mounts.some((mount) => mount.mountPoint === ${JSON.stringify(VAULT_MOUNT)} && mount.profileId === 'personal-vault') &&
        snapshot.stats?.bytes === 768 * 1024 ** 2 && vault?.isCrypt && vault.targetRemote === 'gdrive' &&
        vault.targetPath === 'vault' && ${JSON.stringify(EXPECTED_REMOTES)}.every(
          (name) => snapshot.remotes.some((remote) => remote.name === name));
    })`), abort);
    for (const label of PAGES) await openPage(page, label, abort);
    await verifyUi(page, abort);
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
    return [...PAGES];
  } finally {
    cdp?.close();
    await app.close();
  }
}

async function verifyUi(page: Cdp, abort: () => string | null) {
  const click = async (label: string, scope = 'main') => {
    const clicked = await page.eval<boolean>(`(() => {
      const element = [...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find((button) =>
        !button.disabled && (button.getAttribute('aria-label') === ${JSON.stringify(label)} || button.textContent.trim() === ${JSON.stringify(label)}));
      element?.click();
      return !!element;
    })()`);
    if (!clicked) throw new Error(`Missing enabled button "${label}" in "${scope}".`);
  };
  const input = (selector: string, value: string) => page.eval(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element.value = ${JSON.stringify(value)};
    element.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const contains = (label: string, scope = 'main') => until(label, async () => (await page.eval<boolean>(
    `document.querySelector(${JSON.stringify(scope)})?.textContent.includes(${JSON.stringify(label)})`,
  )) || null, abort);

  await openPage(page, 'Dashboard', abort);
  await click('New mount');
  await contains('VFS cache mode', 'dialog[open]');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await until('mount drawer dismissal', async () => (await page.eval<boolean>('!document.querySelector("dialog[open]")')) || null, abort);
  await click('Check quota');
  await contains('42 GiB used');

  await openPage(page, 'Mounts', abort);
  const archive = '[data-mount="archive-bucket"]';
  await click('Edit', archive);
  await input('dialog input', 'Unsaved archive');
  await click('Close drawer', 'dialog[open]');
  await contains('Archive Bucket', archive);
  await click('Mount drive', archive);
  await contains('Drive mounted.', archive);
  await click('Refresh VFS cache', archive);
  await contains('VFS cache refreshed.', archive);
  await click('Unmount', archive);
  await contains('Drive unmounted.', archive);

  await openPage(page, 'Remotes', abort);
  await click('Test connection');
  await contains('Connection passed.');
  await click('Wrap with encryption');
  await contains('Vault password', 'dialog[open]');
  await click('Generate password', 'dialog[open]');
  await until('generated password', async () => (await page.eval<boolean>('document.querySelector("dialog input[type=password]")?.value.length === 64')) || null, abort);
  await click('Close drawer', 'dialog[open]');
  await click('Add remote');
  await until('provider picker', async () => (await page.eval<boolean>(`!!document.querySelector('dialog [aria-label="Popular providers"]')`)) || null, abort);
  await click('SFTP', 'dialog[open]');
  await contains('Advanced options', 'dialog[open]');
  await until('masked SFTP credential', async () => (await page.eval<boolean>('!!document.querySelector("dialog input[type=password]")')) || null, abort);
  await click('Close drawer', 'dialog[open]');

  await openPage(page, 'Browser', abort);
  await click('Documents');
  await contains('field-notes.txt');
  await click('New folder');
  const setPath = (value: string) => input('dialog input', value);
  await setPath('Documents/Smoke folder');
  await click('Create folder', 'dialog[open]');
  await contains('Smoke folder');
  await click('Rename or move', 'tr[data-entry="Documents/Smoke folder"]');
  await setPath('Documents/Renamed folder');
  await click('Rename or move', 'dialog[open]');
  await contains('Renamed folder');
  await click('Delete', 'tr[data-entry="Documents/Renamed folder"]');
  await contains('and everything inside it?', 'tr[data-entry="Documents/Renamed folder"]');
  await click('Delete', 'tr[data-entry="Documents/Renamed folder"]');
  await until('folder deletion', async () => (await page.eval<boolean>(`!document.querySelector('tr[data-entry="Documents/Renamed folder"]')`)) || null, abort);

  await openPage(page, 'Transfers', abort);
  await click('25M');
  await until('bandwidth cap', async () => (await page.eval<boolean>(`document.querySelector('.bandwidth-controls button[aria-pressed=true]')?.textContent === '25M'`)) || null, abort);
  await click('Run dry run');
  await contains('Finished (dry run)');
  await click('New job');
  await contains('Choose source folder', 'dialog[open]');
  await click('Close drawer', 'dialog[open]');

  await openPage(page, 'Logs', abort);
  await click('Pause');
  await contains('Resume');
  await click('Clear view');
  await contains('No log entries in this view.');

  await openPage(page, 'Settings', abort);
  await click('Daemon & Security');
  await contains('rclone.conf encryption');
  await click('Notifications');
  await contains('Daemon error alerts');
  await click('Send test notice');
  await contains('Test notice requested.');
}
