import { pickPrimaryHit } from "../src/core/locate/primary-hit.ts";
import { bm25Rank, parseQuery } from "../src/core/rank/bm25.ts";

const papers = [{ id: "1", title: "Pfizer COVID vaccine efficacy in children aged 5-11 years." }];
console.log("pickPrimary", pickPrimaryHit(papers, "covid vaccine efficacy"));
console.log("bm25", bm25Rank(papers, parseQuery("covid vaccine efficacy", "all"))[0]?.matchKind);
