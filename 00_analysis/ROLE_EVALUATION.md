# 会议 4 · 接线与验收会 · 多角色评议（synra_patch_lumina_live）

> 前三场会（需求 / 方案 / 实现蓝图）已把"随口描述的功能"压成可执行契约，引擎与契约层也已编码并通过 190 项测试。
> 但审计发现：**跑起来的 UI（Observatory.jsx）从未调用过真实引擎**——结果是写死的 `PAPERS`，取全文是 `setTimeout` 假装的。
> 真引擎在 preload 桥后面闲置。本场会专办一件事：**把 UI 接到真引擎，并定义"算不算实现"的验收线**。

---

## 0. 自适应选角（按本任务的轴）

本任务不是"设计新东西"，而是"把两半已存在的桥接上、并诚实标注哪段没在沙箱验过"。轴 = 集成正确性 × 契约保真 × 验收可判定 × 诚实边界。据此选角：

| 角色 | 关注 | 在本场的职责 |
|---|---|---|
| **R-Integration（集成工程师）** | 前后端接缝、状态流 | 设计桥接层与 hasBackend 双模 |
| **R-Contract（契约审查）** | IPC 入参/返回、字段保真 | 出「契约对接表」，逐通道核对 |
| **R-Verify（验收设计）** | 何为"通过" | 定端到端验收标准与 P0 清单 |
| **现实承重墙** | 沙箱真能验什么 | 划"结构可验 / 须真机验"的界 |
| **对抗者** | 失败模式 | 跑 Pre-mortem，逼出降级路径 |
| **范式局外人** | 接线会不会破坏产品诚实 | 守红线在真实路径上仍成立 |
| **红线审计** | 一票否决项 | OA-only / AI 不裁判 / 密钥不落库 |

---

## 1. R-Integration：桥接层与双模设计

**问题**：把 `window.luminaApi.*` 散落到 1100 行 UI 各处，既难审计又难回退；且纯浏览器预览（无 Electron）会全线崩。

**决议**：新增**单一桥接层** `src/ui/lumina-bridge.js`：
- `hasBackend()` = `!!window.luminaApi`。UI 各处按 `const live = hasBackend()` 分支：**有 Electron 走真引擎，无则回退 mock 演示**——同一份代码两种模式都完整可用，且结构可验。
- 所有 IPC 访问收敛到 `bridge.*`，UI 不直接碰 `window.lumina*`。
- 三个适配器把"真实契约形状"翻译成"UI 既有组件期望形状"，从而**不重写** Card/Drawer/Today：
  - `toCardModel(paper)`：真实 `Paper`（`studyTypes[]/oaStatus/oaUrl/journalAbbrev/citationCount/language`）→ UI 卡片（`type/oa/abbr/cites/lang/matched`）。
  - `toCoreSub/fromCoreSub`：UI 扁平订阅（`freq/time/channels`）↔ 核心 `Subscription`（`schedule:{freq,time,tz}` + `query` 信封）。
  - `digestItemToCard`：轻量 `DigestItem` → 卡片。

**接缝清单**（mock → 真引擎，全部带 live 分支与回退）：检索结果 / 订阅增删与载入 / 单篇总结 / 取全文 / 收藏·筛选落库 / 今日推送 / 导出 / 设置。

---

## 2. R-Contract：契约对接表（逐通道核对）

> 这是本场会的核心交付：每个 UI 表面对应哪个 IPC、哪个 core 函数、回什么、UI 怎么渲染。**任何一行对不上就是空转。**

