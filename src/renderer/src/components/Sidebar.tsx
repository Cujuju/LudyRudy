import { For, Show } from 'solid-js';
import { ArrowLeftRight, Cloud, FolderOpen, HardDrive, LayoutDashboard, PanelLeft, ScrollText, Settings } from 'lucide-solid';
import type { BuildInfo } from '@shared/buildInfo';
import type { DaemonStatus } from '@shared/types';
import { shortModifier } from '../lib/platform';
import { StatusDot } from './ui';

export const NAVIGATION = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Remotes', icon: Cloud },
  { label: 'Mounts', icon: HardDrive },
  { label: 'Browser', icon: FolderOpen },
  { label: 'Transfers', icon: ArrowLeftRight },
  { label: 'Logs', icon: ScrollText },
  { label: 'Settings', icon: Settings },
] as const;

export type Page = typeof NAVIGATION[number]['label'];

export function Sidebar(props: {
  page: Page; collapsed: boolean; daemon: DaemonStatus['state']; build?: BuildInfo;
  navigate: (page: Page) => void; toggle: () => void;
}) {
  return (
    <aside class="sidebar" classList={{ collapsed: props.collapsed }}>
      <div class="sidebar-top">
        <button type="button" class="icon-button" aria-label={props.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!props.collapsed} title={`Toggle sidebar (${shortModifier}B)`} onClick={() => props.toggle()}>
          <PanelLeft size={17} />
        </button>
      </div>
      <nav aria-label="Main navigation">
        <For each={NAVIGATION}>{(item) => (
          <button type="button" class="nav-btn" aria-label={item.label} title={props.collapsed ? item.label : undefined}
            aria-current={props.page === item.label ? 'page' : undefined} onClick={() => props.navigate(item.label)}>
            <item.icon size={17} aria-hidden="true" />
            <Show when={!props.collapsed}><span>{item.label}</span></Show>
          </button>
        )}</For>
      </nav>
      <footer class="sidebar-footer">
        <div class="daemon-indicator" title={`rclone ${props.daemon}`} aria-label={`rclone ${props.daemon}`}>
          <StatusDot state={props.daemon} />
          <Show when={!props.collapsed}><span>rclone {props.daemon}</span></Show>
        </div>
        <Show when={!props.collapsed && props.build}>{(build) => (
          <small class="build-badge" title={`Build ${build().build}${build().modified ? ' (modified)' : ''}`}>v{build().version}</small>
        )}</Show>
      </footer>
    </aside>
  );
}
