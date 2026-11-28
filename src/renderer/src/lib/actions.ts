import { createSignal, onCleanup } from 'solid-js';

export const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export function useAction() {
  const [pending, setPending] = createSignal(false);
  const [message, setMessage] = createSignal('');
  const [error, setError] = createSignal(false);

  function clear() {
    setMessage('');
    setError(false);
  }

  async function run(action: () => Promise<unknown>, success?: string | (() => string)) {
    if (pending()) return false;
    setPending(true);
    clear();
    try {
      await action();
      setMessage(typeof success === 'function' ? success() : success ?? '');
      return true;
    } catch (cause) {
      setError(true);
      setMessage(errorMessage(cause));
      return false;
    } finally {
      setPending(false);
    }
  }

  return { run, pending, message, error, clear };
}

export function useNativePicker() {
  const action = useAction();
  let disposed = false;
  onCleanup(() => { disposed = true; });

  function choose(pick: () => Promise<string | null>, apply: (path: string) => void | Promise<void>) {
    return action.run(async () => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement) focused.blur();
      const path = await pick();
      if (!disposed && path) await apply(path);
    });
  }
  return { ...action, choose };
}
