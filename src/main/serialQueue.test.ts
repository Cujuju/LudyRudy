import { expect, it, vi } from 'vitest';
import { createSerialQueue } from './serialQueue';

it('runs in FIFO order and preserves results after a rejection', async () => {
  const queue = createSerialQueue();
  let fail!: (error: Error) => void;
  const first = queue(() => new Promise((_resolve, reject) => { fail = reject; }));
  const nextAction = vi.fn(async () => 42);
  const second = queue(nextAction);
  const lastAction = vi.fn(async () => {
    expect(nextAction).toHaveBeenCalledTimes(1);
    return 'last';
  });
  const third = queue(lastAction);
  const independent = createSerialQueue();
  await expect(independent(async () => 'ready')).resolves.toBe('ready');
  await Promise.resolve();
  expect(nextAction).not.toHaveBeenCalled();
  expect(lastAction).not.toHaveBeenCalled();

  fail(new Error('first failed'));
  await expect(first).rejects.toThrow('first failed');
  await expect(second).resolves.toBe(42);
  await expect(third).resolves.toBe('last');
  expect(nextAction).toHaveBeenCalledTimes(1);
});
