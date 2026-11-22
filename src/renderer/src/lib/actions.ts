import { createSignal } from 'solid-js';

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
