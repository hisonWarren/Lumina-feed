// 定位流：Title Fast Lane（并行） + 现有多源 aggregateStream（并行）
import type { QueryFilters } from "../querySpec.ts";
import { rawToSpec } from "../querySpec.ts";
import type { SearchOpts } from "../sources/adapter.ts";
import type { Paper } from "../model.ts";
import { aggregateSearchStream, type AggregateResult } from "../aggregate.ts";
import { titleFastLane } from "./title-fast-lane.ts";
import { isTitleLikeQuery, titleQueryText } from "./title-like.ts";
import { pickPrimaryHit } from "./primary-hit.ts";

export type LocateStreamPayload = {
  papers: Paper[];
  perSource?: AggregateResult["perSource"];
  done: boolean;
  locateMode?: "keyword" | "primary";
  primaryPaperId?: string;
  primaryAmbiguous?: boolean;
  resolvedFrom?: string[];
  source?: string;
};

function payloadFromSnapshot(
  papers: Paper[],
  perSource: AggregateResult["perSource"],
  titleQ: string,
  field: string,
  partial: Omit<LocateStreamPayload, "papers" | "perSource">,
): LocateStreamPayload {
  const primary = pickPrimaryHit(papers, titleQ, field as "all");
  const resolvedFrom = Object.entries(perSource)
    .filter(([, v]) => v?.ok && (v.count ?? 0) > 0)
    .map(([k]) => k);
  return {
    papers,
    perSource,
    ...partial,
    locateMode: primary ? "primary" : partial.locateMode ?? "keyword",
    primaryPaperId: primary?.paperId,
    primaryAmbiguous: primary?.ambiguous,
    resolvedFrom: resolvedFrom.length ? resolvedFrom : partial.resolvedFrom,
  };
}

export async function runLocateKeywordStream(
  raw: string,
  filters: QueryFilters,
  opts: SearchOpts,
  send: (p: LocateStreamPayload) => void,
  localSearch?: (titleQ: string) => Paper[],
): Promise<AggregateResult> {
  const spec = rawToSpec(raw, filters);
  const field = spec.filters.field ?? "all";
  const titleQ = titleQueryText(raw);
  const titleLike = isTitleLikeQuery(raw, field);

  let mergedPerSource: AggregateResult["perSource"] = {};

  if (titleLike && titleQ.length >= 8) {
    const locals = localSearch ? localSearch(titleQ) : [];
    const fast = await titleFastLane(spec, titleQ, opts, locals);
    mergedPerSource = { ...fast.perSource };
    if (fast.papers.length) {
      send(payloadFromSnapshot(fast.papers, mergedPerSource, titleQ, field, {
        source: "title_fast_lane",
        done: false,
        locateMode: "primary",
      }));
    }
  }

  const agg = await aggregateSearchStream(spec, opts, (source, snapshot, perSource) => {
    mergedPerSource = { ...mergedPerSource, ...perSource };
    send(payloadFromSnapshot(snapshot, mergedPerSource, titleQ, field, {
      source,
      done: false,
      locateMode: titleLike ? "primary" : "keyword",
    }));
  });

  mergedPerSource = { ...mergedPerSource, ...agg.perSource };
  send(payloadFromSnapshot(agg.papers, mergedPerSource, titleQ, field, {
    done: true,
    locateMode: titleLike && pickPrimaryHit(agg.papers, titleQ, field as "all") ? "primary" : "keyword",
  }));
  return { ...agg, perSource: mergedPerSource };
}
