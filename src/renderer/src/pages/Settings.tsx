import { For, Match, Show, Switch } from 'solid-js';
import { NOTICE_DELIVERIES, NOTICE_POSITIONS, NOTICE_STYLES } from '@cujuju/electron-notices';
import type { AppSettings } from '@shared/settings';
import { DaemonSettings } from '../components/DaemonSettings';
import { ThemePicker } from '../components/ThemePicker';
import { UpdateSettings } from '../components/UpdateSettings';
import { Feedback, PageHeader, SectionHeader, Select, sentenceCase, Toggle } from '../components/ui';
import { useAction } from '../lib/actions';
import { trayName } from '../lib/platform';
import { SETTINGS_SECTIONS, type PageProps } from '../store';

const WINDOW_OPTIONS = [
  { key: 'launchAtLogin', label: 'Launch at login' },
  { key: 'startMinimized', label: 'Start minimized' },
  { key: 'closeToTray', label: `Close to ${trayName}` },
  { key: 'minimizeToTray', label: `Minimize to ${trayName}` },
] as const;
const DELIVERY_NAMES = { overlay: 'In-app overlay', system: 'System notification', both: 'Both' };
const DELIVERY_OPTIONS = NOTICE_DELIVERIES.map((value) => ({ value, label: DELIVERY_NAMES[value] }));
const STYLE_OPTIONS = NOTICE_STYLES.map((value) => ({ value, label: sentenceCase(value) }));
const POSITION_OPTIONS = NOTICE_POSITIONS.map((value) => ({ value, label: sentenceCase(value.replace('-', ' ')) }));

function General(props: PageProps) {
  const general = () => props.store.settings().general;
  return (
    <section class="panel">
      <SectionHeader title="Window behavior" />
      <div class="settings-body">
        <For each={WINDOW_OPTIONS}>{(item) => (
          <Toggle label={item.label} checked={general()[item.key]} onChange={(value) => void props.store.updateGeneral({ [item.key]: value })} />
        )}</For>
      </div>
    </section>
  );
}

function Appearance(props: PageProps) {
  const general = () => props.store.settings().general;
  return (
    <section class="panel">
      <SectionHeader title="Appearance" />
      <div class="settings-body"><ThemePicker value={general().theme} onChange={(theme) => void props.store.updateGeneral({ theme })} /></div>
    </section>
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
        <label class="setting-row">Delivery<Select label="Delivery" disabled={!supported || action.pending()} value={delivery()}
          options={DELIVERY_OPTIONS} onChange={(value) => change({ delivery: value })} /></label>
        <Show when={!supported}><p class="secondary">This desktop session supports system notifications.</p></Show>
        <Show when={delivery() !== 'system'}>
          <label class="setting-row">Overlay style<Select label="Overlay style" disabled={action.pending()} value={config().style}
            options={STYLE_OPTIONS} onChange={(value) => change({ style: value })} /></label>
          <label class="setting-row">Overlay position<Select label="Overlay position" disabled={action.pending()} value={config().position}
            options={POSITION_OPTIONS} onChange={(value) => change({ position: value })} /></label>
          <Show when={config().style === 'drip'}><Toggle label="Show drip handle" checked={config().dripLip} disabled={action.pending()}
            onChange={(dripLip) => change({ dripLip })} /></Show>
        </Show>
        <Toggle label="Daemon error alerts" checked={config().daemonErrors} disabled={action.pending()} onChange={(daemonErrors) => change({ daemonErrors })} />
        <footer class="settings-footer">
          <div class="actions"><button type="button" class="button" disabled={action.pending()}
            onClick={() => void action.run(window.api.noticePreview, 'Test notice requested.')}>Send test notice</button></div>
        </footer>
        <Feedback action={action} />
      </div>
    </section>
  );
}

export function Settings(props: PageProps) {
  const section = () => props.store.settingsSection();
  return (
    <div class="settings-stack">
      <PageHeader title="Settings" description="Set app preferences, daemon defaults, notifications, and updates." />
      <nav class="settings-nav" aria-label="Settings sections">
        <For each={SETTINGS_SECTIONS}>{(item) => <button type="button" aria-current={section() === item ? 'page' : undefined}
          onClick={() => props.store.setSettingsSection(item)}>{item}</button>}</For>
      </nav>
      <Switch>
        <Match when={section() === 'General'}><General store={props.store} navigate={props.navigate} /></Match>
        <Match when={section() === 'Appearance'}><Appearance store={props.store} navigate={props.navigate} /></Match>
        <Match when={section() === 'Daemon & Security'}><DaemonSettings store={props.store} /></Match>
        <Match when={section() === 'Notifications'}><Notifications store={props.store} navigate={props.navigate} /></Match>
        <Match when={section() === 'Updates'}><UpdateSettings store={props.store} /></Match>
        <Match when={section() === 'About'}>
          <section class="panel">
            <SectionHeader title="About LudyRudy" />
            <dl class="properties settings-body">
              <div><dt>Version</dt><dd class="path">{props.store.build()?.version}</dd></div>
              <div><dt>Build</dt><dd class="path">{props.store.build()?.build}{props.store.build()?.modified ? ' (modified)' : ''}</dd></div>
              <div><dt>rclone</dt><dd class="path">{props.store.snapshot()?.daemon.version ?? props.store.snapshot()?.prereqs.rcloneVersion ?? 'Unavailable'}</dd></div>
              <div><dt>Platform</dt><dd class="path">{window.api.platform} / {window.api.arch}</dd></div>
              <div><dt>License</dt><dd>MIT</dd></div>
            </dl>
          </section>
        </Match>
      </Switch>
    </div>
  );
}
