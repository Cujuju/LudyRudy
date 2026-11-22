import { createSignal, For, Match, Show, Switch } from 'solid-js';
import { NOTICE_DELIVERIES, NOTICE_POSITIONS, NOTICE_STYLES } from '@cujuju/electron-notices';
import type { AppSettings } from '@shared/settings';
import { DaemonSettings } from '../components/DaemonSettings';
import { ThemePicker } from '../components/ThemePicker';
import { Feedback, PageHeader, SectionHeader, sentenceCase, Toggle } from '../components/ui';
import { useAction } from '../lib/actions';
import { trayName } from '../lib/platform';
import type { PageProps } from '../store';

const SECTIONS = ['General', 'Daemon & Security', 'Notifications', 'About'] as const;
const WINDOW_OPTIONS = [
  { key: 'launchAtLogin', label: 'Launch at login' },
  { key: 'startMinimized', label: 'Start minimized' },
  { key: 'closeToTray', label: `Close to ${trayName}` },
  { key: 'minimizeToTray', label: `Minimize to ${trayName}` },
] as const;
const DELIVERY_NAMES = { overlay: 'In-app overlay', system: 'System notification', both: 'Both' };

function General(props: PageProps) {
  const general = () => props.store.settings().general;
  return (
    <>
      <section class="panel">
        <SectionHeader title="Appearance" />
        <div class="settings-body"><ThemePicker value={general().theme} onChange={(theme) => void props.store.updateGeneral({ theme })} /></div>
      </section>
      <section class="panel">
        <SectionHeader title="Window behavior" />
        <div class="settings-body">
          <For each={WINDOW_OPTIONS}>{(item) => (
            <Toggle label={item.label} checked={general()[item.key]} onChange={(value) => void props.store.updateGeneral({ [item.key]: value })} />
          )}</For>
        </div>
      </section>
    </>
  );
}

function Notifications(props: PageProps) {
  const config = () => props.store.settings().notifications;
  const supported = window.api.noticeOverlaySupported;
  const delivery = () => supported ? config().delivery : 'system';
  const action = useAction();
  const change = (patch: Partial<AppSettings['notifications']>) => void action.run(() => window.api.updateNotifications(patch));
  return (
    <section class="panel">
      <SectionHeader title="Notifications" />
      <div class="settings-body">
        <label class="setting-row">Delivery<select disabled={!supported || action.pending()} value={delivery()} onChange={(event) => {
          const value = NOTICE_DELIVERIES.find((item) => item === event.currentTarget.value);
          if (value) change({ delivery: value });
        }}>
          <For each={NOTICE_DELIVERIES}>{(item) => <option value={item}>{DELIVERY_NAMES[item]}</option>}</For>
        </select></label>
        <Show when={!supported}><p class="secondary">This desktop session supports system notifications.</p></Show>
        <Show when={delivery() !== 'system'}>
          <label class="setting-row">Overlay style<select disabled={action.pending()} value={config().style} onChange={(event) => {
            const value = NOTICE_STYLES.find((item) => item === event.currentTarget.value);
            if (value) change({ style: value });
          }}>
            <For each={NOTICE_STYLES}>{(item) => <option value={item}>{sentenceCase(item)}</option>}</For>
          </select></label>
          <label class="setting-row">Overlay position<select disabled={action.pending()} value={config().position} onChange={(event) => {
            const value = NOTICE_POSITIONS.find((item) => item === event.currentTarget.value);
            if (value) change({ position: value });
          }}>
            <For each={NOTICE_POSITIONS}>{(item) => <option value={item}>{sentenceCase(item.replace('-', ' '))}</option>}</For>
          </select></label>
          <Show when={config().style === 'drip'}><Toggle label="Show drip handle" checked={config().dripLip} disabled={action.pending()}
            onChange={(dripLip) => change({ dripLip })} /></Show>
        </Show>
        <Toggle label="Daemon error alerts" checked={config().daemonErrors} disabled={action.pending()} onChange={(daemonErrors) => change({ daemonErrors })} />
        <button type="button" class="button" disabled={action.pending()} onClick={() => void action.run(window.api.noticePreview, 'Test notice requested.')}>Send test notice</button>
        <Feedback action={action} />
      </div>
    </section>
  );
}

export function Settings(props: PageProps) {
  const [section, setSection] = createSignal<typeof SECTIONS[number]>('General');
  return (
    <>
      <PageHeader title="Settings" description="Set app preferences, daemon defaults, and notifications." />
      <nav class="settings-nav" aria-label="Settings sections">
        <For each={SECTIONS}>{(item) => <button type="button" class="button quiet" aria-current={section() === item ? 'page' : undefined}
          onClick={() => setSection(item)}>{item}</button>}</For>
      </nav>
      <Switch>
        <Match when={section() === 'General'}><General store={props.store} navigate={props.navigate} /></Match>
        <Match when={section() === 'Daemon & Security'}><DaemonSettings store={props.store} /></Match>
        <Match when={section() === 'Notifications'}><Notifications store={props.store} navigate={props.navigate} /></Match>
        <Match when={section() === 'About'}>
          <section class="panel">
            <SectionHeader title="About ludyRudy" />
            <dl class="properties settings-body">
              <dt>Version</dt><dd>{props.store.build()?.version}</dd>
              <dt>Build</dt><dd>{props.store.build()?.build}{props.store.build()?.modified ? ' (modified)' : ''}</dd>
              <dt>rclone</dt><dd>{props.store.snapshot()?.daemon.version ?? props.store.snapshot()?.prereqs.rcloneVersion ?? 'Unavailable'}</dd>
              <dt>Platform</dt><dd>{window.api.platform} / {window.api.arch}</dd>
              <dt>License</dt><dd>MIT</dd>
            </dl>
          </section>
        </Match>
      </Switch>
    </>
  );
}
