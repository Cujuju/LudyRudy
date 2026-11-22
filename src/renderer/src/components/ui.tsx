import type { JSX } from 'solid-js';
import type { DaemonStatus } from '@shared/types';

export function PageHeader(props: { title: string; children?: JSX.Element }) {
  return <header class="page-header"><h1>{props.title}</h1>{props.children}</header>;
}

export function Empty(props: { children: JSX.Element }) {
  return <p class="empty">{props.children}</p>;
}

export function StatusDot(props: { state: DaemonStatus['state'] }) {
  return <span class="status-dot" data-state={props.state} aria-hidden="true" />;
}

export function Metric(props: { label: string; children: JSX.Element }) {
  return <div class="card metric"><dt>{props.label}</dt><dd>{props.children}</dd></div>;
}
