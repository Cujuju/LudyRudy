import { createMemo, createUniqueId, Match, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  Archive, ArrowLeftRight, Cpu, Database, FileArchive, FolderTree, GitMerge, Globe, HardDrive, Hash,
  Layers, Link2, LockKeyhole, Network, Terminal,
} from 'lucide-solid';
import { providerName } from '@shared/providers';
import { resolveProviderIcon } from '../lib/providerIcons';
import '../styles/provider-icon.css';

const glyphs = {
  Archive, ArrowLeftRight, Cpu, Database, FileArchive, FolderTree, GitMerge, Globe, HardDrive, Hash,
  Layers, Link2, LockKeyhole, Network, Terminal,
};

export function ProviderIcon(props: { type: string; size?: 'sm' | 'md' | 'lg' }) {
  const id = createUniqueId();
  const icon = createMemo(() => resolveProviderIcon(props.type, id));
  const brand = () => { const value = icon(); return value.kind === 'brand' ? value : undefined; };
  const semantic = () => { const value = icon(); return value.kind === 'semantic' ? value : undefined; };
  const monogram = () => { const value = icon(); return value.kind === 'monogram' ? value : undefined; };

  return (
    <span class="provider-icon" data-size={props.size ?? 'md'} data-kind={icon().kind}
      classList={{ 'provider-icon-crypt': props.type === 'crypt' }}
      title={providerName(props.type)} aria-hidden="true"
      style={{ '--provider-icon-color': brand()?.color ?? monogram()?.color }}>
      <Switch>
        <Match when={brand()}>{(logo) => (
          /* oxlint-disable-next-line solid/no-innerhtml */
          <span class="provider-icon-brand" innerHTML={logo().svg} />
        )}</Match>
        <Match when={semantic()}>{(icon) => <Dynamic component={glyphs[icon().glyph]} />}</Match>
        <Match when={monogram()}>{(tile) => tile().initials}</Match>
      </Switch>
    </span>
  );
}
