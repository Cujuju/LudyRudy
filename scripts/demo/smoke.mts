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
    await until('live rclone data', () => matches(`window.api.initialize().then(({snapshot, launchAtLoginSupported}) => {
      const vault = snapshot.remotes.find((remote) => remote.name === 'gdrive-vault');
      return launchAtLoginSupported === false && snapshot.daemon.attached && snapshot.daemon.endpoint === ${JSON.stringify(new URL(app.daemon.endpoint).href)} &&
        snapshot.mounts.some((mount) => mount.mountPoint === ${JSON.stringify(VAULT_MOUNT)} && mount.profileId === 'personal-vault') &&
        snapshot.stats?.bytes === 768 * 1024 ** 2 && vault?.isCrypt && vault.targetRemote === 'gdrive' &&
        vault.targetPath === 'vault' && ${JSON.stringify(EXPECTED_REMOTES)}.every(
          (name) => snapshot.remotes.some((remote) => remote.name === name));
    })`), abort);
    for (const label of PAGES) await openPage(page, label, abort);
    await verifyUi(page, abort, app.daemon);
    const verified = await page.eval<boolean>(`(async () => {
      const api = window.api;
      const blockedReveal = await api.revealMount(${JSON.stringify(VAULT_MOUNT)})
        .then(() => false, (error) => error.message.includes('rclone host'));
      if (!blockedReveal) return false;
      const badOverride = await api.updateDaemon({ binaryPath: ${JSON.stringify(import.meta.dirname)} })
        .then(() => false, (error) => error.message.includes('executable rclone binary'));
      if (!badOverride || (await api.initialize()).settings.daemon.binaryPath) return false;
      const vaultFiles = await api.browse('gdrive-vault', '');
      if (vaultFiles.find(({ name }) => name === 'journal.txt')?.encrypted !== 'encrypted-journal') return false;
      const mountPoint = '${process.platform === 'win32' ? 'Z:/' : '/demo/smoke'}';
      const options = { name: 'Smoke', remote: 'smoke-files', remotePath: '', mountPoint, autoMount: false,
        vfsCacheMaxSize: '', vfsCacheMaxAge: '', readOnly: true, extraFlags: [] };
      if ((await api.createRemote({ name: 'smoke-files', type: 'memory', parameters: {} })).state !== 'complete') return false;
      if (${process.platform !== 'win32'}) {
        const literal = ${JSON.stringify('literal\\name\r\n')};
        await api.mkdir('smoke-files', literal);
        if (!(await api.browse('smoke-files', '')).some((entry) => entry.path === literal)) return false;
        await api.purge('smoke-files', literal);
        if ((await api.browse('smoke-files', '')).some((entry) => entry.path === literal)) return false;
      }
      if ((await api.createCryptRemote({ name: 'smoke-vault', targetRemote: 'smoke-files', targetPath: 'vault',
        password: await api.generateSecret(), filenameEncryption: 'standard', directoryNameEncryption: true })).state !== 'complete') return false;
      if ((await api.updateRemote({ name: 'smoke-vault', type: 'crypt', parameters: { directory_name_encryption: false } })).state !== 'complete') return false;
      await api.testRemote('smoke-files');
      await api.mkdir('smoke-files', 'folder');
      await api.copyFile('gdrive', 'schedule.pdf', 'smoke-files', 'folder/copy.pdf');
      await api.copyFile('gdrive', 'schedule.pdf', 'smoke-files', 'folder/occupied.pdf');
      const collidingMove = await api.moveFile('smoke-files', 'folder/copy.pdf', 'smoke-files', 'folder/occupied.pdf')
        .then(() => false, (error) => error.message.includes('destination already exists'));
      if (!collidingMove || !(await api.stat('smoke-files', 'folder/copy.pdf'))) return false;
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
      const activeMount = (await api.refresh()).mounts.find((entry) => entry.mountPoint === mounted);
      if (!activeMount) return false;
      await api.unmount(activeMount.id);
      await api.deleteMountProfile(profile.id);
      const job = await api.saveJob({ name: 'Smoke', mode: 'copy', source: 'gdrive:', destination: 'smoke-files:',
        excludes: [], dryRunDefault: true, enabled: true });
      const run = await api.runJob(job.id);
      if (!run.dryRun) return false;
      await api.stopJob(run.rcloneJobId);
      if (await api.bandwidthLimit('1M') !== '1Mi' || !(await api.completedTransfers()).length) return false;
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

async function verifyUi(page: Cdp, abort: () => string | null, daemon: {
  replaceTransferHistory: (name: string) => void;
  replaceBrowserListing: () => void;
}) {
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
  const flyout = ':popover-open .cujuju-select-flyout-panel';
  const keyCodes = { Escape: 27, Tab: 9, Enter: 13 };
  const key = async (name: keyof typeof keyCodes, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp']) {
      await page.send('Input.dispatchKeyEvent', { type, key: name, code: name, windowsVirtualKeyCode: keyCodes[name], modifiers });
    }
  };
  const escape = () => key('Escape');

  await openPage(page, 'Dashboard', abort);
  const sidebarExpanded = (value: boolean) => until('sidebar toggle', async () => (await page.eval<boolean>(
    `document.querySelector('.sidebar-toggle').getAttribute('aria-expanded') === "${value}"`,
  )) || null, abort);
  await page.eval("document.querySelector('.sidebar-toggle').click()");
  await sidebarExpanded(false);
  await page.eval(`document.querySelector('.nav-btn[aria-label="Dashboard"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await sidebarExpanded(true);
  await page.eval("document.querySelector('.build-card').click()");
  await contains('About LudyRudy');
  await openPage(page, 'Dashboard', abort);
  await click('New mount');
  await contains('VFS cache mode', 'dialog[open]');
  const selectPlaceholderVisible = await page.eval<boolean>(`(() => {
    const placeholder = document.querySelector('dialog[open] .cujuju-select-flyout-placeholder');
    if (!placeholder) return false;
    const style = getComputedStyle(placeholder);
    return style.fontStyle === 'italic' && style.opacity === '1';
  })()`);
  if (!selectPlaceholderVisible) throw new Error('Select placeholder did not use readable placeholder styling.');
  await click('Cache max size', 'dialog[open]');
  await contains('10 GiB', flyout);
  await escape();
  await until('Escape closes only the flyout', async () => (await page.eval<boolean>(
    `!document.querySelector('${flyout}') && !!document.querySelector('dialog[open]')`,
  )) || null, abort);
  await escape();
  await until('mount drawer dismissal', async () => (await page.eval<boolean>('!document.querySelector("dialog[open]")')) || null, abort);
  await click('Check quota');
  await contains('42 GiB used');

  await openPage(page, 'Mounts', abort);
  const archive = '[data-mount="archive-bucket"]';
  const personalVault = '[data-mount="personal-vault"]';
  await contains('Path on', personalVault);
  if (await page.eval(`[...document.querySelectorAll('${personalVault} button')].some((button) => button.textContent === 'Open folder')`)) {
    throw new Error('Attached mount exposed the local Open folder action.');
  }
  await click('Edit', archive);
  if (await page.eval(`!!document.querySelector('dialog [aria-label="Choose folder"]')`)) {
    throw new Error('Attached mount profile exposed the local folder picker.');
  }
  await input('dialog input', 'Unsaved archive');
  await click('Close drawer', 'dialog[open]');
  await contains('Archive Bucket', archive);
  await click('Edit', archive);
  const customSize = await page.eval<string>(`document.querySelector('dialog [aria-label="Custom cache max size"]')?.value`);
  if (customSize !== '4G') throw new Error('Custom cache max size did not initialize.');
  await click('Cache max size', 'dialog[open]');
  await contains('10 GiB', flyout);
  await click('10 GiB', flyout);
  await contains('10 GiB', 'dialog [aria-label="Cache max size"]');
  await click('Advanced options', 'dialog[open]');
  await contains('--direct-io', flyout);
  await click('Mount · --direct-io — Bypass kernel data caching', flyout);
  await click('Advanced options', 'dialog[open]');
  await contains('--dir-cache-time', flyout);
  await click('VFS · --dir-cache-time — Time to cache directory entries', flyout);
  const editedOptions = await page.eval<boolean>(`(() => {
    const drawer = document.querySelector('dialog[open]');
    const picker = drawer.querySelector('[aria-label="Advanced options"]');
    if (!picker.textContent.includes('Add a mount or VFS option…') || !drawer.querySelector('[aria-label="--direct-io"]')?.checked) return false;
    drawer.querySelector('[aria-label="Remove --direct-io"]').click();
    return !drawer.querySelector('[aria-label="--direct-io"]') && drawer.querySelector('[aria-label="--dir-cache-time"]')?.value === '5m';
  })()`);
  if (!editedOptions) throw new Error('Mount pickers did not initialize or update as expected.');
  await input('dialog [aria-label="--dir-cache-time"]', '10m');
  await click('Save profile', 'dialog[open]');
  await until('mount options saved', async () => (await page.eval<boolean>(`window.api.initialize().then(({settings}) =>
    settings.mounts.some((mount) => mount.id === 'archive-bucket' && mount.vfsCacheMaxSize === '10G' &&
      mount.vfsOpts?.DirCacheTime === '10m' && !mount.mountOpts))`)) || null, abort);
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
  const catalogTrigger = `Array.from(document.querySelectorAll('dialog.drawer button')).find((button) => button.textContent.trim() === 'More…')`;
  await page.eval(`${catalogTrigger}.focus()`);
  await click('More…', 'dialog[open]');
  await until('provider catalog dialog', async () => (await page.eval<boolean>(`(() => {
    const catalog = document.querySelector('.modal-dialog:modal');
    if (document.activeElement !== catalog?.querySelector('input[type=search]')) return false;
    const items = [...catalog.querySelectorAll('[role=group] .provider-catalog-item strong')].map((el) => el.textContent.trim());
    return items.length >= 13 && items.every((label, i) => i === 0 || items[i - 1].localeCompare(label, undefined, { sensitivity: 'base' }) <= 0);
  })()`)) || null, abort);
  const shiftModifier = 8;
  for (let tab = 0; tab < 2; tab += 1) {
    await key('Tab', shiftModifier);
    if (await page.eval<boolean>(`document.activeElement?.closest('dialog') !== document.querySelector('.modal-dialog')`)) {
      throw new Error('Reverse Tab moved focus outside the provider catalog.');
    }
  }
  await escape();
  await until('Escape closes only provider catalog', async () => (await page.eval<boolean>(
    `!document.querySelector('.modal-dialog') && document.activeElement === ${catalogTrigger}`,
  )) || null, abort);
  const selectCatalogProvider = (name: string) => page.eval(`[...document.querySelectorAll('.modal-dialog .provider-catalog-item')]
    .find((button) => button.querySelector('strong')?.textContent === ${JSON.stringify(name)}).click()`);
  await click('More…', 'dialog[open]');
  await selectCatalogProvider('Memory');
  await page.eval(`[...document.querySelectorAll('dialog.drawer .provider-picker button')]
    .find((button) => button.textContent.trim() === 'Memory').focus()`);
  await click('Memory', 'dialog[open]');
  await selectCatalogProvider('SFTP');
  await until('provider selection restores focus when its trigger disappears', async () => (await page.eval<boolean>(
    `!document.querySelector('.modal-dialog') && document.activeElement === ${catalogTrigger}`,
  )) || null, abort);
  await contains('Advanced options', 'dialog[open]');
  await until('SFTP endpoint row', async () => (await page.eval<boolean>(
    `document.querySelectorAll('dialog .endpoint-row input').length === 3 && document.querySelector('dialog .endpoint-row')?.textContent.includes('@') && document.querySelector('dialog .endpoint-row')?.textContent.includes(':')`,
  )) || null, abort);
  await until('masked SFTP credential', async () => (await page.eval<boolean>('!!document.querySelector("dialog input[type=password]")')) || null, abort);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 520, deviceScaleFactor: 1, mobile: false });
  const drawerScrolls = await page.eval<boolean>(`(() => {
    const dialog = document.querySelector('dialog[open]');
    const inner = dialog?.querySelector('.drawer-inner');
    const submit = dialog?.querySelector('button[type=submit]');
    const advanced = dialog?.querySelector('details.advanced');
    if (advanced) advanced.open = true;
    if (!dialog || !inner || !submit) return false;
    const fits = dialog.getBoundingClientRect().bottom <= window.innerHeight;
    if (inner.scrollHeight <= inner.clientHeight) return false;
    inner.scrollTop = inner.scrollHeight;
    const innerRect = inner.getBoundingClientRect();
    const submitRect = submit.getBoundingClientRect();
    return fits && inner.scrollTop > 0 && submitRect.top >= innerRect.top && submitRect.bottom <= innerRect.bottom;
  })()`);
  await page.send('Emulation.clearDeviceMetricsOverride');
  if (!drawerScrolls) throw new Error('Drawer overflowed the viewport or failed to scroll.');
  await click('Close drawer', 'dialog[open]');
  const editRemote = (name: string) => page.eval(`[...document.querySelectorAll('.ledger-row .remote-actions button')]
    .find((button) => button.textContent === 'Edit' && button.closest('.ledger-row').querySelector('strong')?.textContent === ${JSON.stringify(name)}).click()`);
  await editRemote('nas-sftp');
  await until('SFTP edit projects configured port and boolean while keeping its host write-only', async () => (await page.eval<boolean>(`(() => {
    const drawer = document.querySelector('dialog[aria-label="Edit remote"]');
    return drawer?.querySelector('.endpoint-row input.numeric')?.value === '2222'
      && drawer.querySelector('.endpoint-row input.path')?.value === ''
      && [...drawer.querySelectorAll('label')].find((label) => label.textContent === 'key_use_agent')?.querySelector('input')?.checked;
  })()`)) || null, abort);
  await click('Close drawer', 'dialog[open]');

  await editRemote('gdrive');
  await contains('Reconnect account', 'dialog[open]');
  await click('Save remote', 'dialog[open]');
  await contains('Use the shared OAuth client?', 'dialog[open]');
  await click('Close', 'dialog[open]');
  await editRemote('gdrive');
  await contains('Use the shared OAuth client?', 'dialog[open]');
  await click('Use shared client', 'dialog[open]');
  await contains('Keep current authorization', 'dialog[open]');
  await click('Keep current authorization', 'dialog[open]');
  await contains('Skip shared drive', 'dialog[open]');
  await click('Skip shared drive', 'dialog[open]');
  await until('completed remote configuration closes the editor', async () =>
    (await page.eval<boolean>(`!document.querySelector('dialog[open]')`)) || null, abort);

  await openPage(page, 'Browser', abort);
  const placeholderVisible = await page.eval<boolean>(`(() => {
    const field = document.querySelector('input[aria-label="Filter filenames"]');
    const placeholder = getComputedStyle(field, '::placeholder');
    return placeholder.color === getComputedStyle(field).color && placeholder.opacity === '1' && placeholder.fontStyle === 'italic';
  })()`);
  if (!placeholderVisible) throw new Error('Browser placeholder did not use the readable input text color.');
  await click('Documents');
  await contains('field-notes.txt');
  await click('New folder');
  const setPath = (value: string) => input('dialog textarea', value);
  await setPath('Documents/Smoke folder');
  await click('Create folder', 'dialog[open]');
  await contains('Smoke folder');
  await click('Rename or move', 'tr[data-entry="Documents/Smoke folder"]');
  await setPath('Documents//./Renamed folder/');
  await page.eval("document.querySelector('dialog textarea').focus()");
  await key('Enter');
  await contains('Renamed folder');
  await click('Delete', 'tr[data-entry="Documents/Renamed folder"]');
  await contains('and everything inside it?', 'tr[data-entry="Documents/Renamed folder"]');
  await click('Delete', 'tr[data-entry="Documents/Renamed folder"]');
  await until('folder deletion', async () => (await page.eval<boolean>(`!document.querySelector('tr[data-entry="Documents/Renamed folder"]')`)) || null, abort);

  await click('Rename or move', 'tr[data-entry="Documents/field-notes.txt"]');
  daemon.replaceBrowserListing();
  await contains('new-root-file.txt');
  if (await page.eval("!!document.querySelector('dialog[open]')")) {
    throw new Error('A path dialog survived the remote config change.');
  }

  await openPage(page, 'Transfers', abort);
  daemon.replaceTransferHistory('replacement-history.zip');
  await page.eval('window.api.stopDaemon().then(() => window.api.startDaemon())');
  await contains('rclone core/transferred returned an invalid response.');
  await contains('Retry');
  if (await page.eval("document.querySelector('main')?.textContent?.includes('Documents/reports.zip')")) {
    throw new Error('Transfer history from the previous connection is still visible.');
  }
  await click('Retry');
  await contains('replacement-history.zip');
  await click('5M');
  await until('5M bandwidth preset selected', async () => (await page.eval<boolean>(`
    [...document.querySelectorAll('[aria-label="Bandwidth presets"] button')].some(
      (button) => button.textContent.trim() === '5M' && button.getAttribute('aria-pressed') === 'true')
  `)) || null, abort);
  await click('25M');
  await until('bandwidth cap', async () => (await page.eval<boolean>(`document.querySelector('.bandwidth-controls button[aria-pressed=true]')?.textContent === '25M'`)) || null, abort);
  await click('Run dry run');
  await contains('Finished (dry run)');
  await click('New job');
  await contains('Use remote:folder or an absolute path.', 'dialog[open]');
  const excludeHint = await page.eval<string>(`(() => {
    const input = document.querySelector('dialog[open] textarea');
    return document.getElementById(input.getAttribute('aria-describedby'))?.textContent;
  })()`);
  if (excludeHint !== 'One rclone pattern per line.') throw new Error('Job exclusions need a persistent accessible description.');
  await until('source folder picker', async () => (await page.eval<boolean>(`!!document.querySelector('dialog[open] button[aria-label="Choose source folder"]')`)) || null, abort);
  await click('Close drawer', 'dialog[open]');

  await openPage(page, 'Logs', abort);
  await click('Pause');
  await contains('Resume');
  await click('Clear view');
  await contains('No log entries in this view.');

  await openPage(page, 'Settings', abort);
  await click('General');
  await contains('Start minimized');
  if (await page.eval("document.querySelector('main')?.textContent?.includes('Launch at login')")) {
    throw new Error('Launch at login is unavailable in the demo profile.');
  }
  await click('Appearance');
  await contains('System', '.theme-grid');
  await click('Daemon & Security');
  await contains('rclone.conf encryption');
  await click('Notifications');
  await contains('Daemon error alerts');
  await click('Send test notice');
  await contains('Test notice requested.');
  await page.eval("document.querySelector('.build-card').click()");
  await contains('About LudyRudy');
}
