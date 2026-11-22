import { StringDecoder } from 'node:string_decoder';
import type { Readable } from 'node:stream';
import type { LogLine } from '@shared/types';

const MAX_LOG_LINE_LENGTH = 64 * 1024;
const SAFE_MESSAGES: [RegExp, string][] = [
  [/Serving remote control on /i, 'Listening for remote control requests.'],
  [/Config file .* not found/i, 'The config file does not exist yet.'],
  [/failed to decrypt|unable to decrypt|unable to read obscured password/i, 'Could not decrypt rclone configuration.'],
  [/address already in use/i, 'The remote control port is already in use.'],
  [/mount FAILED/i, 'A filesystem mount failed.'],
  [/unmount FAILED/i, 'A filesystem unmount failed.'],
];

export function streamDaemonLogs(stream: Readable, emit: (entry: LogLine) => void): void {
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
        const entry = parseDaemonLog(buffer);
        if (entry) emit(entry);
      }
      buffer = '';
      overflow = false;
    }
  }
  stream.on('data', (chunk: Buffer) => consume(decoder.write(chunk)));
  stream.once('end', () => consume(decoder.end() + '\n'));
}

export function parseDaemonLog(line: string): LogLine | null {
  let raw: { level?: unknown; msg?: unknown; time?: unknown } | null;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw.msg !== 'string') return null;
  const level = ['error', 'critical', 'fatal', 'alert', 'emergency'].includes(String(raw.level)) ? 'error'
    : ['warning', 'warn'].includes(String(raw.level)) ? 'warn' : 'info';
  const time = typeof raw.time === 'string' ? Date.parse(raw.time) : NaN;
  // Rclone and its backends can include arbitrary credentials in log messages.
  const message = SAFE_MESSAGES.find(([pattern]) => pattern.test(String(raw.msg)))?.[1] ?? `rclone reported a ${level} event.`;
  return { ts: Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString(), level, message, source: 'rclone' };
}
