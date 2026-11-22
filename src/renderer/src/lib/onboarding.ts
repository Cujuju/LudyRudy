import type { AppSnapshot } from '@shared/ipc';
import type { DaemonStatus } from '@shared/types';

export type OnboardingStepId = 'engine' | 'remote' | 'use';
export type OnboardingStepState = 'done' | 'current' | 'upcoming' | 'attention';
export type OnboardingAction = 'open-settings' | 'add-remote' | 'install-mount-backend';

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  detail: string;
  state: OnboardingStepState;
  action?: { kind: OnboardingAction; label: string };
}

export interface OnboardingModel {
  show: boolean;
  steps: OnboardingStep[];
}

export function daemonSourceLabel(daemon: DaemonStatus): string {
  const version = daemon.version ? ` ${daemon.version}` : '';
  if (daemon.mode === 'attached') return `External rclone daemon${version}`;
  switch (daemon.binarySource) {
    case 'bundled': return `Bundled rclone${version}`;
    case 'path': return `System rclone (PATH)${version}`;
    case 'override': return `Custom rclone${version}`;
    case 'missing': return 'rclone binary missing';
  }
}

function engineStep(daemon: DaemonStatus): OnboardingStep {
  const step = { id: 'engine', title: 'rclone engine' } as const;
  if (daemon.state === 'running') {
    return { ...step, state: 'done', detail: `${daemonSourceLabel(daemon)} is running in the background.` };
  }
  return {
    ...step, state: 'attention',
    detail: 'No rclone binary was found. Choose an rclone executable in Settings.',
    action: { kind: 'open-settings', label: 'Open settings' },
  };
}

function remoteStep(daemon: DaemonStatus): OnboardingStep {
  const step = { id: 'remote', title: 'Connect a cloud remote' } as const;
  if (daemon.state === 'running') {
    return {
      ...step, state: 'current',
      detail: 'Link Google Drive, S3, Dropbox, SFTP, or any rclone storage provider.',
      action: { kind: 'add-remote', label: 'Add remote' },
    };
  }
  return { ...step, state: 'upcoming', detail: 'Start the rclone engine first, then connect a cloud storage provider.' };
}

function useStep(snapshot: AppSnapshot): OnboardingStep {
  const step = { id: 'use', title: 'Mount a drive or browse files', state: 'upcoming' } as const;
  const backend = snapshot.prereqs.mountBackend;
  if (!snapshot.daemon.attached && !backend.available && backend.installUrl) {
    return {
      ...step,
      detail: `Browse files or wrap a remote with encryption anytime. Install ${backend.name} to mount remotes as local drives.`,
      action: { kind: 'install-mount-backend', label: `Install ${backend.name}` },
    };
  }
  return {
    ...step,
    detail: 'After adding a remote, wrap it with client-side encryption, browse files, or mount it as a local drive.',
  };
}

export function deriveOnboarding(snapshot: AppSnapshot): OnboardingModel {
  const { daemon } = snapshot;
  const show = snapshot.remotes.length === 0 && !snapshot.dataError
    && (daemon.state === 'running' || (daemon.mode === 'managed' && daemon.binarySource === 'missing'));
  if (!show) return { show: false, steps: [] };
  return {
    show: true,
    steps: [engineStep(daemon), remoteStep(daemon), useStep(snapshot)],
  };
}
