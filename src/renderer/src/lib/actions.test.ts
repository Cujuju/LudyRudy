import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNativePicker } from './actions';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe('native picker', () => {
  const blur = vi.fn();
  let picker: ReturnType<typeof useNativePicker>;
  let dispose: () => void;

  beforeEach(() => {
    const element = new (class { blur = blur; })();
    vi.stubGlobal('HTMLElement', element.constructor);
    vi.stubGlobal('document', { activeElement: element });
    blur.mockClear();
    createRoot((cleanup) => { dispose = cleanup; picker = useNativePicker(); });
  });

  afterEach(() => {
    dispose();
    vi.unstubAllGlobals();
  });

  it('holds pending through selection and application and blocks concurrent work', async () => {
    const choice = deferred<string | null>();
    const applied = deferred<void>();
    const select = vi.fn(() => choice.promise);
    const apply = vi.fn(() => applied.promise);
    const result = picker.choose(select, apply);
    expect(blur).toHaveBeenCalledOnce();
    expect(picker.pending()).toBe(true);
    expect(await picker.choose(select, apply)).toBe(false);
    expect(await picker.run(async () => { throw new Error('unexpected save'); })).toBe(false);
    expect(select).toHaveBeenCalledOnce();
    choice.resolve('/chosen');
    await choice.promise;
    expect(apply).toHaveBeenCalledWith('/chosen');
    expect(picker.pending()).toBe(true);
    applied.resolve();
    expect(await result).toBe(true);
    expect(picker.pending()).toBe(false);
  });

  it('leaves the draft alone on cancel or failure and reports the error', async () => {
    const apply = vi.fn();
    expect(await picker.choose(async () => null, apply)).toBe(true);
    expect(picker.message()).toBe('');
    expect(await picker.choose(async () => { throw new Error('Picker failed.'); }, apply)).toBe(false);
    expect(picker.pending()).toBe(false);
    expect(picker.error()).toBe(true);
    expect(picker.message()).toBe('Picker failed.');
    expect(apply).not.toHaveBeenCalled();
  });

  it('ignores a picker result after the owner is disposed', async () => {
    const choice = deferred<string | null>();
    const apply = vi.fn();
    const result = picker.choose(() => choice.promise, apply);
    dispose();
    choice.resolve('/chosen');
    await result;
    expect(apply).not.toHaveBeenCalled();
  });
});
