// 渲染层 docKey（与 src/core/reader/doc-key.ts 保持一致）
export function readerDocKey(source) {
  if (!source) return "";
  if (source.paperId) return "paper:" + source.paperId;
  if (source.contentHash) return "hash:" + source.contentHash;
  if (source.localPath) return "local:" + String(source.localPath).replace(/\\/g, "/");
  const len = (source.data && source.data.byteLength) || 0;
  return String(source.name || "doc") + ":" + len;
}

export function readerDocKeyCandidates(source) {
  if (!source) return [];
  const out = [];
  const push = (k) => { if (k && !out.includes(k)) out.push(k); };
  if (source.paperId) push("paper:" + source.paperId);
  if (source.contentHash) push("hash:" + source.contentHash);
  if (source.localPath) push("local:" + String(source.localPath).replace(/\\/g, "/"));
  push(readerDocKey(source));
  return out;
}
