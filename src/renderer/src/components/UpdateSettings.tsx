import { createSignal, For, Match, onCleanup, Show, Switch, type JSX } from 'solid-js';
import { IS_DEV_BUILD } from '@shared/app';
import type { UpdateInstallMode } from '@shared/settings';
import { appLocale, minuteToClock, minuteToTime, timeToMinute } from '@shared/timeFormat';
import type { UpdateStatus } from '@shared/types';
import type { UpdateChannel } from '@shared/updateFeed';
import type { AppStore } from '../store';
import { SectionHeader } from './ui';

type Of<K extends UpdateStatus['state']> = Extract<UpdateStatus, { state: K }>;

const CHANNEL_OPTIONS: readonly { value: UpdateChannel; label: string; title: string }[] = [
  { value: 'stable', label: 'Stable', title: 'Releases promoted after testing' },
  { value: 'nightly', label: 'Nightly', title: 'A build of every pushed change' },
];

const INSTALL_OPTIONS: readonly { value: UpdateInstallMode; label: string; help: string }[] = [
  { value: 'off', label: 'Off', help: 'Download and install updates yourself, below.' },
  { value: 'now', label: 'Right away', help: 'Download when found, then restart and install. rclone restarts with the app.' },
  { value: 'scheduled', label: 'At a set time', help: 'Download when found, then restart and install at this time.' },
  { value: 'restart', label: 'Next restart', help: 'Download when found, then install the next time you quit or restart the app.' },
];

/** "0.41.3 (nightly)" for a prerelease. */
const named = (u: { version: string; nightly: boolean }) => `${u.version}${u.nightly ? ' (nightly)' : ''}`;

function UpdateRow(props: { label: string; help?: string; nested?: boolean; children: JSX.Element }) {
  return (
    <div class="setting-row update-row" classList={{ nested: props.nested }}>
      <div class="setting-row-copy">
        <div>{props.label}</div>
        <Show when={props.help}>{(help) => <p class="secondary setting-row-help">{help()}</p>}</Show>
      </div>
      <div class="actions setting-row-actions">{props.children}</div>
    </div>
  );
}

/** Settings → Updates: channel, automatic check and install, version, check, download and install. */
export function UpdateSettings(props: { store: AppStore }) {
  const [status, setStatus] = createSignal<UpdateStatus | null>(null);
  void window.api.updateStatus().then(setStatus);
  onCleanup(window.api.onUpdateStatus(setStatus));

  const when = <K extends UpdateStatus['state']>(k: K): Of<K> | undefined => {
    const s = status();
    return s?.state === k ? (s as Of<K>) : undefined;
  };
  const u = () => props.store.settings().updates;
  const installsWhen = () => ({ off: '', now: '', scheduled: ` It installs at ${minuteToClock(u().installMinute)}.`, restart: ' It installs when you quit.' })[u().autoInstall];
  const checkButton = () => <button type="button" class="button" onClick={() => void window.api.checkForUpdates()}>Check for updates</button>;

  return (
    <section class="panel">
      <SectionHeader title="Updates" />
      <div class="settings-body">
        <UpdateRow label="Channel" help="Nightly gets the latest changes; stable gets tested ones. Switching to stable never downgrades: you stay on this version until stable passes it.">
          <div class="segmented" role="radiogroup" aria-label="Update channel">
            <For each={CHANNEL_OPTIONS}>{(option) => (
              <button type="button" role="radio" aria-checked={u().channel === option.value} aria-pressed={u().channel === option.value}
                title={option.title} onClick={() => void props.store.updateUpdates({ channel: option.value })}>{option.label}</button>
            )}</For>
          </div>
        </UpdateRow>
        <UpdateRow label="Check automatically" help="Check after launch and every few hours, and notify when an update is found.">
          <input class="toggle" type="checkbox" role="switch" aria-label="Check automatically"
            checked={u().autoCheck} onChange={(e) => void props.store.updateUpdates({ autoCheck: e.currentTarget.checked })} />
        </UpdateRow>
        <UpdateRow label="Install automatically" help={INSTALL_OPTIONS.find((o) => o.value === u().autoInstall)?.help}>
          <div class="segmented" role="radiogroup" aria-label="Install automatically">
            <For each={INSTALL_OPTIONS}>{(option) => (
              <button type="button" role="radio" aria-checked={u().autoInstall === option.value} aria-pressed={u().autoInstall === option.value}
                onClick={() => void props.store.updateUpdates({ autoInstall: option.value })}>{option.label}</button>
            )}</For>
          </div>
        </UpdateRow>
        <Show when={u().autoInstall === 'scheduled'}>
          <UpdateRow label="Install at" help="Local time, on any day an update is waiting." nested>
            <input class="numeric" type="time" aria-label="Install at" value={minuteToTime(u().installMinute)}
              onChange={(e) => {
                const minute = timeToMinute(e.currentTarget.value);
                if (minute !== null) void props.store.updateUpdates({ installMinute: minute });
              }} />
          </UpdateRow>
        </Show>
        <UpdateRow label={`Version ${props.store.build()?.version ?? ''}`} help="Updates are verified against this app's signing key before they install.">
          <Switch fallback={
            <>
              <Show when={when('up-to-date')}>{(s) => <span class="secondary">Up to date · checked {new Date(s().checkedAt).toLocaleTimeString(appLocale())}</span>}</Show>
              {checkButton()}
            </>
          }>
            <Match when={when('unavailable')}>{(s) => <span class="secondary">{IS_DEV_BUILD ? "The dev build does not update; it runs the repo's code." : s().reason}</span>}</Match>
            <Match when={when('checking')}><span class="secondary">Checking…</span></Match>
            <Match when={when('error')}>{(e) => <><span class="update-error">{e().message}</span>{checkButton()}</>}</Match>
            <Match when={when('available')}>{(a) => <>
              <span>Version {named(a())} is available.</span>
              <button type="button" class="button primary" onClick={() => void window.api.downloadUpdate()}>Download</button>
            </>}</Match>
            <Match when={when('downloading')}>{(d) => <span class="secondary numeric">Downloading {named(d())}… {d().percent}%</span>}</Match>
            <Match when={when('ready')}>{(r) => <>
              <span>Version {named(r())} is downloaded and verified.{installsWhen()}</span>
              <button type="button" class="button primary" title="Stops rclone, installs the update and reopens the app" onClick={() => void window.api.installUpdate()}>
                Restart and install
              </button>
            </>}</Match>
          </Switch>
        </UpdateRow>
      </div>
    </section>
  );
}
