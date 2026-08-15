// First acceptable result wins; abort sibling legs (hedged read / slot race).

export type RaceLeg<T> = (signal: AbortSignal) => Promise<T>;

function isAbortError(e: unknown): boolean {
  const name = (e as { name?: string })?.name;
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * Run legs in parallel; first value that passes `isValid` wins and aborts the rest.
 * Invalid results (or throws) are ignored until all fail → null.
 */
export async function raceFirstValid<T>(
  legs: Array<RaceLeg<T>>,
  isValid: (value: T) => boolean,
  opts?: { timeoutMs?: number; outerSignal?: AbortSignal },
): Promise<T | null> {
  if (!legs.length) return null;
  if (opts?.outerSignal?.aborted) return null;

  const controllers = legs.map(() => new AbortController());
  const master = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const abortAll = () => {
    for (const c of controllers) {
      try { c.abort(); } catch { /* ignore */ }
    }
    try { master.abort(); } catch { /* ignore */ }
  };

  if (opts?.outerSignal) {
    opts.outerSignal.addEventListener("abort", abortAll, { once: true });
  }
  if (opts?.timeoutMs != null && opts.timeoutMs > 0) {
    timer = setTimeout(abortAll, opts.timeoutMs);
  }

  const promises = legs.map((leg, i) =>
    (async () => {
      const linkAbort = () => {
        try { controllers[i].abort(); } catch { /* ignore */ }
      };
      if (master.signal.aborted) linkAbort();
      else master.signal.addEventListener("abort", linkAbort, { once: true });

      try {
        const value = await leg(controllers[i].signal);
        if (!isValid(value)) throw new Error("race_invalid");
        // Win: cancel siblings + master timer path
        controllers.forEach((c, j) => {
          if (j !== i) {
            try { c.abort(); } catch { /* ignore */ }
          }
        });
        try { master.abort(); } catch { /* ignore */ }
        return value;
      } catch (e) {
        if (isAbortError(e)) throw e;
        throw e;
      }
    })(),
  );

  try {
    return await Promise.any(promises);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    abortAll();
  }
}
