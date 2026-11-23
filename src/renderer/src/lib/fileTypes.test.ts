import { describe, expect, it } from 'vitest';
import type { RemoteEntry } from '@shared/types';
import { classifyEntry, isBrowserColumnList, nextSort, sortEntries } from './fileTypes';

function entry(overrides: Partial<RemoteEntry> & { name: string }): RemoteEntry {
  return {
    path: overrides.name,
    size: 0,
    mimeType: '',
    modTime: '2026-01-01T00:00:00Z',
    isDir: false,
    ...overrides,
  };
}

describe('classifyEntry', () => {
  it('classifies folders regardless of name or mime type', () => {
    expect(classifyEntry(entry({ name: 'archive.zip', isDir: true }))).toEqual({ kind: 'folder', label: 'Folder' });
  });

  it('classifies common document and media extensions', () => {
    expect(classifyEntry(entry({ name: 'schedule.pdf' }))).toEqual({ kind: 'pdf', label: 'PDF' });
    expect(classifyEntry(entry({ name: 'photo.JPG' }))).toEqual({ kind: 'image', label: 'Image' });
    expect(classifyEntry(entry({ name: 'clip.mp4' }))).toEqual({ kind: 'video', label: 'Video' });
    expect(classifyEntry(entry({ name: 'track.flac' }))).toEqual({ kind: 'audio', label: 'Audio' });
    expect(classifyEntry(entry({ name: 'budget.xlsx' }))).toEqual({ kind: 'spreadsheet', label: 'Spreadsheet' });
    expect(classifyEntry(entry({ name: 'deck.pptx' }))).toEqual({ kind: 'presentation', label: 'Presentation' });
    expect(classifyEntry(entry({ name: 'report.docx' }))).toEqual({ kind: 'document', label: 'Document' });
    expect(classifyEntry(entry({ name: 'backup.tar.gz' }))).toEqual({ kind: 'archive', label: 'Archive' });
    expect(classifyEntry(entry({ name: 'index.tsx' }))).toEqual({ kind: 'code', label: 'Code' });
    expect(classifyEntry(entry({ name: 'field-notes.txt' }))).toEqual({ kind: 'text', label: 'Text' });
  });

  it('uses specific mimeType to disambiguate extensions and falls back cleanly', () => {
    expect(classifyEntry(entry({ name: 'stream.ts', mimeType: 'video/MP2T' }))).toEqual({ kind: 'video', label: 'Video' });
    expect(classifyEntry(entry({ name: 'app.ts', mimeType: 'text/plain' }))).toEqual({ kind: 'code', label: 'Code' });
    expect(classifyEntry(entry({ name: 'book.epub', mimeType: 'application/epub+zip' }))).toEqual({ kind: 'document', label: 'Document' });
    expect(classifyEntry(entry({ name: 'README', mimeType: 'text/plain; charset=utf-8' }))).toEqual({ kind: 'text', label: 'Text' });
    expect(classifyEntry(entry({ name: 'blob', mimeType: 'image/webp' }))).toEqual({ kind: 'image', label: 'Image' });
    expect(classifyEntry(entry({ name: 'unknown.bin', mimeType: 'application/octet-stream' }))).toEqual({ kind: 'file', label: 'File' });
    expect(classifyEntry(entry({ name: '.gitignore' }))).toEqual({ kind: 'file', label: 'File' });
  });
});

describe('nextSort', () => {
  it('toggles direction when selecting the active column', () => {
    expect(nextSort({ key: 'name', direction: 'asc' }, 'name')).toEqual({ key: 'name', direction: 'desc' });
    expect(nextSort({ key: 'name', direction: 'desc' }, 'name')).toEqual({ key: 'name', direction: 'asc' });
  });

  it('defaults to desc for size/modTime and asc for name/type', () => {
    expect(nextSort({ key: 'name', direction: 'asc' }, 'size')).toEqual({ key: 'size', direction: 'desc' });
    expect(nextSort({ key: 'name', direction: 'asc' }, 'modTime')).toEqual({ key: 'modTime', direction: 'desc' });
    expect(nextSort({ key: 'size', direction: 'desc' }, 'type')).toEqual({ key: 'type', direction: 'asc' });
  });
});

describe('sortEntries', () => {
  const items: RemoteEntry[] = [
    entry({ name: 'zebra.txt', size: 100, modTime: '2026-01-02T00:00:00Z' }),
    entry({ name: 'Documents', isDir: true, size: 0, modTime: '2026-01-01T00:00:00Z' }),
    entry({ name: 'alpha.pdf', size: 500, modTime: '2026-01-03T00:00:00Z' }),
    entry({ name: 'Archive', isDir: true, size: 0, modTime: '2026-01-05T00:00:00Z' }),
    entry({ name: 'banner.png', size: 250, modTime: '2026-01-04T00:00:00Z' }),
  ];

  it('keeps folders first and sorts by name', () => {
    expect(sortEntries(items, { key: 'name', direction: 'asc' }).map((i) => i.name))
      .toEqual(['Archive', 'Documents', 'alpha.pdf', 'banner.png', 'zebra.txt']);
    expect(sortEntries(items, { key: 'name', direction: 'desc' }).map((i) => i.name))
      .toEqual(['Documents', 'Archive', 'zebra.txt', 'banner.png', 'alpha.pdf']);
  });

  it('sorts by type label across files and folders', () => {
    const withArchive = [...items, entry({ name: 'bundle.zip', size: 50, modTime: '2026-01-01T00:00:00Z' })];
    expect(sortEntries(withArchive, { key: 'type', direction: 'asc' }).map((i) => i.name))
      .toEqual(['bundle.zip', 'Archive', 'Documents', 'banner.png', 'alpha.pdf', 'zebra.txt']);
  });

  it('sorts by size with folders first', () => {
    expect(sortEntries(items, { key: 'size', direction: 'desc' }).map((i) => i.name))
      .toEqual(['Archive', 'Documents', 'alpha.pdf', 'banner.png', 'zebra.txt']);
  });

  it('sorts by modTime across files and folders', () => {
    expect(sortEntries(items, { key: 'modTime', direction: 'desc' }).map((i) => i.name))
      .toEqual(['Archive', 'banner.png', 'alpha.pdf', 'zebra.txt', 'Documents']);
  });

  it('sorts by optional metadata columns and validates persisted column lists', () => {
    const withTier = [
      entry({ name: 'cold.bin', tier: 'GLACIER' }),
      entry({ name: 'hot.bin', tier: 'STANDARD' }),
      entry({ name: 'archive.bin', tier: 'ARCHIVE' }),
    ];
    expect(sortEntries(withTier, { key: 'tier', direction: 'asc' }).map((i) => i.name))
      .toEqual(['archive.bin', 'cold.bin', 'hot.bin']);
    expect(isBrowserColumnList(['type', 'size', 'tier'])).toBe(true);
    expect(isBrowserColumnList(['type', 'bogus'])).toBe(false);
    expect(isBrowserColumnList('type')).toBe(false);
  });
});
