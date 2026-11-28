import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { DEMO_JOBS, DEMO_MOUNTS, DEMO_WINDOW } from './fixtures.mts';
import { startDemoRclone } from './server.mts';

const ROOT = resolve(import.meta.dirname, '../..');
const DEFAULT_THEME = 'tonal';

export async function launchDemo({ theme = DEFAULT_THEME, debuggingPort }: { theme?: string; debuggingPort?: number } = {}) {
  const profile = await mkdtemp(join(ROOT, 'out', 'demo-'));
  let daemon: Awaited<ReturnType<typeof startDemoRclone>> | undefined;
  try {
    await mkdir(profile, { recursive: true });
    await Promise.all([
      writeFile(join(profile, 'settings.json'), JSON.stringify({
        general: { theme }, notifications: { daemonErrors: false }, mounts: DEMO_MOUNTS, jobs: DEMO_JOBS,
      })),
      writeFile(join(profile, 'window-state.json'), JSON.stringify(DEMO_WINDOW)),
    ]);
    const server = await startDemoRclone();
    daemon = server;
    const { endpoint, auth } = server;
    const env: NodeJS.ProcessEnv = { ...process.env, LUDYRUDY_RCLONE_AUTH: auth };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    const electron = createRequire(import.meta.url)('electron') as string;
    const args = [ROOT, `--user-data-dir=${profile}`, `--rclone-endpoint=${endpoint}`];
    if (process.platform === 'darwin') args.push('--use-mock-keychain');
    if (debuggingPort) args.push(`--remote-debugging-port=${debuggingPort}`);
    const child = spawn(electron, args, { cwd: ROOT, env, stdio: 'inherit' });
    let failure: string | undefined;
    const exited = new Promise<void>((resolveExit) => {
      child.once('error', (error) => { failure = error.message; resolveExit(); });
      child.once('exit', () => resolveExit());
    });
    let closing: Promise<void> | undefined;
    return {
      daemon: server, exited,
      exitReason: () => failure ?? (child.exitCode === null && child.signalCode === null ? null : `Electron exited (${child.exitCode ?? child.signalCode}).`),
      close() {
        closing ??= (async () => {
          child.kill();
          await exited;
          try { await server.close(); } finally { await rm(profile, { recursive: true, force: true }); }
        })();
        return closing;
      },
    };
  } catch (error) {
    try { await daemon?.close(); } finally { await rm(profile, { recursive: true, force: true }); }
    throw error;
  }
}
