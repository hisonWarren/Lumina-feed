// lumina-feed · 请求超时工具（全文检索：超时先跳过，末尾集中重试）
export function isTimeoutError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return true;
    if (/abort|timeout|timed out/i.test(err.message)) return true;
  }
  return false;
}

/** 合并父 signal 与单次尝试超时 */
export function attemptSignal(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  clear: () => void;
  timedOut: () => boolean;
} {
  const controller = new AbortController();
  let timedOut = false;
  const onParent = () => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener("abort", onParent, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParent);
    },
    timedOut: () => timedOut && !parent?.aborted,
  };
}
