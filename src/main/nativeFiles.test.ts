import { afterEach, expect, it, vi } from 'vitest';
import { basename, dirname, resolve } from 'node:path';
import { nativeFiles } from './nativeFiles';
import { RcloneClient } from './rcloneClient';
import type { RcloneSupervisor } from './rcloneSupervisor';

const dialog = vi.hoisted(() => ({ showOpenDialog: vi.fn(), showSaveDialog: vi.fn() }));
vi.mock('electron', () => ({ dialog, shell: {} }));
vi.mock('./paths', () => ({}));
vi.mock('./window', () => ({ mainWindow: () => undefined }));
vi.mock('./rcloneSupervisor', () => ({
  errorMessage: (error: Error) => error.message,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

function managedFiles() {
  const client = new RcloneClient('http://localhost:5572');
  return nativeFiles({
    current: () => ({ daemon: { mode: 'managed', hostPlatform: process.platform } }),
    forRemote: () => client,
  } as unknown as RcloneSupervisor);
}

it.skipIf(process.platform === 'win32')('downloads a literal POSIX filename and preserves its suggested name', async () => {
  const name = 'part\\name\r\n.txt';
  const savePath = resolve(name);
  dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: savePath });
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json({}));
  vi.stubGlobal('fetch', fetch);
  await expect(managedFiles().downloadFile('drive', `docs/${name}`, name)).resolves.toBe(true);
  expect(dialog.showSaveDialog).toHaveBeenCalledWith({ defaultPath: name });
  expect(JSON.parse(String(fetch.mock.lastCall?.[1]?.body))).toMatchObject({ srcRemote: `docs/${name}`, dstRemote: name });
});

it('reports completed and skipped uploads after a destination appears during the batch', async () => {
  const first = resolve('first.txt');
  const second = resolve('second.txt');
  dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [first, second, resolve('third.txt')] });
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ item: null }))
    .mockResolvedValueOnce(Response.json({ item: null }))
    .mockResolvedValueOnce(Response.json({ item: null }))
    .mockResolvedValueOnce(Response.json({}))
    .mockResolvedValueOnce(Response.json({ error: 'immutable file modified' }, { status: 500 }));
  vi.stubGlobal('fetch', fetch);
  await expect(managedFiles().uploadFiles('drive', 'docs')).resolves.toEqual({
    uploaded: ['first.txt'],
    skipped: ['third.txt'],
    failure: { file: 'second.txt', message: 'The destination already exists.' },
  });
  expect(fetch.mock.calls.map(([url, request]) => [new URL(String(url)).pathname, JSON.parse(String(request?.body))])).toEqual([
    ...['first', 'second', 'third'].map((name) => ['/operations/stat', { fs: 'drive:', remote: `docs/${name}.txt` }]),
    ['/operations/copyfile', {
      srcFs: dirname(first), srcRemote: basename(first), dstFs: 'drive:', dstRemote: 'docs/first.txt',
      _config: { Immutable: true, IgnoreTimes: true },
    }],
    ['/operations/copyfile', {
      srcFs: dirname(second), srcRemote: basename(second), dstFs: 'drive:', dstRemote: 'docs/second.txt',
      _config: { Immutable: true, IgnoreTimes: true },
    }],
  ]);
});

it('preflights the entire selection before transferring any file', async () => {
  dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [resolve('first.txt'), resolve('second.txt')] });
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ item: null }))
    .mockResolvedValueOnce(Response.json({ item: { Path: 'docs/second.txt', Name: 'second.txt' } }));
  vi.stubGlobal('fetch', fetch);
  await expect(managedFiles().uploadFiles('drive', 'docs')).rejects.toThrow('The destination already exists.');
  expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(['/operations/stat', '/operations/stat']);
});

it('rejects repeated basenames before requesting any remote operation', async () => {
  dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [resolve('one', 'same.txt'), resolve('two', 'same.txt')] });
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(managedFiles().uploadFiles('drive', 'docs')).rejects.toThrow('Choose files with distinct names.');
  expect(fetch).not.toHaveBeenCalled();
});
