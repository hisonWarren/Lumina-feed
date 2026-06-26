# Lumina Feed

**本地优先的文献发现与每日推送**——从随口描述的需求，经多角色评议压成工程契约，落成一套可运行、可验证的产品内核。

> 一条命令验证全部：`npm run verify` → **190 passed, 0 failed**（六个里程碑行为门，沙箱内用 `node:sqlite` 真跑，无需安装任何依赖）。

```
  Lumina Feed · 全里程碑验证
  ──────────────────────────────────────────────
  ✓ M1 数据底座              40 passed    [PASS]
  ✓ M3 合法 OA 全文          19 passed    [PASS]
  ✓ M4 总结管线              40 passed    [PASS]
  ✓ M5 调度 + 推送           42 passed    [PASS]
  ✓ M6 导出                19 passed    [PASS]
  ✓ 证据可信性                30 passed    [PASS]
  ──────────────────────────────────────────────
  合计：190 passed, 0 failed  →  全部通过 ✅
```

---

## 里程碑状态

| 里程碑 | 内容 | 状态 |
|---|---|---|
| **M1 数据底座** | SQLite+FTS5 + 六源适配器(PubMed/EuropePMC/Crossref/OpenAlex/arXiv/bioRxiv) + 归一化/去重/preprint↔published 版本归并 | ✅ 40/40 |
| **M2 探索台** | 数据库式列表 + facet + 排序 + 详情抽屉（获奖级 React 原型） | ✅ 原型 `src/ui/Observatory.jsx` |
| **M3 合法 OA 全文** | 多源 OA 解析 + PDF 抓取桥(Electron net / web 降级) + zlib/pdfjs 抽取，硬拒影子库 | ✅ 19/19 |
| **M4 总结管线** | 可插拔 LLM(anthropic/openai/ollama) + 四档模板 + 全文/摘要回退 + 依据徽章 + 缓存 | ✅ 40/40 |
| **M5 调度 + 推送** | 开机自启 + 后台定时本地通知(B) + 邮件/Telegram/Webhook 自托管 worker(C) + 漏跑追赶 | ✅ 42/42 |
| **M6 导出 + 趋势** | BibTeX/RIS/CSL-JSON 导出 + 年/类型/期刊趋势统计 | ✅ 19/19 |
| **证据可信性**（深化） | claim 级 grounding + 数字保真核验 + 暴露不改写 + 撤稿前置 + 审计留痕 | ✅ 30/30 |

---

## 全链路

```
                         ┌──────────────────── Electron 壳 (electron/) ────────────────────┐
  订阅(QuerySpec)          │  main.ts 总装 · preload(contextBridge) · ipc 路由 · 托盘 · 自启     │
        │                 └───────────────────────────────────────────────────────────────┘
        ▼
  Scheduler(M5) ──tick(60s)+catch-up──▶ runSubscriptionDigest
        │                                   │
        │            M1: selectAdapters→并发检索(部分成功)→归一化→去重/版本归并→FTS5 入库
        │                                   │
        │            M3: prefer_fulltext → resolveOa(守门)→fetchPdf(桥/降级)→抽取 → 合法 OA 全文
        │                                   │
        │            M4: 可插拔 LLM → 四档模板 → 全文/摘要回退 → tldr + 依据徽章
        │                                   │
        │            可信: 切句→grounding(覆盖率)+数字核验→暴露不改写→撤稿前置→审计留痕
        │                                   ▼
        └──── seenIds 去重 ───▶ Digest ──▶ Notifier(M5) ─ native / email / telegram / webhook
                                          │
                              M6: 任意结果集 → BibTeX/RIS/CSL-JSON 导出 + 趋势图
```

---

## 目录

```
lumina-feed/
├── electron/                 # 桌面壳：总装 + IPC + preload + 设置（集成层）
│   ├── main.ts  ipc.ts  preload.ts  settings.ts
├── src/core/
│   ├── model.ts  querySpec.ts  normalize.ts  dedupe.ts  aggregate.ts  digest.ts
│   ├── sources/              # 六源适配器（统一 SourceAdapter，fetch 可注入）
│   ├── store/                # SqliteDb 抽象(better-sqlite3/node:sqlite) + FTS5 + 仓库
│   ├── summarize/            # M4 可插拔 LLM + 模板 + 回退 + 缓存 + OA 守门
│   ├── oa/                   # M3 OA 解析 + PDF 抓取 + 抽取 + provider + 桥
│   ├── trust/                # 证据可信性 grounding + 数字核验 + 审计
│   ├── schedule/             # M5 调度判定 + Scheduler + 自启
│   ├── notify/               # M5 Notifier + 四通道 + 钥匙串
│   └── export/               # M6 BibTeX/RIS/CSL-JSON + 趋势
├── src/ui/Observatory.jsx    # M2 探索台原型
├── worker/                   # M5 自托管推送 worker(C) + systemd/Docker
├── tools/                    # 六个行为门 + verify-all 总验证
└── docs/                     # 多角色评议总卷（需求来源）
```

---

## 运行

```bash
node -v                       # ≥ 22.18
npm run verify                # 全部门禁 → 190 passed（用内置 node:sqlite，零安装）

# 桌面端（生产）
npm i better-sqlite3 electron pdfjs-dist nodemailer auto-launch keytar
# electron . 启动；main.ts 自动总装 store/调度/OA/总结/可信/推送

# 自托管推送 worker（C，24/7，不依赖桌面）
LUMINA_CONFIG=worker/config.json npm run worker:once   # 配 cron / systemd timer
```

各核心层零运行时依赖：检索/守门/导出用 global fetch + 纯 JS；存储用 node:sqlite（生产换 better-sqlite3 不改代码）；PDF 抽取内置 zlib（复杂 PDF 注入 pdfjs）。

---

## 贯穿红线（评议确立，全程未破）

- **合法 OA only**：全文必经 `isLegitimateOaUrl`，**硬拒 Sci-Hub/LibGen/Anna's Archive**；推送只含元数据+总结+链接，不夹带版权全文。
- **AI 参谋不裁判**：AI 只排序/总结，**纳入/排除永远人工**（`paper_state.screening`）；证据层「暴露不改写」——标记幻觉但绝不替你删改。
- **反幻觉**：每条总结标 `sourceBasis`（全文/摘要）；**数字保真确定性核验**（编造数字当场抓）；claim 级 grounding 可定位原文；撤稿最显眼。
- **守 ToS**：礼貌署名(NCBI tool+email / Crossref·OpenAlex mailto) + 限速 + 缓存；单源失败不拖垮整份（部分成功）。
- **密钥安全**：桌面进系统钥匙串，worker 进环境变量，绝不明文落库。
- **本地优先**：数据在你机器上；默认不提供托管云，不替你承担 key/成本/合规。

---

## 文档

- `docs/文献发现与每日推送_多角色评议总卷.md` —— 产品总卷（7 角色 4 会议 → 架构 + 里程碑）。
- `docs/证据可信性_多角色评议.md` —— 证据可信性深化评议。
- `ARCHITECTURE.md` —— 跨里程碑的模块契约与关键时序。
