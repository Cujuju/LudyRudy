import { execFileSync, spawnSync } from 'node:child_process';
import { MODIFIED_SUFFIX } from './src/shared/buildInfo.ts';

/** Pre-1.0: breaking changes bump minor, like any feature. */
const MAJOR = 0;
/** Conventional-commit feature subject, scoped or not; `feat!:` counts. */
const FEATURE_SUBJECT = /^feat(\([^)]*\))?!?:/;

function git(repoDir: string, args: string[], input?: string): string {
  // Output grows with history; no cap.
  return execFileSync('git', args, { cwd: repoDir, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: Infinity }).trim();
}

function hasHead(repoDir: string): boolean {
  const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: repoDir, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(result.stderr.trim() || 'Unable to resolve git HEAD.');
}

/**
 * `0.<feat commits>.<non-feat commits not reachable from any feat>`, merges excluded.
 * Every new commit raises it; a shallow clone undercounts.
 */
export function appVersion(repoDir: string, ref = 'HEAD'): string {
  if (ref === 'HEAD' && !hasHead(repoDir)) return '0.0.0';
  const log = git(repoDir, ['log', '--no-merges', '--format=%H %s', ref]);
  const features = log
    .split('\n')
    .map((line) => ({ hash: line.slice(0, line.indexOf(' ')), subject: line.slice(line.indexOf(' ') + 1) }))
    .filter((c) => FEATURE_SUBJECT.test(c.subject));
  const revs = [ref, ...features.map((c) => `^${c.hash}`)].join('\n');
  const patches = git(repoDir, ['rev-list', '--no-merges', '--count', '--stdin'], `${revs}\n`);
  return `${MAJOR}.${features.length}.${patches}`;
}

/**
 * Build ID of the checkout at `repoDir`: its short commit hash, plus MODIFIED_SUFFIX when the working
 * tree has uncommitted or untracked changes, since a build compiles those too.
 */
export function gitBuild(repoDir: string): string {
  if (!hasHead(repoDir)) return 'dev';
  const hash = git(repoDir, ['rev-parse', '--short', 'HEAD']);
  return git(repoDir, ['status', '--porcelain']) ? `${hash}${MODIFIED_SUFFIX}` : hash;
}