| UI 表面 | 桥方法 | IPC 通道 | core 落点 | 返回 | UI 渲染 |
|---|---|---|---|---|---|
| 检索框 + facet | `bridge.searchOnline(q,filters)` | `search:online`（已扩展回 `papers`）| `aggregateSearch` → upsert | `{perSource,count,papers}` | `setPapers` → 既有 facet/排序 |
| 文献卡「获取全文」| `bridge.fetchFullText(card)` | `oa:resolve`（新增）+ `oa:fetchPdf` | `resolveOa`（deny-gated）| `url` / `null` | OK/`无 OA`/失败 三态 toast |
| 抽屉「生成总结」| `bridge.summarize(id,opts)` | `summarize:paper` | `summarizeGrounded` | `{summaryText,sourceBasis,model,grounded}` | 正文 + 依据徽章 + grounding% + 撤稿横幅 |
| 收藏 / 待筛·纳入·排除 | `bridge.setState(id,patch)` | `state:set` | `paper_state`（**仅人工**）| `true` | 即时 toast |
| 订阅 新建/编辑/删除 | `bridge.subsSave/subsRemove` | `subs:save` / `subs:remove` | `store.subs` | — | 保存后 `subsRunNow` 试跑 |
| 今日推送 | `bridge.subsRunNow(id)` + `onDigest` | `subs:runNow` / 事件 | `scheduler.runNow` | `RunResult{digest:{items}}` | 按订阅渲染 DigestItem + 刷新 |
| 导出 | `bridge.exportPapers(ids,fmt)` | `export:papers` | `exportPapers` | BibTeX/RIS/CSV 文本 | Blob 下载 |
| 设置（LLM/邮箱）| `bridge.getSettings/saveSettings/setSecret` | `settings:*` / `secrets:set` | `loadAppSettings` / 钥匙串 | — | 面板表单 |

**字段保真校验**（R-Contract 抽样）：
- `SummarizeOptions` UI→核心：`pdf→fetchPdf`、`lang→language`、补 `scope:"manual"`，其余枚举同名透传。✓
- `Subscription`：`freq:"realtime"` → 核心无此枚举，映射为 `hourly + everyMinutes:15`；`channels` 暂存进 `query` 信封（见保留异议）。
- `oaStatus` 六值 → UI 三档（gold / green·hybrid·bronze→green / 其余→closed）。

---

## 3. R-Verify：端到端验收标准

**结构可验（本沙箱，verify-lumina-live.mjs 自动）**：桥存在并封装 luminaApi/luminaOa；UI 走 `live` 分支调 `bridge.*`；结果由 `papers` 状态驱动而非 `PAPERS`；ipc 回 `papers` + `oa:resolve`；preload 暴露 `resolve`；loading/错误/空态齐；红线与 UX 不回归。

**端到端验收（须用户真机，EXIT_CRITERIA 第三层 P0）**：
1. 输入真实检索式 → 列表出现**真实 PubMed/OpenAlex 命中**（非 mock 15 条）。
2. 对一篇 OA 文献点「获取全文」→ 真实抓到合法 OA PDF；对闭门文献 → 提示机构访问，**绝不**走影子源。
3. 配置 LLM 后点「生成总结」→ 真实模型输出，依据徽章随全文/摘要正确切换，grounding% 显示。
4. 新建订阅 → 重启应用仍在（落库）；到点/手动 runNow → 今日推送出现**真实当日新发表**。
5. 导出选中 → 文件可被 Zotero/EndNote 导入。
6. 设置里的密钥**只进钥匙串**，配置文件无明文。

---

## 4. 对抗者 · Pre-mortem（假设全崩，逐一给降级）

| 失败场景 | 后果 | 已内置的降级 |
|---|---|---|
| 未配置 LLM key | summarize 抛错 | 抽屉显式提示"去设置配置 LLM"，不静默 |
| OA 解析取不到 | 全文获取失败 | `fetchFullText` 回 `{ok:false,reason:"no_oa"}` → 提示机构访问 |
| 检索接口慢/超时 | UI 卡死假象 | 防抖 350ms + loading 态 + error 态 + 可重试 |
| 外部源限流(429) | 部分源无结果 | 引擎层退避+缓存（M1 已测）；UI 显示已得结果 |
| 每订阅独立推送通道 | channels 不生效 | **暂存不路由**（保留异议①），UI 仍可填 |
| 主题选择刷新即丢 | 体验割裂 | **保留异议②**：未接持久化 |
| 纯浏览器打开 | 无引擎 | hasBackend=false → 全量 mock 演示，不崩 |
| 撤稿文献被总结 | 误导风险 | grounded 层回撤稿横幅 + 卡片撤稿徽章 |

