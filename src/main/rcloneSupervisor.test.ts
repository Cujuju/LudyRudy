import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeSettings } from '@shared/settings';
import { openDaemon } from './rcloneSupervisor';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  argument: vi.fn<(name: string) => string | undefined>(),
  settings: vi.fn(),
  password: vi.fn(),
  profileFile: vi.fn(),
  localVersion: vi.fn<() => Promise<string | null>>(),
}));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('./paths', () => ({
  argument: mocks.argument, profileFile: mocks.profileFile,
  resolveRclone: () => ({ binaryPath: '/bundled/rclone', binarySource: 'bundled' }),
}));
vi.mock('./prereqs', () => ({
  mountBackend: () => ({ available: true, name: 'FUSE', details: '', installUrl: '' }),
  localVersion: mocks.localVersion,
}));
vi.mock('./settingsStore', () => ({ getSettings: mocks.settings, readConfigPassword: mocks.password }));

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 12;
  kill = vi.fn(() => { this.close(); return true; });

  close(): void {
    this.stdout.end();
    this.stderr.end();
    this.emit('close', 0);
  }
}

function fixture(quit: () => void = () => {}, os?: string) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input) => {
    switch (new URL(String(input)).pathname) {
      case '/core/version': return Response.json({ version: 'v1.76.0', os });
      case '/core/pid': return Response.json({ pid: 12 });
      case '/config/listremotes': return Response.json({ remotes: ['drive'] });
      case '/config/dump': return Response.json({ drive: { type: 'drive' } });
      case '/mount/listmounts': return Response.json({ mountPoints: [] });
      case '/core/stats': return Response.json({ bytes: 0 });
      case '/core/bwlimit': return Response.json({ rate: 'off' });
      case '/core/quit': quit(); return Response.json({});
      default: return Response.json({});
    }
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

let directory: string;
beforeEach(async () => {
  vi.resetAllMocks();
  directory = await mkdtemp(join(process.cwd(), '.supervisor-test-'));
  mocks.profileFile.mockImplementation((name: string) => join(directory, name));
  mocks.settings.mockReturnValue(normalizeSettings(undefined));
  mocks.localVersion.mockResolvedValue('v1.76.0');
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

describe('RcloneSupervisor', () => {
  it.each(['cli', 'settings'])('attaches using %s, reconnects, and never quits an external daemon', async (source) => {
    if (source === 'cli') {
      mocks.argument.mockImplementation((name) => name === '--rclone-endpoint' ? 'http://localhost:4321' : 'app:auth');
      mocks.settings.mockReturnValue(normalizeSettings({ daemon: { endpoint: 'http://localhost:1234' } }));
    } else mocks.settings.mockReturnValue(normalizeSettings({ daemon: { endpoint: 'http://localhost:4321' } }));
    const fetch = fixture(undefined, 'windows');
    const daemon = openDaemon();
    await daemon.start();
    expect(daemon.current().daemon).toMatchObject({ mode: 'attached', state: 'running', attached: true, endpoint: 'http://localhost:4321/', hostPlatform: 'win32' });
    await daemon.restart();
    await daemon.stop();
    expect(daemon.current().daemon).toMatchObject({ state: 'stopped', attached: false, pid: null, hostPlatform: null });
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.localVersion).not.toHaveBeenCalled();
    expect(fetch.mock.calls.some(([url]) => /quit|unmount/.test(String(url)))).toBe(false);
  });

  it('clears an attached host platform when its connection fails and detects the next host', async () => {
    mocks.settings.mockReturnValue(normalizeSettings({ daemon: { endpoint: 'http://localhost:4321' } }));
    const daemon = openDaemon();
    fixture(undefined, 'windows');
    await daemon.start();
    expect(daemon.current().daemon.hostPlatform).toBe('win32');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
    await daemon.refresh();
    expect(daemon.current().daemon.hostPlatform).toBeNull();
    fixture(undefined, 'linux');
    await daemon.restart();
    expect(daemon.current().daemon.hostPlatform).toBe('linux');
  });

  it('changes remote revision for a config-only edit without exposing the edited value', async () => {
    mocks.argument.mockImplementation((name) => name === '--rclone-endpoint' ? 'http://localhost:4321' : undefined);
    const fetch = fixture();
    const fallback = fetch.getMockImplementation()!;
    let dump = { drive: { type: 'drive', token: crypto.randomUUID() } };
    fetch.mockImplementation((url, init) => new URL(String(url)).pathname === '/config/dump'
      ? Promise.resolve(Response.json(dump)) : fallback(url, init));
    const daemon = openDaemon();
    await daemon.start();
    const initial = daemon.current();
    await daemon.refresh();
    expect(daemon.current().remoteRevision).toBe(initial.remoteRevision);

    dump = { drive: { type: 'drive', token: crypto.randomUUID() } };
    await daemon.refresh();
    expect(daemon.current().remoteRevision).toBeGreaterThan(initial.remoteRevision);
    expect(daemon.current().remotes).toEqual(initial.remotes);
    expect(JSON.stringify(daemon.current())).not.toContain(dump.drive.token);
    await daemon.stop();
  });

  it('ignores remote inventory scans begun before a config write', async () => {
    mocks.argument.mockImplementation((name) => name === '--rclone-endpoint' ? 'http://localhost:4321' : undefined);
    const fetch = fixture();
    const daemon = openDaemon();
    await daemon.start();
    const fallback = fetch.getMockImplementation()!;
    let releaseOld!: (value: Response) => void;
    let releaseNew!: (value: Response) => void;
    let started!: () => void;
    const oldStarted = new Promise<void>((resolve) => { started = resolve; });
    const oldDump = new Promise<Response>((resolve) => { releaseOld = resolve; });
    const newDump = new Promise<Response>((resolve) => { releaseNew = resolve; });
    let delayOldDump = true;
    fetch.mockImplementation((url, init) => {
      if (new URL(String(url)).pathname !== '/config/dump') return fallback(url, init);
      if (!delayOldDump) return newDump;
      started();
      return oldDump;
    });

    const initial = daemon.current();
    let oldSettled = false;
    const old = daemon.refresh().then((value) => { oldSettled = true; return value; });
    await oldStarted;
    delayOldDump = false;
    daemon.invalidateRemoteInventory();
    const replacement = daemon.refresh();
    releaseOld(Response.json({ drive: { type: 'drive' } }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(oldSettled).toBe(false);
    expect(daemon.current()).toBe(initial);

    releaseNew(Response.json({ drive: { type: 'memory' } }));
    await replacement;
    expect(await old).toBe(daemon.current());
    expect(daemon.current().remotes[0]?.type).toBe('memory');
    expect(daemon.current().remoteRevision).toBe(initial.remoteRevision + 1);
    await daemon.stop();
  });

  it('does not send CLI credentials to a settings-only endpoint', async () => {
    mocks.argument.mockImplementation((name) => name === '--rclone-auth' ? `review:${crypto.randomUUID()}` : undefined);
    mocks.settings.mockReturnValue(normalizeSettings({ daemon: { endpoint: 'http://localhost:4321' } }));
    const fetch = fixture();
    const daemon = openDaemon();
    await expect(daemon.start()).rejects.toThrow('require an explicit --rclone-endpoint');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes credentials via environment, publishes safe logs, and unmounts before quitting', async () => {
    const child = new FakeChild();
    const rcloneConfigSecret = crypto.randomUUID();
    mocks.password.mockReturnValue(rcloneConfigSecret);
    await writeFile(join(directory, 'rclone.conf'), 'RCLONE_ENCRYPT_V0:\n');
    mocks.spawn.mockReturnValue(child);
    const fetch = fixture(() => child.close());
    const log = vi.fn();
    const ready = vi.fn();
    const daemon = openDaemon({ log, ready });
    await daemon.start();
    expect(daemon.current().daemon).toMatchObject({ mode: 'managed', state: 'running', attached: false, pid: 12 });
    expect(ready).toHaveBeenCalledTimes(1);
    const [binary, args, { env }] = mocks.spawn.mock.lastCall!;
    expect(binary).toBe('/bundled/rclone');
    expect(args).toEqual([
      'rcd', '--rc-addr', expect.stringMatching(/^127\.0\.0\.1:[1-9]\d+$/), '--config', join(directory, 'rclone.conf'),
      '--cache-dir', join(directory, 'cache'), '--use-json-log', '--log-level', 'INFO', '--ask-password=false', '--rc-no-auth=false',
    ]);
    expect(env).toMatchObject({
      RCLONE_RC_USER: expect.stringMatching(/^[0-9a-f]{64}$/),
      RCLONE_RC_PASS: expect.stringMatching(/^[0-9a-f]{64}$/),
      RCLONE_CONFIG_PASS: rcloneConfigSecret,
    });
    for (const secret of [env.RCLONE_RC_USER, env.RCLONE_RC_PASS, rcloneConfigSecret]) expect(args.join(' ')).not.toContain(secret);
    const auth = new Headers(fetch.mock.calls[0]?.[1]?.headers).get('Authorization');
    expect(auth).toBe(`Basic ${Buffer.from(`${env.RCLONE_RC_USER}:${env.RCLONE_RC_PASS}`).toString('base64')}`);
    child.stdout.write('garbage\n{"level":"warning","msg":"Serving remote');
    child.stdout.write(' control on loopback","time":"2026-01-01T00:00:00Z"}\n');
    child.stderr.write(JSON.stringify({ level: 'error', msg: rcloneConfigSecret, token: env.RCLONE_RC_PASS }) + '\n');
    expect(log.mock.calls.at(-2)?.[0]).toEqual({
      source: 'rclone', level: 'warn', ts: '2026-01-01T00:00:00.000Z', message: 'Listening for remote control requests.',
    });
    expect(JSON.stringify(daemon.current().logs)).not.toContain(rcloneConfigSecret);
    await daemon.stop();
    expect(fetch.mock.calls.slice(-2).map(([url]) => new URL(String(url)).pathname)).toEqual(['/mount/unmountall', '/core/quit']);
    expect(child.kill).not.toHaveBeenCalled();
    expect(daemon.current().daemon.state).toBe('stopped');
  });

  it('runs startup hooks once per managed process across RC reconnects', async () => {
    const first = new FakeChild();
    const second = new FakeChild();
    mocks.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
    let child = first;
    const fetch = fixture(() => child.close());
    const ready = vi.fn();
    const daemon = openDaemon({ ready });
    await daemon.start();
    fetch.mockRejectedValueOnce(new Error('Temporary connection failure'));
    await daemon.refresh();
    expect(daemon.current().daemon.state).toBe('error');
    await daemon.refresh();
    expect(daemon.current().daemon.state).toBe('running');
    expect(ready).toHaveBeenCalledTimes(1);
    expect(daemon.current().logs[0]?.message).toBe('Reconnected to managed rclone.');

    await daemon.stop();
    child = second;
    await daemon.start();
    expect(ready).toHaveBeenCalledTimes(2);
    await daemon.stop();
  });

  it('leaves the running child alone if a queued stop precondition fails', async () => {
    const child = new FakeChild();
    mocks.spawn.mockReturnValue(child);
    const fetch = fixture(() => child.close());
    const daemon = openDaemon();
    const start = daemon.start();
    const action = vi.fn(async () => undefined);
    const transition = daemon.whileStopped(action, (running) => {
      if (running) throw new Error('Invalid pending operation');
    });
    await start;
    await expect(transition).rejects.toThrow('Invalid pending operation');
    expect(daemon.current().daemon.state).toBe('running');
    expect(action).not.toHaveBeenCalled();
    expect(fetch.mock.calls.some(([url]) => /quit|unmount/.test(String(url)))).toBe(false);
    await daemon.stop();
  });

  it('falls back to SIGTERM when graceful quit does not exit', async () => {
    const child = new FakeChild();
    mocks.spawn.mockReturnValue(child);
    fixture();
    const daemon = openDaemon();
    await daemon.start();
    await daemon.stop();
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
  });

  it('publishes crashes and can start a fresh process with new credentials', async () => {
    const first = new FakeChild();
    const second = new FakeChild();
    mocks.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
    fixture(() => second.close());
    const crashed = vi.fn();
    const daemon = openDaemon({ crashed });
    await daemon.start();
    first.close();
    expect(daemon.current()).toMatchObject({ daemon: { state: 'error', pid: null }, remotes: [] });
    expect(crashed).toHaveBeenCalledTimes(1);
    await daemon.start();
    expect(mocks.spawn.mock.calls[0]?.[2].env.RCLONE_RC_PASS).not.toBe(mocks.spawn.mock.calls[1]?.[2].env.RCLONE_RC_PASS);
    expect(daemon.current().daemon.state).toBe('running');
    await daemon.stop();
    expect(crashed).toHaveBeenCalledTimes(1);
  });

  it('retains only the most recent parsed log entries', async () => {
    const child = new FakeChild();
    mocks.spawn.mockReturnValue(child);
    fixture(() => child.close());
    const daemon = openDaemon();
    await daemon.start();
    for (let index = 0; index < 210; index++) child.stdout.write('{"level":"notice","msg":"a log"}\n');
    expect(daemon.current().logs).toHaveLength(200);
    expect(daemon.current().logs.every((line) => line.source === 'rclone')).toBe(true);
    await daemon.stop();
  });
});
