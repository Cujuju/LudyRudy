import { providerName } from '@shared/providers';

const brands = import.meta.glob<string>('../assets/providers/*.svg', { eager: true, query: '?raw', import: 'default' });
const brandAliases = new Map([
  ['google photos', 'google-photos'],
  ['googlephotos', 'google-photos'],
  ['google cloud storage', 'google-cloud-storage'],
  ['googlecloudstorage', 'google-cloud-storage'],
  ['azureblob', 'azure'],
  ['azurefiles', 'azure'],
  ['tardigrade', 'storj'],
]);
const brandColors = new Map([
  ['b2', '#E21E29'],
  ['mega', '#D9272E'],
  ['yandex', '#5282FF'],
  ['huaweidrive', '#FF0000'],
  ['kdrive', '#0098FF'],
  ['mailru', '#005FF9'],
]);
const semantic = {
  crypt: 'LockKeyhole',
  local: 'HardDrive',
  sftp: 'Terminal',
  ftp: 'ArrowLeftRight',
  smb: 'Network',
  webdav: 'Globe',
  http: 'Globe',
  memory: 'Cpu',
  alias: 'Link2',
  cache: 'Database',
  chunker: 'Layers',
  combine: 'FolderTree',
  compress: 'FileArchive',
  archive: 'Archive',
  hasher: 'Hash',
  union: 'GitMerge',
} as const;
const monogramTints = ['var(--color-accent)', 'var(--color-green)', 'var(--color-amber)', 'var(--color-red)'] as const;
const monogramLength = 2;

export function scopeSvgIds(svg: string, instanceId: string): string {
  const prefix = `provider-${instanceId}-`;
  return svg
    .replace(/(\s(?:id\s*=\s*["']|(?:xlink:)?href\s*=\s*["']#))([\w.-]+)(?=["'])/g, `$1${prefix}$2`)
    .replace(/(url\(\s*["']?#)([\w.-]+)(?=["']?\s*\))/g, `$1${prefix}$2`);
}

export function resolveProviderIcon(type: string, instanceId: string) {
  const key = brandAliases.get(type) ?? type;
  const svg = brands[`../assets/providers/${key}.svg`];
  if (svg) return { kind: 'brand', svg: scopeSvgIds(svg, instanceId), color: brandColors.get(key) } as const;

  if (Object.hasOwn(semantic, type)) {
    return { kind: 'semantic', glyph: semantic[type as keyof typeof semantic] } as const;
  }

  const words = providerName(type).match(/[\p{L}\p{N}]+/gu) ?? [];
  const initials = words.slice(0, monogramLength).map((word) => Array.from(word.toUpperCase())[0]).join('');
  const hash = Array.from(type).reduce((sum, char) => sum + char.codePointAt(0)!, 0);
  return { kind: 'monogram', initials: initials || '?', color: monogramTints[hash % monogramTints.length]! } as const;
}
