import { describe, expect, it } from 'vitest';
import { providerName } from '@shared/providers';
import type { RemoteSummary } from '@shared/types';
import { resolveProviderIcon, scopeSvgIds } from './providerIcons';
import { storageProvider } from './remotes';

const assets = import.meta.glob<string>('../assets/providers/*.svg', { eager: true, query: '?raw', import: 'default' });

describe('bundled provider icons', () => {
  it.each(Object.entries(assets))('loads %s as a self-contained SVG', (path, svg) => {
    const root = /^<svg\b([^>]+)>[\s\S]+<\/svg>\s*$/.exec(svg)?.[1] ?? '';
    const viewBox = /\bviewBox="([^"]+)"/.exec(root)?.[1]?.trim().split(/\s+/).map(Number) ?? [];
    expect(viewBox).toHaveLength(4);
    expect(viewBox.every(Number.isFinite)).toBe(true);
    expect(viewBox[2]).toBeGreaterThan(0);
    expect(viewBox[3]).toBeGreaterThan(0);
    expect(root).not.toMatch(/\s(?:width|height)\s*=/i);
    expect(svg).not.toMatch(/<(?:script|foreignObject|iframe|image|style|link|animate\w*)\b|\s(?:on\w+|style)\s*=/i);
    expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', '')).not.toMatch(/https?:|javascript:|data:|\/\/|<!/i);

    const ids = Array.from(svg.matchAll(/\sid=["']([^"']+)["']/g), ([, id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, href, paint] of svg.matchAll(/\bhref\s*=\s*["']([^"']+)["']|url\(([^)]+)\)/gi)) {
      expect(href ?? paint).toMatch(/^#/);
      expect(ids).toContain((href ?? paint)?.slice(1));
    }
    const scoped = scopeSvgIds(svg, 'test');
    expect(resolveProviderIcon(path.slice(path.lastIndexOf('/') + 1, -'.svg'.length), 'test')).toMatchObject({ kind: 'brand', svg: scoped });
  });

  it('scopes definitions and fragment references per instance', () => {
    const svg = `<svg viewBox="0 0 16 16"><linearGradient id="paint"/><clipPath id='cut'/>
      <path id="shape" d="M0 0h1v1" fill="url(#paint)" clip-path="url('#cut')"/>
      <use href="#shape"/><use xlink:href='#shape'/></svg>`;
    for (const id of ['a', 'b']) {
      const scoped = scopeSvgIds(svg, id);
      expect(scoped).toContain(`id="provider-${id}-paint"`);
      expect(scoped).toContain(`id='provider-${id}-cut'`);
      expect(scoped).toContain(`id="provider-${id}-shape"`);
      expect(scoped).toContain(`url(#provider-${id}-paint)`);
      expect(scoped).toContain(`url('#provider-${id}-cut')`);
      expect(scoped).toContain(`href="#provider-${id}-shape"`);
      expect(scoped).toContain(`xlink:href='#provider-${id}-shape'`);
      expect(scoped).not.toContain(`provider-${id === 'a' ? 'b' : 'a'}-`);
    }
  });

  it.each([
    'drive', 's3', 'b2', 'onedrive', 'dropbox', 'box', 'pcloud', 'mega',
    'google photos', 'google cloud storage', 'googlephotos', 'googlecloudstorage', 'azureblob', 'azurefiles', 'tardigrade',
  ])('resolves %s to a brand mark', (type) => {
    expect(resolveProviderIcon(type, 'test')).toMatchObject({ kind: 'brand', svg: expect.stringContaining('<svg') });
  });

  it.each([
    'crypt', 'local', 'sftp', 'ftp', 'smb', 'webdav', 'http', 'memory',
    'alias', 'cache', 'chunker', 'combine', 'compress', 'archive', 'hasher', 'union',
  ])('resolves %s to a semantic icon', (type) => {
    expect(resolveProviderIcon(type, 'test')).toMatchObject({ kind: 'semantic', glyph: expect.stringMatching(/^[A-Z]/) });
  });

  it('uses a stable monogram for unmatched providers', () => {
    const icon = resolveProviderIcon('future provider', 'a');
    expect(icon).toMatchObject({ kind: 'monogram', initials: 'FP' });
    expect(resolveProviderIcon('future provider', 'b')).toEqual(icon);
    expect(resolveProviderIcon('constructor', 'test')).toMatchObject({ kind: 'monogram', initials: 'C' });
    expect(resolveProviderIcon('', 'test')).toMatchObject({ kind: 'monogram', initials: '?' });
    expect(providerName('google cloud storage')).toBe('Google Cloud Storage');
  });
});

const remote = (name: string, type: string, targetRemote: string | null = null, targetPath: string | null = null): RemoteSummary => ({
  name, type, isCrypt: type === 'crypt', targetRemote, targetPath,
  filenameEncryption: null, directoryNameEncryption: null, config: {},
});

describe('storage provider', () => {
  it('resolves a configured target by remote name and follows nested vaults', () => {
    const drive = remote('photos', 'drive');
    const vault = remote('vault', 'crypt', drive.name);
    expect(storageProvider(drive, [])).toBe('drive');
    expect(storageProvider(vault, [drive])).toBe('drive');
    expect(storageProvider(remote('outer', 'crypt', vault.name), [vault, drive])).toBe('drive');
  });

  it('handles local targets, inline backends, missing targets and cycles', () => {
    expect(storageProvider(remote('local-vault', 'crypt', null, '/vault'), [])).toBe('local');
    expect(storageProvider(remote('inline', 'crypt', ':s3'), [])).toBe('s3');
    expect(storageProvider(remote('missing', 'crypt', 'missing-target'), [])).toBe('unknown');
    const cycle = remote('cycle', 'crypt', 'cycle');
    expect(storageProvider(cycle, [cycle])).toBe('unknown');
  });
});
