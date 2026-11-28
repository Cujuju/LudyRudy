export function createSerialQueue() {
  let tail = Promise.resolve();
  return function enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = tail.then(action);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}
