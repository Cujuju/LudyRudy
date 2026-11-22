import { ThemePicker } from '../components/ThemePicker';
import { PageHeader } from '../components/ui';
import { trayName } from '../lib/platform';
import type { PageProps } from '../store';

export function Settings(props: PageProps) {
  const general = () => props.store.settings().general;
  return (
    <>
      <PageHeader title="Settings" />
      <section class="card section">
        <h2>Appearance</h2>
        <ThemePicker value={general().theme} onChange={(theme) => void props.store.updateGeneral({ theme })} />
      </section>
      <section class="card section">
        <h2>Window behavior</h2>
        <label class="setting-row">Close to {trayName}
          <input type="checkbox" checked={general().closeToTray} onChange={(event) => void props.store.updateGeneral({ closeToTray: event.currentTarget.checked })} />
        </label>
        <label class="setting-row">Minimize to {trayName}
          <input type="checkbox" checked={general().minimizeToTray} onChange={(event) => void props.store.updateGeneral({ minimizeToTray: event.currentTarget.checked })} />
        </label>
      </section>
      <section class="card section">
        <h2>Daemon</h2>
        <dl class="properties">
          <dt>Endpoint</dt><dd>{props.store.snapshot()?.daemon.endpoint ?? '—'}</dd>
          <dt>Binary source</dt><dd>{props.store.snapshot()?.daemon.binarySource ?? '—'}</dd>
          <dt>Process ID</dt><dd>{props.store.snapshot()?.daemon.pid ?? '—'}</dd>
        </dl>
      </section>
    </>
  );
}
