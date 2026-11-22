import { describe, expect, it } from 'vitest';
import { posix, win32 } from 'node:path';
import { mountBackend } from './prereqs';

const detect = (platform: NodeJS.Platform, paths: string[], env = {}) =>
  mountBackend(platform, (path) => paths.includes(path), env);

describe('mount prerequisite detection', () => {
  it.each([
    '/Library/Application Support/fuse-t', '/Library/Frameworks/fuse_t.framework',
    '/usr/local/bin/go-nfsv4', '/opt/homebrew/bin/go-nfsv4',
  ])('detects FUSE-T at %s', (path) => {
    expect(detect('darwin', [path])).toMatchObject({ available: true, name: 'FUSE-T' });
  });

  it('detects macFUSE and reports both installations when available', () => {
    const macFuse = '/Library/Filesystems/osxfuse.fs';
    expect(detect('darwin', [macFuse])).toMatchObject({ available: true, name: 'macFUSE' });
    expect(detect('darwin', [macFuse, '/opt/homebrew/bin/go-nfsv4']).details).toContain('FUSE-T and macFUSE');
    expect(detect('darwin', [])).toMatchObject({ available: false, name: 'FUSE-T', details: expect.stringContaining('nfsmount') });
  });

  it('detects WinFsp using either Program Files location and its DLL or bin directory', () => {
    const root = 'C:\\Program Files (x86)';
    expect(detect('win32', [win32.join(root, 'WinFsp', 'bin', 'winfsp-x64.dll')], { 'ProgramFiles(x86)': root }).available).toBe(true);
    expect(detect('win32', [win32.join(root, 'WinFsp', 'bin')], { ProgramFiles: root }).available).toBe(true);
    expect(detect('win32', [], { ProgramFiles: root }).available).toBe(false);
  });

  it.each(['fusermount3', 'fusermount'])('requires both /dev/fuse and %s on Linux', (helper) => {
    const binary = posix.join('/usr/bin', helper);
    const env = { PATH: '/usr/bin' };
    expect(detect('linux', ['/dev/fuse', binary], env).available).toBe(true);
    expect(detect('linux', ['/dev/fuse'], env).available).toBe(false);
    expect(detect('linux', [binary], env).available).toBe(false);
  });
});
