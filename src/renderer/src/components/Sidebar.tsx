import { For, Show } from 'solid-js';
import { ArrowLeftRight, ChevronLeft, ChevronRight, Cloud, FolderOpen, HardDrive, LayoutDashboard, ScrollText, Settings } from 'lucide-solid';
import type { BuildInfo } from '@shared/buildInfo';
import type { DaemonStatus, PrereqStatus } from '@shared/types';
import { shortModifier } from '../lib/platform';

const NAVIGATION = [
  { group: 'Storage', items: [
    { label: 'Dashboard', icon: LayoutDashboard },
    { label: 'Remotes', icon: Cloud },
    { label: 'Mounts', icon: HardDrive },
    { label: 'Browser', icon: FolderOpen },
    { label: 'Transfers', icon: ArrowLeftRight },
  ] },
  { group: 'System', items: [
    { label: 'Logs', icon: ScrollText },
    { label: 'Settings', icon: Settings },
  ] },
] as const;

type NavItem = typeof NAVIGATION[number]['items'][number];
export type Page = NavItem['label'];

const NAV_ICON_SIZE = 15;
const TOGGLE_ICON_SIZE = 12;

export function Sidebar(props: {
  page: Page; collapsed: boolean; daemon?: DaemonStatus; prereqs?: PrereqStatus; build?: BuildInfo; mounts: number; jobs: number;
  navigate: (page: Page) => void; openAbout: () => void; toggle: () => void;
}) {
  const count = (page: Page) => page === 'Mounts' ? props.mounts : page === 'Transfers' ? props.jobs : 0;
  const toggleLabel = () => `${props.collapsed ? 'Expand' : 'Collapse'} sidebar (${shortModifier}B)`;
  const rcloneStatus = () => {
    const daemon = props.daemon;
    if (!daemon) return '—';
    if (daemon.state === 'running') return `${daemon.mode} · running`;
    return daemon.mode === 'managed' && props.prereqs?.rcloneInstalled === false ? 'not installed' : daemon.state;
  };

  return (
    <nav class="sidebar" classList={{ collapsed: props.collapsed }} aria-label="Main navigation">
      <For each={NAVIGATION}>{(group, index) => (
        <>
          <Show when={index() > 0}><div class="sidebar-divider" role="separator" /></Show>
          <Show when={!props.collapsed}><div class="sidebar-group">{group.group}</div></Show>
          <For each={group.items as readonly NavItem[]}>{(item) => (
            <button type="button" class="nav-btn" aria-label={item.label}
              title={props.collapsed ? `${item.label}${count(item.label) ? ` (${count(item.label)} active)` : ''}` : undefined}
              aria-current={props.page === item.label ? 'page' : undefined} onClick={() => props.navigate(item.label)} onDblClick={() => props.toggle()}>
              <item.icon size={NAV_ICON_SIZE} aria-hidden="true" />
              <Show when={!props.collapsed}><span>{item.label}</span></Show>
              <Show when={count(item.label)}><span class="nav-count" aria-label={`${count(item.label)} active`}>{count(item.label)}</span></Show>
            </button>
          )}</For>
        </>
      )}</For>
      <Show when={!props.collapsed}>
        <button type="button" class="build-card" onClick={() => props.openAbout()}>
          <span class="build-row">
            <span class="build-title">LudyRudy<span class="build-version">{props.build?.version ?? '—'}</span></span>
            <span class="build-sub">
              {props.build?.build ? `build ${props.build.build}` : 'unstamped build'}
              <Show when={props.build?.modified}><span class="build-modified"> · modified</span></Show>
            </span>
          </span>
          <span class="build-row">
            <span class="build-title">rclone<span class="build-version">{(props.daemon?.version ?? props.prereqs?.rcloneVersion)?.replace(/^v/, '') ?? '—'}</span></span>
            <span class="build-sub">{rcloneStatus()}</span>
          </span>
        </button>
      </Show>
      <button type="button" class="sidebar-toggle" title={toggleLabel()} aria-label={toggleLabel()}
        aria-expanded={!props.collapsed} onClick={() => props.toggle()}>
        {props.collapsed ? <ChevronRight size={TOGGLE_ICON_SIZE} /> : <ChevronLeft size={TOGGLE_ICON_SIZE} />}
      </button>
    </nav>
  );
}
