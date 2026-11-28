import { execFile } from 'node:child_process';
import { closeSync, fstatSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { argument, resolveRclone } from './paths';
import { configEncrypted, managedPaths, type RcloneSupervisor } from './rcloneSupervisor';
import { getSettings, readConfigPassword, replaceConfigWithPassword, saveConfigPassword, writeFileAtomic } from './settingsStore';

const CONFIG_TIMEOUT_MS = 10_000;
const PASSWORD_WHITESPACE_ERROR = 'A new config password cannot start or end with whitespace.';

function runConfig(binary: string, path: string, command: string[], password: string | null, input = ''): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(binary, [...command, '--config', path], {
      env: { ...process.env, RCLONE_CONFIG_PASS: password ?? '', RCLONE_PASSWORD_COMMAND: '' },
      timeout: CONFIG_TIMEOUT_MS, killSignal: 'SIGKILL', windowsHide: true,
    }, (error) => error ? reject(new Error('rclone could not read or change the config encryption.')) : resolve());
    child.stdin?.on('error', () => { /* The child can exit before reading a password. */ });
    child.stdin?.end(input);
  });
}

function resolvedConfigPath(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return path;
  }
}

function configSnapshot(path: string) {
  let descriptor: number;
  try {
    descriptor = openSync(path, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const { dev, ino } = fstatSync(descriptor, { bigint: true });
    return { dev, ino, contents: readFileSync(descriptor) };
  } finally {
    closeSync(descriptor);
  }
}

export async function setConfigPassword(daemon: RcloneSupervisor, password: string | null): Promise<void> {
  if (password !== null && (typeof password !== 'string' || !password.trim() || /[\r\n\0]/.test(password))) {
    throw new Error('Enter a non-empty config password without line breaks.');
  }
  if (argument('--rclone-endpoint') !== undefined || getSettings().daemon.endpoint) {
    throw new Error('Config encryption is available for the managed daemon.');
  }
  const hasOuterWhitespace = password !== null && password !== password.trim();
  if (hasOuterWhitespace && (daemon.current().daemon.state === 'running' ||
    !await configEncrypted(managedPaths().configPath))) {
    throw new Error(PASSWORD_WHITESPACE_ERROR);
  }
  return daemon.whileStopped(async () => {
    const config = getSettings().daemon;
    if (argument('--rclone-endpoint') !== undefined || config.endpoint) throw new Error('Config encryption requires a managed daemon.');
    const { binaryPath } = resolveRclone(config.binaryPath);
    if (!binaryPath) throw new Error('The rclone executable could not be found.');
    const configured = managedPaths(config).configPath;
    const configPath = resolvedConfigPath(configured);
    const original = configSnapshot(configPath);
    const assertUnchanged = () => {
      const current = configSnapshot(configPath);
      const unchanged = original === null ? current === null : current !== null &&
        current.dev === original.dev && current.ino === original.ino && current.contents.equals(original.contents);
      if (resolvedConfigPath(configured) !== configPath || !unchanged) {
        throw new Error('The rclone config changed during encryption setup. Try again.');
      }
    };
    const oldPassword = await readConfigPassword(configPath);
    await mkdir(dirname(configPath), { recursive: true });
    const directory = mkdtempSync(join(dirname(configPath), '.rclone-encryption-'));
    const stage = join(directory, 'rclone.conf');
    try {
      writeFileAtomic(stage, original?.contents ?? '');
      const verify = (value: string | null) => runConfig(binaryPath, stage, ['listremotes', '--ask-password=false'], value);
      if (await configEncrypted(stage)) {
        const unlocked = !!oldPassword && await verify(oldPassword).then(() => true, () => false);
        if (!unlocked) {
          if (!password) throw new Error('Supply the existing encryption password before removing it.');
          await verify(password);
          assertUnchanged();
          await saveConfigPassword(configPath, password);
          return;
        }
      }

      if (hasOuterWhitespace) throw new Error(PASSWORD_WHITESPACE_ERROR);
      const action = password === null ? 'remove' : 'set';
      await runConfig(binaryPath, stage, ['config', 'encryption', action], oldPassword, password === null ? '' : `${password}\n${password}\n`);
      if (await configEncrypted(stage) !== (password !== null)) throw new Error('rclone did not apply the requested config encryption.');
      await verify(password);
      await replaceConfigWithPassword(configPath, stage, password, assertUnchanged);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, (running) => {
    if (running && hasOuterWhitespace) throw new Error(PASSWORD_WHITESPACE_ERROR);
  });
}
