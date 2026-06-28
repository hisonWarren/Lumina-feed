// USP · Sci-Hub 搜索桩：仅 DOI 标识符命中（无关键词检索）
import type { SearchHit } from "../model.ts";
import type { QuerySpec } from "../querySpec.ts";
import { parseIdentifier } from "../locate/parse-identifier.ts";
import type { SourceAdapter, SearchOpts } from "./adapter.ts";

export const scihubAdapter: SourceAdapter = {
  id: "scihub",
  async search(q: QuerySpec, _opts: SearchOpts = {}): Promise<SearchHit[]> {
    const raw = (q.raw ?? "").trim();
    const id = parseIdentifier(raw);
    if (!id || id.kind !== "doi") return [];
    return [{
      source: "scihub",
      doi: id.normalized,
      title: raw.includes("10.") ? raw : `DOI ${id.normalized}`,
      authors: [],
      isPreprint: false,
      peerReviewed: false,
    }];
  },
};
