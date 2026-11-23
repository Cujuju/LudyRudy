/**
 * Signs and publishes updates:
 *   pnpm release keygen | nightly [--dry-run] | promote <version> [--dry-run]
 * Private key stays outside the repo: $LUDYRUDY_UPDATE_KEY or ~/.config/ludyrudy/update_key.
 */
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReleaseCli } from '@cujuju/electron-updates/node';
import { appVersion } from '../appVersion.ts';
import { APP_NAME } from '../src/shared/app.ts';
import { UPDATE_REPO, UPDATE_SIGNATURE_CONTEXT } from '../src/shared/updateFeed.ts';
import { assertReleaseSiblings, ensureNightlyRelease, installerFiles, RELEASE_ARCHS, releaseDetails, updateSource } from './releaseShared.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[2] === 'nightly') {
  assertReleaseSiblings();
  const git = (args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  git(['fetch', '--tags', 'origin']);
  if (git(['status', '--porcelain', '--untracked-files=no']) || !git(['branch', '-r', '--contains', 'HEAD'])) throw new Error('Release a clean, pushed commit.');
  ensureNightlyRelease(releaseDetails(), process.argv.includes('--dry-run'));
}

await runReleaseCli({
  appName: APP_NAME,
  repo: UPDATE_REPO,
  tagSourceCommit: true,
  signatureContext: UPDATE_SIGNATURE_CONTEXT,
  dist: path.join(ROOT, 'dist'),
  publicKeyFile: path.join(ROOT, 'resources', 'update-public-key.pem'),
  keyFile: process.env.LUDYRUDY_UPDATE_KEY || path.join(os.homedir(), '.config', 'ludyrudy', 'update_key'),
  version: () => appVersion(ROOT),
  archs: RELEASE_ARCHS,
  updateSource,
  // Mac DMG/ZIP files accompany local nightlies; CI attaches them after promotion.
  extraFiles: (platform, v) => (platform === 'darwin' && !process.env.LUDYRUDY_UPDATE_ONLY ? installerFiles(platform, v) : []),
});
