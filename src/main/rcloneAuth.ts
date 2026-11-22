import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { AuthSession } from '@shared/types';

const AUTH_TIMEOUT_MS = 5 * 60_000;
const TOKEN_TTL_MS = 10 * 60_000;
const MAX_TOKEN_LENGTH = 64 * 1024;

interface Session {
  view: AuthSession;
  token?: string;
  child?: ChildProcess;
  timer?: NodeJS.Timeout;
  closed?: Promise<void>;
}

export function openAuth(onChange: (session: AuthSession) => void) {
  const sessions = new Map<string, Session>();

  function update(session: Session, state: AuthSession['state'], url: string | null = null, error: string | null = null): void {
    session.view = { ...session.view, state, url, error };
    onChange(session.view);
  }

  function expire(session: Session): void {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => sessions.delete(session.view.id), TOKEN_TTL_MS);
    session.timer.unref();
  }

  return {
    start(binary: string, provider: string): AuthSession {
      if (!/^[a-z][a-z0-9_]*$/i.test(provider)) throw new Error('Invalid OAuth provider.');
      if ([...sessions.values()].some((session) => session.child)) throw new Error('An authorization is already in progress.');
      const id = randomUUID();
      const session: Session = { view: { id, provider, state: 'starting', url: null, error: null } };
      const child = spawn(binary, ['authorize', provider, '--auth-no-open-browser', '--config', '', '--log-level', 'INFO'], {
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      session.child = child;
      sessions.set(id, session);
      let acceptingToken = false;
      function inspect(line: string): void {
        if (session.view.state !== 'starting' && session.view.state !== 'awaiting') return;
        const link = /go to the following link:\s+(http:\/\/127\.0\.0\.1:\d+\/auth\?state=[\w-]+)\s*$/i.exec(line)?.[1];
        if (link) update(session, 'awaiting', link);
      }
      createInterface({ input: child.stderr }).on('line', inspect);
      createInterface({ input: child.stdout }).on('line', (line) => {
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
      sessions.delete(id);
    },
    async stop(): Promise<void> {
      await Promise.all([...sessions.keys()].map((id) => this.cancel(id)));
    },
    token(id: string, provider: string): string {
      const session = sessions.get(id);
      if (session?.view.provider !== provider || session.view.state !== 'completed' || !session.token) throw new Error('Authorization is incomplete or expired.');
      return session.token;
    },
  };
}

export type RcloneAuth = ReturnType<typeof openAuth>;
