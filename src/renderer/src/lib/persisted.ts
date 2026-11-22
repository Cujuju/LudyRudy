const PREFIX = 'ludyrudy.view.';

export function readView<T>(key: string, initial: T, accepts: (value: unknown) => value is T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    const value: unknown = raw === null ? undefined : JSON.parse(raw);
    return accepts(value) ? value : initial;
  } catch {
    return initial;
  }
}

export function writeView(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // View storage may be disabled or full.
  }
}
