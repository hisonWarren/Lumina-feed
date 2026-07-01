// lumina-feed · 取文结果 IPC 瘦身（PDF 已落盘，勿把 bytes 克隆进渲染进程）
import type { FetchPaperFailure, FetchPaperResult } from "./provider.ts";

export type FetchPaperIpcResult =
  | (Omit<FetchPaperResult, "bytes"> & { ok: true })
  | FetchPaperFailure;

/** 发往渲染层的取文结果：去掉 bytes，避免大 PDF 结构化克隆卡死 UI。 */
export function fetchResultForIpc(
  res: FetchPaperResult | FetchPaperFailure,
): FetchPaperIpcResult {
  if (!res.ok) return res;
  const { bytes: _omit, ...rest } = res;
  return rest;
}
