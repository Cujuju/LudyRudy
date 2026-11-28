import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const GITHUB_API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 15_000;
const PRS_PER_PAGE = 100;

class ReleaseCheckError extends Error {}

type BumpPr = { title?: string; head?: { ref?: string } };
type Release = {
  draft: boolean;
  prerelease: boolean;
  tag_name: string;
  published_at: string;
  html_url: string;
};
type CheckOptions = {
  pinnedSource: string;
  fetch: typeof fetch;
  repository?: string;
  githubToken?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  dryRun?: boolean;
  log?: (message: string) => void;
};

export function parseStableSemver(tag: string): [number, number, number] | null {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  if (!match) return null;
  const parts: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function readPinnedVersion(source: string): string {
  const version = /^[ \t]*const[ \t]+VERSION[ \t]*=[ \t]*'([^'\r\n]+)'[ \t]*;[ \t]*(?:\r?$)/m.exec(source)?.[1];
  if (!version) throw new ReleaseCheckError('Missing or malformed VERSION declaration in scripts/fetch-rclone.mjs.');
  if (version.startsWith('v') || !parseStableSemver(version)) {
    throw new ReleaseCheckError('VERSION in scripts/fetch-rclone.mjs must be a stable X.Y.Z version.');
  }
  return version;
}

export function isNewerVersion(current: string, candidate: string): boolean {
  const pinned = parseStableSemver(current);
  const latest = parseStableSemver(candidate);
  if (!pinned || !latest) return false;
  const [major, minor, patch] = latest;
  const [pinnedMajor, pinnedMinor, pinnedPatch] = pinned;
  if (major !== pinnedMajor) return major > pinnedMajor;
  if (minor !== pinnedMinor) return minor > pinnedMinor;
  return patch > pinnedPatch;
}

export function hasOpenBumpPr(prs: ReadonlyArray<BumpPr>, version: string): boolean {
  const parts = parseStableSemver(version);
  if (!parts) return false;
  const normalized = parts.join('.');
  const bumpTitle = new RegExp('^(?:chore(?:\\([^)]+\\))?: )?bump rclone to v?' + parts.join('\\.') + '\\.?$', 'i');
  return prs.some(({ title = '', head }) =>
    head?.ref === 'chore/rclone-v' + normalized || bumpTitle.test(title.trim()));
}

export function signWebhookBody(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

async function request(
  fetchImpl: typeof fetch,
  label: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new ReleaseCheckError(label + ' request failed.');
  }
  if (!response.ok) throw new ReleaseCheckError(label + ' request failed (HTTP ' + response.status + ').');
  return response;
}

export async function checkAndNotify({
  pinnedSource,
  fetch: fetchImpl,
  repository = 'Cujuju/LudyRudy',
  githubToken,
  webhookUrl,
  webhookSecret,
  dryRun = false,
  log = console.log,
}: CheckOptions): Promise<void> {
  const current = readPinnedVersion(pinnedSource);
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ludyRudy-rclone-check',
    ...(githubToken ? { Authorization: 'Bearer ' + githubToken } : {}),
  };
  async function githubJson<T>(path: string): Promise<T> {
    const response = await request(fetchImpl, 'GitHub API', GITHUB_API + path, { headers });
    try {
      return await response.json() as T;
    } catch {
      throw new ReleaseCheckError('GitHub API returned invalid JSON.');
    }
  }

  const release = await githubJson<Release>('/repos/rclone/rclone/releases/latest');
  const tag = release.tag_name;
  const parts = parseStableSemver(tag);
  if (release.draft || release.prerelease || !parts) {
    log('The latest rclone release is not stable. Skipping.');
    return;
  }
  const version = parts.join('.');
  if (!isNewerVersion(current, version)) {
    log('rclone is up to date (pinned ' + current + ', latest ' + version + ').');
    return;
  }

  let prs: ReadonlyArray<BumpPr>;
  let page = 1;
  do {
    prs = await githubJson<ReadonlyArray<BumpPr>>(
      '/repos/' + repository + '/pulls?state=open&per_page=' + PRS_PER_PAGE + '&page=' + page,
    );
    if (hasOpenBumpPr(prs, version)) {
      log('An rclone ' + version + ' bump PR is already open.');
      return;
    }
    page++;
  } while (prs.length === PRS_PER_PAGE);

  if (dryRun) {
    log('Dry run: would send a webhook for rclone ' + version + ' (pinned ' + current + ').');
    return;
  }
  if (!webhookUrl?.trim() || !webhookSecret?.trim()) {
    log('Found rclone ' + version + ', but webhook secrets are not configured. Skipping.');
    return;
  }

  if (typeof release.published_at !== 'string' || typeof release.html_url !== 'string') {
    throw new ReleaseCheckError('GitHub API omitted rclone release metadata.');
  }
  const body = JSON.stringify({
    event: 'rclone-release',
    version,
    tag,
    publishedAt: release.published_at,
    url: release.html_url,
  });
  await request(fetchImpl, 'Webhook', webhookUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      'x-rclone-signature': signWebhookBody(body, webhookSecret),
    },
    body,
  });
  log('Sent webhook for rclone ' + version + '.');
}

if (import.meta.main) {
  try {
    const pinnedSource = await readFile(new URL('./fetch-rclone.mjs', import.meta.url), 'utf8');
    await checkAndNotify({
      pinnedSource,
      fetch,
      repository: process.env.GITHUB_REPOSITORY,
      githubToken: process.env.GITHUB_TOKEN,
      webhookUrl: process.env.T3_RCLONE_WEBHOOK_URL,
      webhookSecret: process.env.T3_RCLONE_WEBHOOK_SECRET,
      dryRun: process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true',
    });
  } catch (error) {
    console.error(error instanceof ReleaseCheckError ? error.message : 'rclone release check failed.');
    process.exitCode = 1;
  }
}
