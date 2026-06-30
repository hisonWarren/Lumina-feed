// 渲染层 docKey（与 src/core/reader/doc-key.ts 保持一致）
function localPathDocKeySegment(p) {
  let s = String(p || "").trim().replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(s)) s = s[0].toLowerCase() + s.slice(1);
  return s;
}
function localDocKey(p) {
  return "local:" + localPathDocKeySegment(p);
}

export function readerDocKey(source) {
  if (!source) return "";
  if (source.paperId) return "paper:" + source.paperId;
  if (source.contentHash) return "hash:" + source.contentHash;
  if (source.localPath) return localDocKey(source.localPath);
  const len = (source.data && source.data.byteLength) || 0;
  return String(source.name || "doc") + ":" + len;
}

export function readerDocKeyCandidates(source) {
  if (!source) return [];
  const out = [];
  const push = (k) => { if (k && !out.includes(k)) out.push(k); };
  if (source.paperId) push("paper:" + source.paperId);
  if (source.contentHash) push("hash:" + source.contentHash);
  if (source.localPath) {
    push(localDocKey(source.localPath));
    const fwd = "local:" + String(source.localPath).replace(/\\/g, "/");
    push(fwd);
    if (/^local:[A-Z]:\//.test(fwd)) push("local:" + fwd[6].toLowerCase() + fwd.slice(7));
    push("local:" + String(source.localPath).trim());
  }
  push(readerDocKey(source));
  return out;
}
