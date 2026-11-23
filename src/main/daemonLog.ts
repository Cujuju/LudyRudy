import { StringDecoder } from 'node:string_decoder';
import type { Readable } from 'node:stream';
import type { LogLine } from '@shared/types';

const MAX_LOG_LINE_LENGTH = 64 * 1024;
const MAX_MESSAGE_LENGTH = 500;
const REDACTED = '[redacted]';

type Span = readonly [start: number, end: number];

const SAFE_MESSAGES: [RegExp, string][] = [
  [/Serving remote control on /i, 'Listening for remote control requests.'],
  [/Config file .* not found/i, 'The config file does not exist yet.'],
  [/(?:failed|unable) to decrypt (?:configuration|config file|rclone\.conf)|unable to read obscured password/i, 'Could not decrypt rclone configuration.'],
  [/address already in use/i, 'The remote control port is already in use.'],
];

const SECRET_KEYS = [
  'access_token', 'refresh_token', 'id_token', 'client_secret',
  'password2?', 'pass', 'secret(?:_access_key)?', 'session_token',
  'private_key', 'token', 'api_?key', 'signature',
  'x-amz-(?:credential|signature|security-token)',
].join('|');

const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)([^/\s@]+)@/gi;
const AUTH_HEADER_KEY = /(?:"|')?\b(?:authorization|proxy-authorization)\b(?:"|')?\s*[:=]\s*/gi;
const AUTH_SCHEME = /\b(?:bearer|basic)\s+/gi;
const SECRET_FIELD_KEY = new RegExp(`(?:"|')?\\b(?:${SECRET_KEYS})\\b(?:"|')?\\s*[:=]\\s*`, 'gi');
const INLINE_REMOTE_START = /(?:^|[\s"'(\[])(:?[\p{L}\p{N}_.+@][\p{L}\p{N}_.+@-]*),/giu;

function scanQuotedEnd(text: string, quoteIndex: number): number {
  const quote = text[quoteIndex];
  for (let i = quoteIndex + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === quote) return i + 1;
  }
  return text.length;
}

function scanRcloneQuotedEnd(text: string, quoteIndex: number): number {
  const quote = text[quoteIndex];
  for (let i = quoteIndex + 1; i < text.length; i++) {
    if (text[i] === quote) {
      if (text[i + 1] === quote) {
        i++;
        continue;
      }
      return i + 1;
    }
  }
  return text.length;
}

function scanTokenEnd(text: string, start: number, stopChars: string): number {
  let i = start;
  while (i < text.length && !stopChars.includes(text[i]!)) i++;
  return i;
}

function scanHeaderValueEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      i = scanQuotedEnd(text, i);
      continue;
    }
    if (ch === '\r' || ch === '\n' || ch === '}' || ch === ']' || ch === ')') break;
    i++;
  }
  return i;
}

function collectRuntimeSecretSpans(text: string, secrets: readonly string[], spans: Span[]): void {
  for (const secret of secrets) {
    if (!secret) continue;
    let index = text.indexOf(secret);
    while (index !== -1) {
      spans.push([index, index + secret.length]);
      index = text.indexOf(secret, index + secret.length);
    }
  }
}

function collectInlineBackendSpans(text: string, spans: Span[]): void {
  INLINE_REMOTE_START.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_REMOTE_START.exec(text)) !== null) {
    const commaIndex = match.index + match[0].length - 1;
    let i = commaIndex + 1;
    let hasParam = false;
    let inValue = false;
    while (i < text.length) {
      const ch = text[i]!;
      if (ch === ':') {
        if (hasParam) spans.push([commaIndex + 1, i]);
        i++;
        break;
      }
      if (ch === ',') {
        inValue = false;
      } else if (ch === '=' && !inValue) {
        hasParam = true;
        inValue = true;
        if (text[i + 1] === '"' || text[i + 1] === "'") {
          i = scanRcloneQuotedEnd(text, i + 1);
          continue;
        }
      }
      if (ch === '\r' || ch === '\n' || (!hasParam && /\s/.test(ch))) break;
      i++;
    }
    if (i > INLINE_REMOTE_START.lastIndex) INLINE_REMOTE_START.lastIndex = i;
  }
}

function collectAuthSpans(text: string, spans: Span[]): void {
  AUTH_HEADER_KEY.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = AUTH_HEADER_KEY.exec(text)) !== null) {
    const valueStart = match.index + match[0].length;
    if (valueStart >= text.length) break;
    const ch = text[valueStart];
    let end: number;
    if (ch === '"' || ch === "'") {
      end = scanQuotedEnd(text, valueStart);
      const innerEnd = text[end - 1] === ch ? end - 1 : end;
      if (innerEnd > valueStart + 1) spans.push([valueStart + 1, innerEnd]);
    } else {
      end = scanHeaderValueEnd(text, valueStart);
      if (end > valueStart) spans.push([valueStart, end]);
    }
    if (end > AUTH_HEADER_KEY.lastIndex) AUTH_HEADER_KEY.lastIndex = end;
  }
  AUTH_SCHEME.lastIndex = 0;
  while ((match = AUTH_SCHEME.exec(text)) !== null) {
    const valueStart = match.index + match[0].length;
    if (valueStart >= text.length) break;
    const ch = text[valueStart];
    let end: number;
    if (ch === '"' || ch === "'") {
      end = scanQuotedEnd(text, valueStart);
      const innerEnd = text[end - 1] === ch ? end - 1 : end;
      if (innerEnd > valueStart + 1) spans.push([valueStart + 1, innerEnd]);
    } else {
      end = scanTokenEnd(text, valueStart, ' \t\r\n"\',;)}]');
      if (end > valueStart) spans.push([valueStart, end]);
    }
    if (end > AUTH_SCHEME.lastIndex) AUTH_SCHEME.lastIndex = end;
  }
}

