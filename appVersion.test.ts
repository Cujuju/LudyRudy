import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appVersion, gitBuild } from './appVersion';

let repo: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' }).trim();

beforeEach(() => {
  const cache = join(import.meta.dirname, 'node_modules', '.cache');
  mkdirSync(cache, { recursive: true });
  repo = mkdtempSync(join(cache, 'version-test-'));
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Version Test');
  git('config', 'user.email', 'version-test@example.test');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

const commit = (message: string) => git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', message);

describe('git-derived build identity', () => {
  it('handles an unborn repository', () => {
    expect(appVersion(repo)).toBe('0.0.0');
    expect(gitBuild(repo)).toBe('dev');
  });

  it('counts feature and patch commits', () => {
    commit('chore: scaffold');
    expect(appVersion(repo)).toBe('0.0.1');
    commit('feat(shell)!: add desktop shell');
    expect(appVersion(repo)).toBe('0.1.0');
    commit('fix: restore window bounds');
    expect(appVersion(repo)).toBe('0.1.1');
    expect(gitBuild(repo)).toBe(git('rev-parse', '--short', 'HEAD'));
    writeFileSync(join(repo, 'local.txt'), 'untracked');
    expect(gitBuild(repo)).toBe(`${git('rev-parse', '--short', 'HEAD')}-dirty`);
  });
});
