import type { AppSnapshot } from '@shared/ipc';
import type { DaemonStatus } from '@shared/types';

export type OnboardingStepId = 'engine' | 'remote' | 'use';
export type OnboardingStepState = 'done' | 'current' | 'upcoming' | 'attention';
export type OnboardingAction = 'open-settings' | 'add-remote' | 'new-mount' | 'install-mount-backend' | 'open-browser';

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  detail: string;
  state: OnboardingStepState;
  action?: { kind: OnboardingAction; label: string };
}

export interface OnboardingModel {
  show: boolean;
  canDismiss: boolean;
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

function remoteStep(daemon: DaemonStatus, remoteCount: number): OnboardingStep {
  const step = { id: 'remote', title: 'Connect a cloud remote' } as const;
  if (remoteCount > 0) {
    return { ...step, state: 'done', detail: `${remoteCount} ${remoteCount === 1 ? 'remote' : 'remotes'} configured.` };
  }
  if (daemon.state === 'running') {
    return {
      ...step, state: 'current',
      detail: 'Link Google Drive, S3, Dropbox, SFTP, or any rclone storage provider.',
      action: { kind: 'add-remote', label: 'Add remote' },
    };
  }
  return { ...step, state: 'upcoming', detail: 'Start the rclone engine first, then connect a cloud storage provider.' };
}

function useStep(snapshot: AppSnapshot, hasRemotes: boolean): OnboardingStep {
  const step = { id: 'use', title: 'Mount a drive or browse files' } as const;
  const backend = snapshot.prereqs.mountBackend;
  const canMount = snapshot.daemon.attached || backend.available;
  if (!hasRemotes) {
    if (!canMount && backend.installUrl) {
      return {
        ...step, state: 'upcoming',
        detail: `Browse files or wrap a remote with encryption anytime. Install ${backend.name} to mount remotes as local drives.`,
        action: { kind: 'install-mount-backend', label: `Install ${backend.name}` },
      };
    }
    return {
      ...step, state: 'upcoming',
      detail: 'After adding a remote, wrap it with client-side encryption, browse files, or mount it as a local drive.',
    };
  }
  if (canMount) {
    return {
      ...step, state: 'current',
      detail: 'Create a mount profile to access your remote as a local drive, or open the file browser.',
      action: { kind: 'new-mount', label: 'New mount' },
    };
  }
  if (backend.installUrl) {
    return {
      ...step, state: 'current',
      detail: `Install ${backend.name} to mount your remote as a local drive, or browse files directly.`,
      action: { kind: 'install-mount-backend', label: `Install ${backend.name}` },
    };
  }
  return {
    ...step, state: 'current',
    detail: 'Open the file browser to work with files on your connected remote.',
    action: { kind: 'open-browser', label: 'Open browser' },
  };
}

export function deriveOnboarding(snapshot: AppSnapshot, mountProfileCount = 0): OnboardingModel {
  const { daemon } = snapshot;
  const hasRemotes = snapshot.remotes.length > 0;
  const hasMounts = mountProfileCount > 0 || snapshot.mounts.length > 0;
  const missingManagedBinary = daemon.mode === 'managed' && daemon.binarySource === 'missing' && !hasRemotes;
  const needsSetup = daemon.state === 'running' && (!hasRemotes || !hasMounts);
  const show = !snapshot.dataError && (needsSetup || missingManagedBinary);
  if (!show) return { show: false, canDismiss: false, steps: [] };
  return {
    show: true,
    canDismiss: hasRemotes,
    steps: [engineStep(daemon), remoteStep(daemon, snapshot.remotes.length), useStep(snapshot, hasRemotes)],
  };
}
