// src/core/sources/with-timeout.ts
// Per-source timeout (fixes review F5): a hanging source must not block the aggregate's final resolve.
export class TimeoutError extends Error {
  constructor(public ms: number) { super(`timeout ${ms}ms`); this.name = "TimeoutError"; }
}
export function withTimeout<T>(p: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => { onTimeout?.(); reject(new TimeoutError(ms)); }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
