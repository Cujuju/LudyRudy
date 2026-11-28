import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { renderOAuthTemplate } from './oauthTemplate';
import { openAuth } from './rcloneAuth';

function fakeChild() {
  const child = new EventEmitter() as ChildProcess & EventEmitter;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = vi.fn(() => {
    child.emit('close', 1);
    return true;
  });
  return { child, stdout, stderr };
}

type SpawnCall = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

describe('oauthTemplate', () => {
  it('renders a Go html/template with success and error branches', () => {
    const html = renderOAuthTemplate('Google Drive');
    expect(html).toContain('{{ if .OK }}');
    expect(html).toContain('{{ else }}');
    expect(html).toContain('Google Drive connected.');
    expect(html).toContain('Return to LudyRudy to finish setup.');
    expect(html).toContain('Close tab');
    expect(html).toContain('Google Drive authorization failed.');
  });

  it('escapes HTML and strips Go template delimiters from provider labels', () => {
    const html = renderOAuthTemplate('<img src=x>{{ .Secret }}');
    expect(html).not.toContain('<img src=x>');
    expect(html).not.toContain('{{ .Secret }}');
    expect(html).toContain('&lt;img src=x&gt; .Secret ');
  });
});

describe('openAuth', () => {
  it('passes a temporary --template file to rclone authorize and removes it on exit', async () => {
    const { child, stdout, stderr } = fakeChild();
    const spawnMock = vi.fn<SpawnCall>(() => child);
    const updates: string[] = [];
    const auth = openAuth((session) => updates.push(session.state), spawnMock);

    const session = auth.start('/bin/rclone', 'drive');
    const [, args] = spawnMock.mock.calls[0]!;
    const flagIndex = args.indexOf('--template');
    expect(flagIndex).toBeGreaterThan(-1);
    const templatePath = args[flagIndex + 1]!;
    expect(existsSync(templatePath)).toBe(true);
    expect(readFileSync(templatePath, 'utf8')).toContain('Google Drive connected.');

    stderr.write('go to the following link: http://127.0.0.1:53682/auth?state=abc123\n');
    stdout.write('Paste the following into your remote machine --->\n');
    stdout.write('{"access_token":"tok"}\n');
    await new Promise((resolve) => setTimeout(resolve, 10));
    child.emit('close', 0);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(existsSync(templatePath)).toBe(false);
    expect(auth.status(session.id)?.state).toBe('completed');
    expect(auth.token(session.id, 'drive')).toBe('{"access_token":"tok"}');
    expect(updates).toEqual(['awaiting', 'completed']);
    await auth.stop();
  });

  it('publishes expiry to the renderer and discards completed credentials', async () => {
    vi.useFakeTimers();
    const { child, stdout } = fakeChild();
    const publish = vi.fn();
    const auth = openAuth(publish, () => child);
    try {
      const session = auth.start('/bin/rclone', 'drive');
      const token = JSON.stringify({ access_token: crypto.randomUUID() });
      stdout.write('Paste the following into your remote machine --->\n');
      stdout.write(token + '\n');
      child.emit('close', 0);
      expect(auth.token(session.id, 'drive')).toBe(token);

      await vi.runOnlyPendingTimersAsync();
      expect(publish).toHaveBeenLastCalledWith({
        ...session, state: 'expired', error: 'Authorization expired. Authorize again to finish setup.',
      });
      expect(JSON.stringify(publish.mock.calls)).not.toContain(token);
      expect(auth.status(session.id)).toBeNull();
      expect(() => auth.token(session.id, 'drive')).toThrow('Authorization is incomplete or expired.');
    } finally {
      await auth.stop();
      vi.useRealTimers();
    }
  });

  it('removes the temporary template file when authorization is cancelled', async () => {
    const { child } = fakeChild();
    const spawnMock = vi.fn<SpawnCall>(() => child);
    const auth = openAuth(() => undefined, spawnMock);

    const session = auth.start('/bin/rclone', 'onedrive');
    const [, args] = spawnMock.mock.calls[0]!;
    const templatePath = args[args.indexOf('--template') + 1]!;
    expect(existsSync(templatePath)).toBe(true);
    expect(readFileSync(templatePath, 'utf8')).toContain('OneDrive connected.');

    await auth.cancel(session.id);
    expect(existsSync(templatePath)).toBe(false);
  });
});
