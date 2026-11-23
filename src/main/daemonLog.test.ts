import { describe, expect, it } from 'vitest';
import { parseDaemonLog, sanitizeDaemonMessage } from './daemonLog';

describe('daemonLog', () => {
  it('preserves actionable rclone error messages and object context', () => {
    const entry = parseDaemonLog(JSON.stringify({
      level: 'error',
      msg: 'couldn\'t list directory: googleapi: Error 403: User rate limit exceeded.',
      object: 'gdrive:Photos',
      time: '2026-11-22T20:18:00Z',
    }));
    expect(entry).toEqual({
      ts: '2026-11-22T20:18:00.000Z',
      level: 'error',
      source: 'rclone',
      message: 'gdrive:Photos: couldn\'t list directory: googleapi: Error 403: User rate limit exceeded.',
    });
  });

  it('does not rewrite crypt filename decryption errors as config decryption failures', () => {
    const entry = parseDaemonLog(JSON.stringify({
      level: 'error',
      msg: 'ChangeNotify was unable to decrypt "config-report.csv"',
      object: 'vault:config-report.csv',
    }));
    expect(entry?.message).toBe('vault:config-report.csv: ChangeNotify was unable to decrypt "config-report.csv"');

    const configErr = parseDaemonLog(JSON.stringify({
      level: 'error',
      msg: 'Failed to decrypt configuration: wrong password',
    }));
    expect(configErr?.message).toBe('Could not decrypt rclone configuration.');
  });

  it('redacts connection strings (including digit/Unicode names and trailing backslashes), quoted/escaped passwords, auth headers, and runtime secrets', () => {
    const cases = [
      'GET https://alice:s3cr3t@nas.example.test:22/file',
      '{"Authorization":"AWS4-HMAC-SHA256 Credential=AKIA123/2026, Signature=deadbeef"}',
      'Authorization: Digest username="alice", response="digest-resp-99"',
      'Proxy-Authorization: "Basic dXNlcjpwYXNz"',
      ':s3,secret_access_key="abc:123":bucket/key',
      '1drive,pass="C:\\dir\\",other="foo""bar":dir/file',
      'café,pass="unic0de":path',
      '{"access_token":"tok-1","password":"abc\\"leaked"}',
      'password="quoted secret" X-Amz-Signature=sig999',
    ];
    for (const raw of cases) {
      const sanitized = sanitizeDaemonMessage(raw, undefined, ['pass']);
      for (const leaked of [
        'alice:s3cr3t', 'AKIA123', 'deadbeef', 'digest-resp-99', 'dXNlcjpwYXNz',
        'abc:123', 'C:\\dir\\', 'foo""bar', 'unic0de', 'tok-1', 'abc\\"leaked', 'leaked', 'quoted secret', 'sig999',
      ]) {
        expect(sanitized).not.toContain(leaked);
      }
    }
    expect(sanitizeDaemonMessage('1drive,pass="C:\\dir\\":dir/file')).toBe('1drive,[redacted]:dir/file');
    expect(sanitizeDaemonMessage('café,pass="unic0de":path')).toBe('café,[redacted]:path');
    expect(sanitizeDaemonMessage(':sftp,key_pem=SYNTHETIC KEY MATERIAL:path')).toBe(':sftp,[redacted]:path');
    expect(sanitizeDaemonMessage(':sftp,key_pem=SYNTHETIC KEY MATERIAL://path')).toBe(':sftp,[redacted]://path');
    expect(sanitizeDaemonMessage(':sftp,key_pem=SYNTHETIC="KEY MATERIAL://path')).toBe(':sftp,[redacted]://path');
    expect(sanitizeDaemonMessage(':sftp,pass=it\'s secret:path')).toBe(':sftp,[redacted]:path');
  });

  it('scans large quote-heavy, repeated-header, and repeated-inline lines in bounded linear time', () => {
    const quoteHeavy = `${'a,b="x" '.repeat(2500)}tail`;
    const repeatedAuth = `${'Authorization: x '.repeat(3000)}tail`;
    const repeatedInline = 'a,pass=x:b '.repeat(3000);
    const start = performance.now();
    expect(sanitizeDaemonMessage(quoteHeavy).length).toBeLessThanOrEqual(500);
    expect(sanitizeDaemonMessage(repeatedAuth)).toBe('Authorization: [redacted]');
    expect(sanitizeDaemonMessage(repeatedInline)).toContain('a,[redacted]:b');
    expect(performance.now() - start).toBeLessThan(100);
  });

  it('keeps friendly startup rewrites for known control messages', () => {
    const entry = parseDaemonLog(JSON.stringify({
      level: 'notice',
      msg: 'Serving remote control on http://127.0.0.1:5572/',
      time: '2026-11-22T20:14:00Z',
    }));
    expect(entry?.message).toBe('Listening for remote control requests.');
  });
});
