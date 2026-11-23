import type { RemoteEntry } from '@shared/types';

export type FileKind =
  | 'folder'
  | 'pdf'
  | 'image'
  | 'video'
  | 'audio'
  | 'spreadsheet'
  | 'presentation'
  | 'document'
  | 'code'
  | 'archive'
  | 'text'
  | 'file';

export interface FileTypeInfo {
  kind: FileKind;
  label: string;
}

export type BrowserColumnKey = 'type' | 'size' | 'modTime' | 'mimeType' | 'id' | 'tier' | 'encrypted';

export interface BrowserColumnDef {
  key: BrowserColumnKey;
  label: string;
  defaultVisible: boolean;
}

export const BROWSER_COLUMNS: readonly BrowserColumnDef[] = [
  { key: 'type', label: 'Type', defaultVisible: true },
  { key: 'size', label: 'Size', defaultVisible: true },
  { key: 'modTime', label: 'Modified', defaultVisible: true },
  { key: 'mimeType', label: 'MIME type', defaultVisible: false },
  { key: 'id', label: 'ID', defaultVisible: false },
  { key: 'tier', label: 'Storage tier', defaultVisible: false },
  { key: 'encrypted', label: 'Encrypted name', defaultVisible: false },
];

const VALID_COLUMN_KEYS = new Set<string>(BROWSER_COLUMNS.map((c) => c.key));

export const DEFAULT_BROWSER_COLUMNS: readonly BrowserColumnKey[] = BROWSER_COLUMNS
  .filter((c) => c.defaultVisible)
  .map((c) => c.key);

export function isBrowserColumnList(value: unknown): value is BrowserColumnKey[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && VALID_COLUMN_KEYS.has(item));
}

export type SortKey = 'name' | BrowserColumnKey;
export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: SortKey;
  direction: SortDirection;
}

const LABELS: Record<FileKind, string> = {
  folder: 'Folder',
  pdf: 'PDF',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  spreadsheet: 'Spreadsheet',
  presentation: 'Presentation',
  document: 'Document',
  code: 'Code',
  archive: 'Archive',
  text: 'Text',
  file: 'File',
};

const EXT_GROUPS: readonly [FileKind, readonly string[]][] = [
  ['pdf', ['pdf']],
  ['image', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tif', 'tiff', 'heic', 'avif', 'psd']],
  ['video', ['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'wmv', 'm4v']],
  ['audio', ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus']],
  ['spreadsheet', ['xlsx', 'xls', 'csv', 'tsv', 'ods', 'numbers']],
  ['presentation', ['pptx', 'ppt', 'odp', 'key']],
  ['document', ['doc', 'docx', 'odt', 'rtf', 'pages', 'epub']],
  ['archive', ['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'zst', 'dmg', 'iso']],
  ['code', [
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp',
    'cs', 'rb', 'php', 'sh', 'bash', 'zsh', 'ps1', 'html', 'css', 'scss', 'json', 'yaml', 'yml',
    'toml', 'xml', 'sql', 'graphql', 'vue', 'svelte', 'swift', 'kt', 'dart',
  ]],
  ['text', ['txt', 'md', 'markdown', 'log', 'ini', 'cfg', 'conf', 'env']],
];

const EXT_TO_KIND = new Map<string, FileKind>(
  EXT_GROUPS.flatMap(([kind, exts]) => exts.map((ext) => [ext, kind] as const)),
);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}

function specificKindFromMime(mimeType: string): FileKind | null {
  const mime = mimeType.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  if (!mime || mime === 'application/octet-stream') return null;
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'text/csv' || mime.includes('spreadsheet') || mime.includes('excel')) return 'spreadsheet';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'presentation';
  if (mime === 'application/epub+zip' || mime.includes('wordprocessing') || mime.includes('msword')) return 'document';
  if (mime === 'application/json' || mime === 'application/xml' || mime === 'text/html'
    || mime === 'text/css' || mime.includes('javascript')) return 'code';
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('gzip')
    || mime.includes('7z') || mime.includes('rar') || mime.includes('compressed') || mime.includes('archive')) return 'archive';
  return null;
}

export function classifyEntry(entry: Pick<RemoteEntry, 'isDir' | 'name' | 'mimeType'>): FileTypeInfo {
  if (entry.isDir) return { kind: 'folder', label: LABELS.folder };
  const mime = entry.mimeType.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  const kind = specificKindFromMime(mime)
    ?? EXT_TO_KIND.get(extensionOf(entry.name))
    ?? (mime.startsWith('text/') ? 'text' : 'file');
  return { kind, label: LABELS[kind] };
}

export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  const direction: SortDirection = key === 'size' || key === 'modTime' ? 'desc' : 'asc';
  return { key, direction };
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

function timestampOf(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function sortEntries(entries: readonly RemoteEntry[], sort: SortState): RemoteEntry[] {
  const factor = sort.direction === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (sort.key === 'name' || sort.key === 'size') {
      const dirDiff = Number(b.isDir) - Number(a.isDir);
      if (dirDiff !== 0) return dirDiff;
    }

    let diff = 0;
    if (sort.key === 'name') {
      diff = compareNames(a.name, b.name);
    } else if (sort.key === 'type') {
      diff = classifyEntry(a).label.localeCompare(classifyEntry(b).label, undefined, { sensitivity: 'base' });
    } else if (sort.key === 'size') {
      diff = a.size - b.size;
    } else if (sort.key === 'modTime') {
      diff = timestampOf(a.modTime) - timestampOf(b.modTime);
    } else {
      const av = a[sort.key] ?? '';
      const bv = b[sort.key] ?? '';
      diff = av.localeCompare(bv, undefined, { sensitivity: 'base' });
    }

    return diff !== 0 ? diff * factor : compareNames(a.name, b.name);
  });
}
