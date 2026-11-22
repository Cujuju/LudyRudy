import type { MountProfile, SyncJob } from '../../src/shared/types.ts';

export const DEMO_WINDOW = { width: 1280, height: 860 };
export const VAULT_MOUNT = process.platform === 'win32' ? 'V:\\' : '/tmp/ludy-demo/Vault';
const ARCHIVE_MOUNT = process.platform === 'win32' ? 'X:\\' : '/tmp/ludy-demo/Archive';

export const DEMO_MOUNTS: MountProfile[] = [
  { id: 'personal-vault', name: 'Personal Vault', remote: 'gdrive-vault', remotePath: '', mountPoint: VAULT_MOUNT,
    autoMount: true, vfsCacheMode: 'full', vfsCacheMaxSize: '10G', vfsCacheMaxAge: '24h', readOnly: false, extraFlags: [] },
  { id: 'archive-bucket', name: 'Archive Bucket', remote: 'b2-backups', remotePath: 'laptop-backups', mountPoint: ARCHIVE_MOUNT,
    autoMount: false, vfsCacheMode: 'writes', vfsCacheMaxSize: '4G', vfsCacheMaxAge: '12h', readOnly: true, extraFlags: [] },
];

export const DEMO_JOBS: SyncJob[] = [
  { id: 'photos-to-vault', name: 'Photos to Encrypted Vault', mode: 'copy', source: 'gdrive:Photos', destination: 'gdrive-vault:Archive',
    excludes: ['*.tmp', '.DS_Store'], dryRunDefault: true, enabled: true },
  { id: 'work-mirror', name: 'Work Mirror', mode: 'sync', source: 'gdrive:Documents', destination: 'b2-backups:laptop-backups/Work',
    excludes: ['*.tmp'], dryRunDefault: true, enabled: true },
];
