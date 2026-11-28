import { createSignal, Show } from 'solid-js';
import type { PendingRemoteConfig, RemoteConfigResult } from '@shared/types';
import { useAction } from '../lib/actions';
import { Feedback } from './ui';

const QUESTIONS: Record<PendingRemoteConfig['question'], { question: string; button: string }> = {
  'shared-client': { question: 'Use the shared OAuth client? To use a custom client, edit the remote’s client settings.', button: 'Use shared client' },
  'refresh-token': { question: 'rclone found an authorization token for this remote.', button: 'Keep current authorization' },
  'shared-drive': { question: 'To configure a Google Shared Drive, use the advanced remote settings or rclone.', button: 'Skip shared drive' },
};

export function useRemoteConfiguration(done: () => void) {
  const action = useAction();
  const [configuration, setConfiguration] = createSignal<Exclude<RemoteConfigResult, { state: 'complete' }>>();

  async function save(write: () => Promise<RemoteConfigResult>) {
    await action.run(async () => {
      const result = await write();
      if (result.state === 'complete') done();
      else setConfiguration(result);
    });
  }

  return { action, configuration, setConfiguration, save };
}

export function RemoteConfigStep(props: {
  configuration: Exclude<RemoteConfigResult, { state: 'complete' }>;
  action: ReturnType<typeof useAction>;
  save: (write: () => Promise<RemoteConfigResult>) => Promise<void>;
  close: () => void;
  edit?: () => void;
}) {
  const pending = () => props.configuration.state === 'pending' ? props.configuration : undefined;
  const question = () => { const step = pending(); return step && QUESTIONS[step.question]; };
  const answer = () => {
    const step = pending();
    if (step) void props.save(() => window.api.continueRemoteConfig(step.id, step.question === 'shared-client'));
  };
  return (
    <div class="form-stack">
      <Show when={props.configuration.state === 'incomplete' && props.configuration.message}>{(message) => (
        <p class="banner error" role="alert">{message()}</p>
      )}</Show>
      <Show when={question()}>{(item) => (
        <p class="banner" role="status">{item().question}</p>
      )}</Show>
      <Feedback action={props.action} />
      <div class="form-actions">
        <button type="button" class="button" disabled={props.action.pending()} onClick={() => props.close()}>Close</button>
        <Show when={props.edit}>
          <button type="button" class="button" disabled={props.action.pending()} onClick={() => props.edit?.()}>Edit settings</button>
        </Show>
        <Show when={question()}>{(item) => (
          <button type="button" class="button primary" disabled={props.action.pending()} onClick={answer}>{item().button}</button>
        )}</Show>
      </div>
    </div>
  );
}