function collectSecretFieldSpans(text: string, spans: Span[], skipSpans: readonly Span[]): void {
  SECRET_FIELD_KEY.lastIndex = 0;
  let skipIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = SECRET_FIELD_KEY.exec(text)) !== null) {
    while (skipIdx < skipSpans.length && skipSpans[skipIdx]![1] <= match.index) skipIdx++;
    if (skipIdx < skipSpans.length && match.index >= skipSpans[skipIdx]![0]) continue;
    const valueStart = match.index + match[0].length;
    if (valueStart >= text.length) break;
    const ch = text[valueStart];
    let end: number;
    if (ch === '"' || ch === "'") {
      end = scanQuotedEnd(text, valueStart);
      const innerEnd = text[end - 1] === ch ? end - 1 : end;
      if (innerEnd > valueStart + 1) spans.push([valueStart + 1, innerEnd]);
    } else {
      end = scanTokenEnd(text, valueStart, ' \t\r\n&"\',;)}]');
      if (end > valueStart) spans.push([valueStart, end]);
    }
    if (end > SECRET_FIELD_KEY.lastIndex) SECRET_FIELD_KEY.lastIndex = end;
  }
}

function applyRedactions(text: string, spans: Span[]): string {
  if (!spans.length) return text;
  const sorted = [...spans].sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const [start, end] of sorted) {
    if (end <= start) continue;
    const prev = merged.at(-1);
    if (prev && start <= prev[1]) prev[1] = Math.max(prev[1], end);
    else merged.push([start, end]);
  }
  let out = '';
  let cursor = 0;
  for (const [start, end] of merged) {
    out += text.slice(cursor, start) + REDACTED;
    cursor = end;
  }
  return out + text.slice(cursor);
}

export function sanitizeDaemonMessage(msg: string, object?: unknown, secrets: readonly string[] = []): string {
  const normalized = msg.replace(/[\r\n]+/g, ' ').trim();
  const prefix = typeof object === 'string' && object.trim() && !normalized.includes(object.trim())
    ? `${object.trim()}: `
    : '';
  const text = `${prefix}${normalized}`;
  const spans: Span[] = [];
  collectRuntimeSecretSpans(text, secrets, spans);
  URL_CREDENTIALS.lastIndex = 0;
  for (const match of text.matchAll(URL_CREDENTIALS)) {
    const start = match.index + match[1]!.length;
    spans.push([start, start + match[2]!.length]);
  }
  const inlineSpans: Span[] = [];
  collectInlineBackendSpans(text, inlineSpans);
  spans.push(...inlineSpans);
  collectAuthSpans(text, spans);
  collectSecretFieldSpans(text, spans, inlineSpans);
  const redacted = applyRedactions(text, spans);
  return redacted.length > MAX_MESSAGE_LENGTH ? `${redacted.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : redacted;
}

export function streamDaemonLogs(stream: Readable, emit: (entry: LogLine) => void, secrets: readonly string[] = []): void {
  const decoder = new StringDecoder();
  let buffer = '';
  let overflow = false;
  function consume(chunk: string): void {
    const lines = chunk.split('\n');
    for (const [index, part] of lines.entries()) {
      overflow ||= buffer.length + part.length > MAX_LOG_LINE_LENGTH;
      if (!overflow) buffer += part;
      if (index === lines.length - 1) break;
      if (!overflow) {
        const entry = parseDaemonLog(buffer, secrets);
        if (entry) emit(entry);
      }
      buffer = '';
      overflow = false;
    }
  }
  stream.on('data', (chunk: Buffer) => consume(decoder.write(chunk)));
  stream.once('end', () => consume(decoder.end() + '\n'));
}

export function parseDaemonLog(line: string, secrets: readonly string[] = []): LogLine | null {
  let raw: { level?: unknown; msg?: unknown; time?: unknown; object?: unknown } | null;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw.msg !== 'string') return null;
  const level = ['error', 'critical', 'fatal', 'alert', 'emergency'].includes(String(raw.level)) ? 'error'
    : ['warning', 'warn'].includes(String(raw.level)) ? 'warn' : 'info';
  const time = typeof raw.time === 'string' ? Date.parse(raw.time) : NaN;
  const friendly = SAFE_MESSAGES.find(([pattern]) => pattern.test(raw.msg as string))?.[1];
  const message = friendly ?? (sanitizeDaemonMessage(raw.msg, raw.object, secrets) || `rclone reported a ${level} event.`);
  return { ts: Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString(), level, message, source: 'rclone' };
}
