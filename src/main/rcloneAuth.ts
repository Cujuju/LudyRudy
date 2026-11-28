import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { providerName } from '@shared/providers';
import type { AuthSession } from '@shared/types';
import { renderOAuthTemplate } from './oauthTemplate';

export interface AuthorizationConfig {
  provider: string;
  prefix: string;
  values: Record<string, string>;
  remote?: string;
  client: object;
  daemonIdentity: string;
}

const AUTH_TIMEOUT_MS = 5 * 60_000;
const TOKEN_TTL_MS = 10 * 60_000;
const MAX_TOKEN_LENGTH = 64 * 1024;
const TEMPLATE_DIR_PREFIX = 'ludyrudy-oauth-';
const TEMPLATE_FILE_NAME = 'callback.html';
const TEMPLATE_FILE_MODE = 0o600;

interface Session {
  view: AuthSession;
  client: object;
  binding: string;
  token?: string;
  child?: ChildProcess;
  timer?: NodeJS.Timeout;
  closed?: Promise<void>;
  templateDir?: string;
}

function cleanupTemplate(dir?: string): void {
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort temp cleanup.
  }
}

type AuthSpawn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

function authorizationBinding(config: AuthorizationConfig): string {
  const entries = Object.keys(config.values).sort().map((key) => [key, config.values[key]]);
  return createHash('sha256').update(JSON.stringify([config.provider, config.prefix, config.remote, config.daemonIdentity, entries])).digest('hex');
}

function authorizationEnv(config: AuthorizationConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^RCLONE_/i.test(name)));
  const prefix = config.prefix.toUpperCase().replaceAll('-', '_');
  for (const [name, value] of Object.entries(config.values)) {
    if (value !== '') env[`RCLONE_${prefix}_${name.toUpperCase()}`] = value;
  }
  return env;
}

export function openAuth(onChange: (session: AuthSession) => void, spawnProcess: AuthSpawn = spawn) {
  const sessions = new Map<string, Session>();

  function update(session: Session, state: AuthSession['state'], url: string | null = null, error: string | null = null): void {
    session.view = { ...session.view, state, url, error };
    onChange(session.view);
  }

  function expire(session: Session): void {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => {
      sessions.delete(session.view.id);
      session.token = undefined;
      if (session.view.state === 'completed') {
        update(session, 'expired', null, 'Authorization expired. Authorize again to finish setup.');
      }
    }, TOKEN_TTL_MS);
    session.timer.unref();
  }

  return {
    start(binary: string, config: AuthorizationConfig): AuthSession {
      const { provider, prefix, client } = config;
      if (!/^[a-z][a-z0-9_ -]*$/i.test(provider) || !/^[a-z][a-z0-9_-]*$/i.test(prefix)) throw new Error('Invalid OAuth provider.');
      if ([...sessions.values()].some((session) => session.child)) throw new Error('An authorization is already in progress.');
      const id = randomUUID();
      const templateDir = mkdtempSync(join(tmpdir(), TEMPLATE_DIR_PREFIX));
      const templatePath = join(templateDir, TEMPLATE_FILE_NAME);
      let child: ChildProcess;
      try {
        writeFileSync(templatePath, renderOAuthTemplate(providerName(provider)), { encoding: 'utf8', mode: TEMPLATE_FILE_MODE });
        child = spawnProcess(binary, [
          'authorize', provider, '--auth-no-open-browser', '--config', '', '--log-level', 'INFO', '--template', templatePath,
        ], {
          windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: authorizationEnv(config),
        });
      } catch (error) {
        cleanupTemplate(templateDir);
        throw error;
      }
      const session: Session = { view: { id, provider, state: 'starting', url: null, error: null },
        client, binding: authorizationBinding(config), child, templateDir };
      sessions.set(id, session);
      let acceptingToken = false;
      function inspect(line: string): void {
        if (session.view.state !== 'starting' && session.view.state !== 'awaiting') return;
        const link = /go to the following link:\s+(http:\/\/127\.0\.0\.1:\d+\/auth\?state=[\w-]+)\s*$/i.exec(line)?.[1];
        if (link) update(session, 'awaiting', link);
      }
      if (child.stderr) createInterface({ input: child.stderr }).on('line', inspect);
      if (child.stdout) createInterface({ input: child.stdout }).on('line', (line) => {
        inspect(line);
        if (line === 'Paste the following into your remote machine --->') {
          acceptingToken = true;
          return;
        }
        if (!acceptingToken || line.length > MAX_TOKEN_LENGTH) return;
        acceptingToken = false;
        try {
          const value: unknown = JSON.parse(line);
          if (value && typeof value === 'object' && 'access_token' in value && typeof value.access_token === 'string') session.token = line;
        } catch {
          // Completion requires a recognized token and a successful child exit.
        }
      });
      child.on('error', () => update(session, 'failed', null, 'Could not run rclone authorization.'));
      session.closed = new Promise((resolve) => child.once('close', (code) => {
        session.child = undefined;
        cleanupTemplate(session.templateDir);
        session.templateDir = undefined;
        if (session.view.state === 'starting' || session.view.state === 'awaiting') {
          if (code === 0 && session.token) update(session, 'completed');
          else update(session, 'failed', null, 'rclone authorization did not return a token.');
        }
        if (session.view.state !== 'completed') session.token = undefined;
        expire(session);
        resolve();
      }));
      session.timer = setTimeout(() => {
        update(session, 'failed', null, 'rclone authorization timed out.');
        child.kill('SIGKILL');
      }, AUTH_TIMEOUT_MS);
      session.timer.unref();
      return session.view;
    },
    status(id: string): AuthSession | null {
      return sessions.get(id)?.view ?? null;
    },
    openUrl(id: string): string {
      const view = sessions.get(id)?.view;
      if (view?.state !== 'awaiting' || !view.url) throw new Error('Authorization is not awaiting a browser.');
      return view.url;
    },
    async cancel(id: string): Promise<void> {
      const session = sessions.get(id);
      if (!session) return;
      update(session, 'cancelled');
      session.token = undefined;
      session.child?.kill('SIGKILL');
      await session.closed;
      clearTimeout(session.timer);
      cleanupTemplate(session.templateDir);
      sessions.delete(id);
    },
    async stop(): Promise<void> {
      await Promise.all([...sessions.keys()].map((id) => this.cancel(id)));
    },
    token(id: string, config: AuthorizationConfig): string {
      const session = sessions.get(id);
      if (session?.view.state !== 'completed' || !session.token) throw new Error('Authorization is incomplete or expired.');
      if (session.client !== config.client || session.binding !== authorizationBinding(config)) {
        throw new Error('Authorization settings changed. Authorize again before saving.');
      }
      return session.token;
    },
  };
}

export type RcloneAuth = ReturnType<typeof openAuth>;
