import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  checkAndNotify,
  hasOpenBumpPr,
  isNewerVersion,
  parseStableSemver,
  readPinnedVersion,
  signWebhookBody,
} from './check-rclone-release.mts';

const current = '1.76.0';
const version = '1.76.1';
const release = {
  draft: false,
  prerelease: false,
  tag_name: 'v' + version,
  published_at: '2026-11-19T12:00:00Z',
  html_url: 'https://github.com/rclone/rclone/releases/tag/v' + version,
};
const latestUrl = 'https://api.github.com/repos/rclone/rclone/releases/latest';
const pullsUrl = 'https://api.github.com/repos/Cujuju/LudyRudy/pulls?state=open&per_page=100&page=1';
const webhookUrl = 'https://example.com/webhook';
const webhookSecret = 'test-secret';

function setup(latest = release, prs: unknown[] = []) {
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json(latest))
    .mockResolvedValueOnce(Response.json(prs))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  return { fetch, log: vi.fn(), pinnedSource: "const VERSION = '" + current + "';", webhookUrl, webhookSecret };
}

describe('rclone versions', () => {
  it('reads the actual fetch script', () => {
    const source = readFileSync(new URL('./fetch-rclone.mjs', import.meta.url), 'utf8');
    expect(readPinnedVersion(source)).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it.each(['', "const OTHER = '1.2.3';", "const VERSION = '1.2';", "const VERSION = '1.2.3-beta';",
    "const VERSION = 123;", "// const VERSION = '1.2.3';", "const VERSION = '01.2.3';"])(
    'rejects missing or malformed pin %j',
    (source) => expect(() => readPinnedVersion(source)).toThrow(/VERSION.*fetch-rclone/),
  );

  it('parses stable tags', () => {
    expect(parseStableSemver('v1.100.0')).toEqual([1, 100, 0]);
    expect(parseStableSemver('1.76.0')).toEqual([1, 76, 0]);
    expect(parseStableSemver('1.76.0+build')).toBeNull();
  });

  it.each([
    ['2.0.0', true], ['1.77.0', true], ['1.76.1', true], ['1.100.0', true], ['v1.76.1', true],
    ['1.76.0', false], ['1.75.99', false], ['0.99.99', false],
    ['v2.0.0-beta.1', false], ['2.0.0-rc1', false], ['2.0', false],
  ] as const)('compares %s with the pinned version', (candidate, expected) => {
    expect(isNewerVersion(current, candidate)).toBe(expected);
  });

  it('rejects invalid current versions and compares prefixed current versions', () => {
    expect(isNewerVersion('1.76.0-beta', '2.0.0')).toBe(false);
    expect(isNewerVersion('v1.76.0', '1.76.1')).toBe(true);
  });
});

describe('bump PR detection', () => {
  it('matches the branch or a case-insensitive title', () => {
    expect(hasOpenBumpPr([{ head: { ref: 'chore/rclone-v1.76.0' } }], current)).toBe(true);
    expect(hasOpenBumpPr([{ title: 'Bump RCLONE to V1.76.0.' }], current)).toBe(true);
  });

  it.each([
    'Bump rclone to 1.76.01', 'Bump rclone to 11.76.0', 'Bump rclone to 1.76.0.1',
    'Bump rclone to v1.76.0rc', 'Bump rclone-helper2 to 1.76.01', 'Bump other to 1.76.0',
    'Bump myrclone to 1.76.0',
  ])('ignores %s', (title) => {
    expect(hasOpenBumpPr([{ title }, { head: { ref: 'chore/rclone-v1.76.01' } }], current)).toBe(false);
  });
});

it('signs a known HMAC-SHA256 vector', () => {
  expect(signWebhookBody('The quick brown fox jumps over the lazy dog', 'key')).toBe(
    'sha256=f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
  );
});

describe('release check', () => {
  it('stops after fetching the current release', async () => {
    const options = setup({ ...release, tag_name: 'v' + current });
    await checkAndNotify(options);
    expect(options.fetch).toHaveBeenCalledTimes(1);
    expect(options.log).toHaveBeenCalledWith(expect.stringContaining('up to date'));
  });

  it.each([
    { ...release, prerelease: true },
    { ...release, draft: true },
    { ...release, tag_name: 'v2.0.0-beta.1' },
  ])('skips unstable or draft releases', async (latest) => {
    const options = setup(latest);
    await checkAndNotify(options);
    expect(options.fetch).toHaveBeenCalledTimes(1);
    expect(options.log).toHaveBeenCalledWith(expect.stringContaining('not stable'));
  });

  it('skips an open bump PR', async () => {
    const options = setup(release, [{ head: { ref: 'chore/rclone-v' + version } }]);
    await checkAndNotify(options);
    expect(options.fetch).toHaveBeenCalledTimes(2);
    expect(options.log).toHaveBeenCalledWith(expect.stringContaining('already open'));
  });

  it('skips a bump PR found beyond the first page', async () => {
    const options = setup();
    const fullPageSize = 100;
    options.fetch.mockReset()
      .mockResolvedValueOnce(Response.json(release))
      .mockResolvedValueOnce(Response.json(Array.from({ length: fullPageSize }, () => ({ title: 'Unrelated' }))))
      .mockResolvedValueOnce(Response.json([{ title: 'Bump rclone to ' + version }]));
    await checkAndNotify(options);
    expect(options.fetch).toHaveBeenCalledTimes(3);
    expect(options.fetch).toHaveBeenNthCalledWith(3, pullsUrl.replace('&page=1', '&page=2'), expect.any(Object));
    expect(options.log).toHaveBeenCalledWith(expect.stringContaining('already open'));
  });

  it.each([{ webhookUrl: '' }, { webhookSecret: undefined }])('skips missing fork secrets', async (secrets) => {
    const options = setup();
    await checkAndNotify({ ...options, ...secrets, repository: 'owner/fork' });
    expect(options.fetch).toHaveBeenCalledTimes(2);
    expect(options.fetch).toHaveBeenNthCalledWith(
      2, pullsUrl.replace('Cujuju/LudyRudy', 'owner/fork'), expect.any(Object),
    );
    expect(options.log).toHaveBeenCalledWith(expect.stringContaining('secrets are not configured'));
  });

  it.each([webhookSecret, ''])('skips POST in dry run', async (secret) => {
    const options = setup();
    await checkAndNotify({ ...options, dryRun: true, webhookSecret: secret });
    expect(options.fetch).toHaveBeenCalledTimes(2);
    expect(options.log).toHaveBeenCalledWith(expect.stringContaining('Dry run'));
  });

  it('posts and signs the exact release payload', async () => {
    const options = setup();
    const githubToken = 'test-token';
    await checkAndNotify({ ...options, githubToken });
    expect(options.fetch).toHaveBeenCalledTimes(3);
    const githubOptions = {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + githubToken,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ludyRudy-rclone-check',
      },
      signal: expect.any(AbortSignal),
    };
    expect(options.fetch).toHaveBeenNthCalledWith(1, latestUrl, githubOptions);
    expect(options.fetch).toHaveBeenNthCalledWith(2, pullsUrl, githubOptions);
    const body = JSON.stringify({
      event: 'rclone-release',
      version,
      tag: release.tag_name,
      publishedAt: release.published_at,
      url: release.html_url,
    });
    expect(options.fetch).toHaveBeenNthCalledWith(3, webhookUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', 'x-rclone-signature': signWebhookBody(body, webhookSecret) },
      body,
      signal: expect.any(AbortSignal),
    });
  });

  it('reports GitHub HTTP failures without response details', async () => {
    const options = setup();
    options.fetch.mockReset().mockResolvedValueOnce(new Response('response details', { status: 403 }));
    await expect(checkAndNotify(options)).rejects.toThrow(/^GitHub API request failed \(HTTP 403\)\.$/);
  });

  it('reports webhook HTTP failures without response details', async () => {
    const options = setup();
    options.fetch.mockReset()
      .mockResolvedValueOnce(Response.json(release))
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(new Response(webhookSecret, { status: 503 }));
    await expect(checkAndNotify(options)).rejects.toThrow(/^Webhook request failed \(HTTP 503\)\.$/);
  });

  it('suppresses network errors that could expose webhook credentials', async () => {
    const options = setup();
    options.fetch.mockReset()
      .mockResolvedValueOnce(Response.json(release))
      .mockResolvedValueOnce(Response.json([]))
      .mockRejectedValueOnce(new Error(webhookUrl + '/' + webhookSecret));
    await expect(checkAndNotify(options)).rejects.toThrow(/^Webhook request failed\.$/);
  });
});
