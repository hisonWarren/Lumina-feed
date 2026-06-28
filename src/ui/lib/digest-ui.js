/** 跨订阅 DOI 去重（「今日全部」视图） */
export function dedupeDigestEntries(entries) {
  const byKey = new Map();
  for (const e of entries) {
    const key = (e.paper.doi && String(e.paper.doi).toLowerCase()) || e.paper.id;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, { paper: e.paper, subIds: [e.subId], subLabels: [e.subLabel], query: e.query });
    } else {
      if (!cur.subIds.includes(e.subId)) {
        cur.subIds.push(e.subId);
        cur.subLabels.push(e.subLabel);
      }
    }
  }
  return [...byKey.values()];
}

export const DIGEST_PAGE = 10;
