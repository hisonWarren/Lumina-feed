# 架构说明 · Lumina Feed（全景）

跨里程碑的契约如何串成一条数据流，以及集成时的关键约定。各里程碑内部细节见对应来源包/各 `*.ts` 注释。

## 1. 契约链（一条订阅如何走完全程）

```
QuerySpec ─(querySpec.ts: 各源翻译)─▶ SourceAdapter.search → SearchHit[]
SearchHit[] ─(normalize.ts)─▶ Paper ─(dedupe.ts: 去重键 + relatedDoi 版本归并)─▶ Paper[](合并)
Paper[] ─(store/papers.repo: ON CONFLICT upsert + FTS5 触发器)─▶ 入库
runSubscriptionDigest → DigestItem[](tldr/sourceBasis 初始空)
   └ M4 enrichDigestItems(getPaper, opts, {llm, fullText, cache}) → 填 tldr + sourceBasis
        └ M3 FullTextProvider(prefer_fulltext): resolveOa→fetchPdf→extractText（守门贯穿）
   └ 证据可信: summarizeGrounded → GroundedSummary(claims/groundedRatio/flagged/annotated)
DigestItem[] ─ Scheduler(seenIds 去重) ─▶ Digest ─ Notifier(format→fan-out) ─▶ 渠道
Paper[] ─ M6 exportPapers(format) ─▶ BibTeX/RIS/CSL-JSON
```

## 2. 关键类型（跨层共享）

- `Paper`（model.ts）：归一化入库模型，含 `versions[]`/`relatedDoi`/`retracted`/`oaUrl`。
- `DigestItem`（schedule/types.ts）：推送/卡片单元；`tldr`/`sourceBasis` 由 M4 填。
- `Subscription`（schedule/types.ts）：`query: QuerySpec` + `schedule` + `summarize: SummarizeOptions`。
- `SqliteDb`（store/db.ts）：薄接口，better-sqlite3 与 node:sqlite 同时满足 → 同一套仓库代码生产/测试通用。
- `LlmClient` / `FullTextProvider` / `SummaryCache`（summarize/types.ts）：M4 的注入点；M3 实装 FullTextProvider。

## 3. 集成约定（合并六包时需对齐的点）

1. **单一 `schedule/types.ts`**：所有包共享同一份（Subscription/DigestItem/Digest）。
2. **`store/db.ts` 的 summaries 表**含 `structured_json`/`caveats_json`（M4 引入），并由 trust 复用思路；`groundings` 表由 trust 的 `ensureGroundingTable` 惰性建。
3. **`sources/europepmc.ts`** 同时导出 M1 的 `europepmcAdapter`/`parseEuropePmc`（聚合用）与 M5 的 `searchEuropePmc`（worker/推送用）——合并时二者并存，避免其一缺失。
4. **OA 守门单一来源**：`summarize/oa-guard.ts` 的 `isLegitimateOaUrl`，M3 的 resolver/fetch 与 Electron 桥三处复用。
5. **`runDigest` 组合**：`runSubscriptionDigest`(M1) 之后串 `enrichDigestItems`(M4) ，全文经 M3 provider，可信经 trust；见 `electron/main.ts` 的 `buildScheduler`。

## 4. 关键时序

- **catch-up**（M5）：`Scheduler.start()` 与 worker `--once` 都先 `tick()` 一次；due 用「最近应跑实例 vs lastRun」判定，错过的实例下次唤醒补发一次（非每天各补）。
- **部分成功**（M1/M5）：多源/多通道均 `Promise.allSettled`，单点失败标记不抛，不拖垮整份简报。
- **FTS5 稳定 rowid**（M1）：用 `ON CONFLICT DO UPDATE`（非 `INSERT OR REPLACE`）+ 触发器，避免 rowid 漂移导致索引失配。
- **数字核验不可被推翻**（trust）：LLM 蕴含校验只升级「词面弱」句，数字核验失败的句子永不升到 grounded。
- **暴露不改写**（trust）：不支持/存疑句保留原样 + 显眼标记；系统从不删改/裁定。

## 5. 验证矩阵（190）

| 门禁 | 数 | 真跑要点 |
|---|---|---|
| verify-data-core | 40 | node:sqlite 上 FTS5 检索/facet/upsert 幂等 + 六源解析 + 版本归并 |
| verify-oa-fulltext | 19 | 自造 FlateDecode PDF zlib 抽取往返 + 守门 + 接 M4 全文级总结 |
| verify-summarize | 40 | 三家 LLM 请求形状 + 护栏 + 全文/摘要回退 + node:sqlite 缓存往返 |
| verify-scheduler-push | 42 | 时区/安静/catch-up + 四通道经真 HTTP(含 HMAC) + 部分失败 |
| verify-export | 19 | BibTeX/RIS/CSL-JSON 正确性 + preprint 标注 + 趋势 |
| verify-trust | 30 | 确定性 grounding + 数字核验(编造即抓) + 暴露不改写 + 审计不存全文 |

`node tools/verify-all.mjs` 聚合运行，全绿。