---

## 5. 范式局外人 + 红线审计：真实路径上红线仍成立？

- **AI 不裁判**：`onScreen` 在 live 下调 `setState(screening)`——纳入/排除写的是**人点的结果**；AI 只在 `summarize` 产出"带依据的提示"，措辞为提示而非裁决。✓
- **仅合法 OA**：取全文唯一路径是 `resolveOa`(deny-gated) → `oaUrl` → `fetchPdf`；桥内无任何影子源字样。✓
- **密钥不落库**：API key 经 `setSecret(`${provider}_key`)` 进钥匙串；`saveSettings` 只存 provider/model/邮箱等非密项。✓
- **preprint/撤稿标注**：卡片与抽屉徽章逻辑沿用，digest 项带 `sourceBasis`。✓

红线在接线后**未被削弱**。范式局外人补一句：接线让产品从"演示"变"可用"，但"可用"的边界必须当面讲清——见下。

---

## 6. 保留异议（诚实记录，不和稀泥）

1. **每订阅独立推送通道未路由**：核心 `Subscription` 契约里没有 per-sub channels，通知层目前是设置级。本补丁把 channels 暂存进 `query` 信封以便往返显示，但**不会真的按订阅分别投递**——要实现需改 notify 层读取 per-sub 通道。UI 已就绪，后端差一小步。
2. **主题选择未持久化**：刷新回默认。属 UX 完善项，非接线核心，留待下一包（可经 `saveSettings` 存 themeId）。
3. **沙箱从未对真网/真 key/真 PDF 跑过**：本环境无网络、无 LLM 凭据。引擎逻辑是注入假适配器测过的（190 项），但"真的搜到/真的取到/真的总结"只能在你的机器验。verify 是**结构验证**，不是端到端验证——这条必须当面声明。
4. **命令面板内联文献跳转仍读 mock**：⌘K 里的快速跳转用 `PAPERS`，主检索已接真引擎；属次要入口，列为已知项。

---

## 7. 本场会结论

接线层（桥 + 适配器 + 双模）+ 引擎侧两处扩展（`search:online` 回 papers、新增 `oa:resolve`）+ 设置面板，使 UI 八个表面**全部接到真引擎**，红线在真实路径上仍成立。**"算不算实现"的判据已从"按钮在不在"升级为"端到端验收 P0 过不过"**——结构层本包自动验证全过，端到端层交付你真机按 EXIT_CRITERIA 第三层逐项核对。保留异议四条如实在册。

---

## §0 交互流表（§3.4 必含，UX+接线）

| 步骤 | 用户操作 | 1 秒内应看见 | 证据 | 缺口 |
|---|---|---|---|---|
| 订阅入口 | 点头部「订阅/推送」 | 居中弹出订阅管理器 | `SubscribeEntry`→`setSubMgr` | 无 |
| 新建订阅 | 填名+检索式→保存 | toast「订阅已保存」+ 列表新增 | `SubscriptionManager` + `subsSave` | 无 |
| 获取全文 | 点卡片金色「获取全文」 | loading→成功 toast 或机构访问提示 | `lf-act-ft` + `bridge.fetchFullText` | 无 |
| 切主题 | 点主题图标→选一套 | 圆形过渡切换全局配色 | `ThemePicker` | 无 |
| 窗口控制 | 点标题栏 –/▢/✕ | 最小化/最大化/关闭 | `TitleBar`→`luminaWin` | 无 |

### 反馈策略
- **异步/动作双反馈**：触发区 1 秒内可见变化（toast 或 loading 态），不静默。
- **空态非静默**：空订阅列表给引导文案；无效输入禁用提交而非默默无视。
- **浮层分层**：模态/弹窗/标题栏/toast 各占独立 z 层与屏幕区域，杜绝右下角互抢。
