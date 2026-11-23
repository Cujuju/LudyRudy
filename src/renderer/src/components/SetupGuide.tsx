import { createMemo, Index, Show } from 'solid-js';
import { Check, ExternalLink } from 'lucide-solid';
import type { OnboardingAction, OnboardingStep } from '../lib/onboarding';
import { deriveOnboarding } from '../lib/onboarding';
import { useAction } from '../lib/actions';
import type { PageProps } from '../store';
import { Feedback, SectionHeader } from './ui';

export function SetupGuide(props: PageProps & { addRemote: () => void }) {
  const action = useAction();
  const model = createMemo(() => {
    const snapshot = props.store.snapshot();
    return snapshot ? deriveOnboarding(snapshot) : undefined;
  });
  const installUrl = () => props.store.snapshot()?.prereqs.mountBackend.installUrl ?? '';

  function trigger(kind: OnboardingAction): void {
    switch (kind) {
      case 'open-settings':
        props.navigate('Settings');
        break;
      case 'add-remote':
        props.addRemote();
        break;
      case 'install-mount-backend': {
        const url = installUrl();
        if (url) void action.run(() => window.api.openExternal(url));
        break;
      }
    }
  }

  function stepButtonClass(step: OnboardingStep): string {
    return step.state === 'current' || step.state === 'attention' ? 'button primary' : 'button';
  }

  return (
    <Show when={model()?.show}>
      <section class="panel setup-guide" aria-label="Get started with ludyRudy">
        <SectionHeader title="Get started with ludyRudy">
          <span class="secondary">Connect a remote to begin</span>
        </SectionHeader>
        <div class="setup-intro">
          <p class="secondary">
            ludyRudy runs a local rclone engine in the background to connect cloud accounts, encrypt vaults, and mount them as drives.
          </p>
        </div>
        <ol class="setup-steps">
          <Index each={model()!.steps}>{(step, index) => (
            <li class="setup-step" data-state={step().state}>
              <span class="setup-marker" aria-hidden="true">
                <Show when={step().state === 'done'} fallback={index + 1}><Check size={14} /></Show>
              </span>
              <div class="setup-copy">
                <strong>{step().title}</strong>
                <p class="secondary">{step().detail}</p>
              </div>
              <Show when={step().action}>{(cta) => (
                <button type="button" class={stepButtonClass(step())} disabled={action.pending()}
                  onClick={() => trigger(cta().kind)}>
                  {cta().label}
                  <Show when={cta().kind === 'install-mount-backend'}><ExternalLink size={13} /></Show>
                </button>
              )}</Show>
            </li>
          )}</Index>
        </ol>
        <Feedback action={action} />
      </section>
    </Show>
  );
}
