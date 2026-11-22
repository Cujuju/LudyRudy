import { createUniqueId, For, Show, untrack } from 'solid-js';
import { createStore } from 'solid-js/store';
import { FolderOpen } from 'lucide-solid';
import type { SyncJob } from '@shared/types';
import { useAction } from '../lib/actions';
import { Drawer, Feedback, FormActions, Segmented, sentenceCase, Toggle } from './ui';

const JOB_MODES = ['copy', 'sync'] as const;
const JOB_PATHS = ['source', 'destination'] as const;
type JobDraft = Parameters<typeof window.api.saveJob>[0];

export function JobDrawer(props: { job?: SyncJob; attached: boolean; close: () => void }) {
  const [draft, setDraft] = createStore<JobDraft>(untrack(() => props.job ? { ...props.job } : {
    name: '', source: '', destination: '', excludes: [], mode: 'copy', enabled: true, dryRunDefault: true,
  }));
  const action = useAction();
  const picker = useAction();
  const pathId = createUniqueId();

  function choose(field: 'source' | 'destination') {
    void picker.run(async () => {
      const folder = await window.api.pickDirectory();
      if (folder) setDraft(field, folder);
    });
  }

  async function save() {
    if (await action.run(() => untrack(() => window.api.saveJob({
      ...draft, name: draft.name.trim(), excludes: draft.excludes.map((line) => line.trim()).filter(Boolean),
    })))) props.close();
  }

  return (
    <Drawer title={props.job ? 'Edit job' : 'New job'} description="Copy or mirror files between folders and remotes." busy={action.pending()} close={props.close}>
      <form class="form-stack" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset disabled={action.pending()}>
          <label class="field">Job name<input required value={draft.name} onInput={(event) => setDraft('name', event.currentTarget.value)} /></label>
          <div class="field">Job type
            <Segmented label="Job type" options={JOB_MODES} value={draft.mode} onChange={(value) => setDraft('mode', value)} />
            <p class="secondary">{draft.mode === 'sync' ? 'Sync can remove files from the destination to match the source.' : 'Copy keeps files that already exist only at the destination.'}</p>
          </div>
          <Show when={props.attached}><p class="secondary">Absolute paths refer to the computer running the attached daemon.</p></Show>
          <For each={JOB_PATHS}>{(field) => {
            const id = `${pathId}-${field}`;
            return (
              <div class="field">
                <label for={id}>{sentenceCase(field)}</label>
                <div class="input-group">
                  <input id={id} class="path" placeholder="remote:folder or absolute path" required value={draft[field]}
                    onInput={(event) => setDraft(field, event.currentTarget.value)} />
                  <button type="button" class="button input-addon" aria-label={`Choose ${field} folder`}
                    disabled={props.attached || picker.pending()} onClick={() => choose(field)}><FolderOpen size={14} aria-hidden="true" /> Browse</button>
                </div>
              </div>
            );
          }}</For>
          <label class="field">Exclude patterns<textarea placeholder="One rclone pattern per line" value={draft.excludes.join('\n')}
            onInput={(event) => setDraft('excludes', event.currentTarget.value.split('\n'))} /></label>
          <Toggle label="Enabled" checked={draft.enabled} onChange={(value) => setDraft('enabled', value)} />
          <Toggle label="Dry run by default" checked={draft.dryRunDefault} onChange={(value) => setDraft('dryRunDefault', value)} />
        </fieldset>
        <Feedback action={picker} />
        <Feedback action={action} />
        <FormActions label="Save job" close={props.close} busy={action.pending()} disabled={picker.pending()} />
      </form>
    </Drawer>
  );
}
