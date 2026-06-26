# 会议 6 · 设计重构与真机修缮 · 多角色评议（synra_patch_lumina_redesign）

> 你在真机跑通后给了一份极具体的清单：题目不对、文字重叠、太像 Claude、字体丑、黑边、侧栏被盖、关闭被切、主题浮层错位、缺 DeepSeek、doi 死链、默认不该有订阅、检索+全文下载才是核心。
> 并授权："不考虑成本，哪怕完全重构，只要最优方案。"
> 本场会先回答一个根本问题——**到底要不要从零重构？**——再由顶级设计师主导，逐条过。

---

## 0. 是否从零重构？（架构 × 设计 联席判定）

**结论：重构表现层，保留已验证的引擎接线。从零重写是错的。**

- 引擎（`src/core/**` 60 模块 / 190 测试）+ UI↔引擎接线（会议4 已验收，截图显示"已连接引擎"、真实命中、真实抽屉）**是工作的**。从零重写会把这些一起推倒，零收益、高风险。
- 你列的 13 个问题，**没有一个**出在引擎或接线。它们全在**表现层**：一个"为浏览器预览写死固定尺寸"的布局 bug（连带 4 个症状）、配色/字体选择、几个着陆逻辑。
- 所以"最优方案" = **把表现层当作可独立替换的壳重构**：固定尺寸 → 真实自适应窗口；Claude 味金奶油 → 编辑级冷纸 petrol；花体 → 常用专业字体；检索升为核心着陆。引擎一行不动。

> 范式局外人附议：用户说的"重构"是**观感与信息架构的重构**，不是推倒重来。把这点说清，避免为"重写"而重写。

---

## 1. R-Shell（窗口/布局工程师）：一个病根，四个症状

**诊断**：根容器写死 `.lf{ height:820px; overflow:hidden; border-radius:16px; border:1px }`——这是给**浏览器预览的固定画框**。搬进真实可调窗口（880px+，可拉伸）后：
- 圆角+边框在方形窗口里露出窗体底色 → **黑边**；
- 固定 820px 在更高窗口里不铺满，深色页面底色从四周漏出 → 同样表现为**黑边/缝隙**；
- 自定义标题栏(34px) + `height:100%` 的舞台 > 820px → 溢出，顶栏压住侧栏顶部 → **侧栏被盖**；
- 抽屉 `position:absolute; top:0` 在 `.lf` 内，被 z 更高的标题栏盖住顶部 → **关闭按钮被切**；
- 固定高度祖先 `overflow:hidden` 裁剪 + 弹性子项在被压扁容器里错位 → **列表文字重叠**。

**一刀治五病**：
```
.lf{ height:100vh; display:flex; flex-direction:column; overflow:hidden }  /* 去 820px / 圆角 / 边框 */
html,body,#root{ height:100%; margin:0 }  body{ background:#F4F4F1 }        /* 满窗 + 浅底，杜绝黑边 */
.lf-stage{ flex:1; min-height:0 }                                          /* 内容真实铺满 */
.lf-drawer,.lf-scrim{ position:fixed; top:34px }                           /* 抽屉移到标题栏之下，关闭完整 */
```
黑边、侧栏被盖、关闭被切、文字重叠——**同一个根因，一并消失**。窗口真实自适应后，缩放/最大化都正确。

> 现实承重墙：黑边的**确切**表现还取决于操作系统/窗管对无边框窗的处理。上面的 CSS 杜绝了"应用内部漏底色"这一主因；若你的系统对无边框窗仍画 1px 描边，那是 OS 层、需真机确认（见保留异议③）。

---

## 2. R-Design（主创设计师）：为什么"像 Claude"，以及怎么不像

**为什么像**：你给的对照 synra **也是暖纸色**，却不显 AI。差别不在"暖/冷"，在两点——
1. **金色强调**（`#A86E22` gold + 奶油 `#F1EFE8`）是 Claude 的视觉签名；
2. **Fraunces 花体**做正文标题，那种"光学花体"恰是"AI 生成的精致感"。

**重构决策（中国获奖级 = 克制 × 精度 × 编辑感）**：
- **配色**：默认 `晴台` = 冷中性纸 `#F4F4F1` + **深青-petrol 主色 `#0E7C6F`**（替代金）+ 石板蓝副色 `#3E5C92`。petrol 沉稳、专业、与产品名 "Observatory（天文台/观测）" 的仪器气质吻合，且**绝不撞 Claude**。证据类型语义色(--t-*)保持稳定（颜色承载含义，不随主题乱变）。
- **字体**：去 Fraunces。正文标题改 **Inter sans**（与 synra 同一专业取向，长英文标题更紧致可读，重叠观感一并消除）；衬线只留给品牌字 "Lumina Feed" 与大日期，换 **Source Serif 4**（出版级、常用、不花哨）。中文回退 PingFang / 微软雅黑。
- **强调一致性**：把散落在激活标签、分段控件、复选、滑块、主 CTA、决策键里的**写死金渐变**，全改为 `var(--gold)` 驱动 → 整套强调随主题切换；按基底分昼夜定填充文字色（深主色配白字、浅主色配深字），保证对比。
- 主题表精修为协调的三亮（晴台 petrol / 米白 clay / 青墨 ink-blue）三暗（暖夜 / 薄暮 / 松林）。

> 对抗者质疑："换成 petrol 会不会只是'另一种 AI 风'？" 回应：AI 风的根源是**金+奶油+花体**这一**特定组合**，不是"有强调色"。petrol+冷纸+Inter 是真实科研工具(Web of Science / Scopus / synra)的语言，不是助手皮肤。

---

## 3. R-IA（信息架构）：检索+全文下载是核心，必须独立于订阅

**你的原话**："我开发的主要目的就是为了全文下载文献。" 现状却把"今日推送"作默认着陆，检索藏在第二个 tab。**信息架构错位。**

**重排**：
- **默认着陆 = 探索（检索）**，不是今日推送。
- **空查询不再盲搜**（这正是"题目不对/119 本书章节"的根因——空 spec 让聚合源回吐任意近期记录）。改为：无检索式时显示**核心引导态**——"检索文献，获取合法全文 / 跨 6 源聚合 / 命中后一键取 OA 全文 PDF 或生成带依据总结"，一个"开始检索"按钮聚焦输入框。
- **检索独立于订阅**：取全文(`获取全文`)是每条结果卡上的一等操作，不依赖任何订阅。
- **今日推送降为副线**：live 无订阅时不再假装有 mock 订阅，而是空态引导——"只想检索下载？不需要订阅，切到探索直接搜。"

> R-Verify 补：空查询守卫同时修了"119 篇无关结果"和"默认有 mock 订阅"两个观感问题——它们本是同一类"未输入即造数据"的错。

---

## 4. 逐条对账（你的清单 → 处置）

| # | 你的反馈 | 根因 | 处置 |
|---|---|---|---|
| 1 | 题目不对(119 本书章节) | 空查询盲搜聚合源 | 空查询守卫 + 检索引导态 |
| 2 | 列表文字重叠 | 固定 820px 祖先裁剪 | 布局自适应(§1) |
| 3 | UI 没重构/丑 | 表现层未动 | 配色+字体+布局+IA 重构(§2/§3) |
| 4 | 默认色太 Claude | 金+奶油 | 冷纸 + petrol 主色(§2) |
| 5 | 要获奖级/可重构 | — | 表现层重构(§0) |
| 6 | 默认不该有订阅 | mock 回退 | live 不回退 mock + 空态(§3) |
| 7 | 缺检索入口/核心 | 着陆错位 | 默认探索 + 检索引导(§3) |
| 8 | doi 死链 | `href="#"` preventDefault | `shell.openExternal` 真打开(§5) |
| 9 | 英文字体丑 | Fraunces 花体 | Inter + Source Serif(§2) |
| 10 | 黑边 | 圆角+边框+固定高 | 去之 + 满窗浅底(§1) |
| 11 | 侧栏被盖/关闭被切 | 标题栏压内容/抽屉 | 弹性列 + 抽屉 top:34px(§1) |
| 12 | 主题浮层错位 | top:42px + z 低 | 锚 calc(100%+8px) + z:300 实底(§2) |
| 13 | 缺 DeepSeek | provider 仅 3 个 | 引擎+UI 加 DeepSeek/Kimi/自定义兼容(§5) |
| 14 | 参考 synra | — | 采纳其 Inter-sans + 克制强调哲学(§2) |

---

## 5. R-Integration：真机功能修缮（doi / DeepSeek）

- **doi 真打开**：主进程加 `ipcMain.handle("shell:openExternal", url ⇒ /^https?:/ 校验 + shell.openExternal)`；preload 暴露 `luminaWin.openExternal`；抽屉 doi 链接点击 → `https://doi.org/{doi}` 经默认浏览器打开（无 Electron 回退 `window.open`）。
- **DeepSeek 真能用**（非仅显示）：DeepSeek 是 OpenAI 兼容接口。引擎 `llmFromConfig` 加 `OPENAI_COMPAT_BASE`（deepseek→api.deepseek.com、moonshot→api.moonshot.cn），并把 openai/deepseek/moonshot/自定义统一走 `openaiClient(baseUrl)`；设置面板 provider 增 **DeepSeek(默认置顶)/Kimi/OpenAI 兼容(自定义 base URL)**，密钥仍进钥匙串(`deepseek_key`)。红线不破：密钥不落配置、本地 Ollama 仍全离线。

---

## 6. 保留异议（如实在册）

1. **沙箱无法渲染真机视觉**：本环境无 Electron/npm/网络，React/JSX 跑不起来。配色、字体、布局自适应、黑边、主题浮层、doi 打开、DeepSeek 端到端——**全部须你在真机确认**。verify 是**结构断言**(改对了没)，不是视觉验收(好看没/对不对)。
2. **黑边可能有 OS 残留**：CSS 已杜绝"应用内漏底色"主因；若系统对无边框窗仍画细描边，需真机看，必要时可改回原生边框(`frame:true`)——有些人反而偏好原生窗控。
3. **配色是设计判断，非唯一解**：petrol+冷纸是我基于"去 Claude × 编辑级 × 契合 Observatory"的取舍；若你想要 synra 同款砖红或别的方向，是一行强调色的事，可再调。
4. **"重构"是表现层重构**：信息架构与引擎接线保留。若你坚持要逐组件从零重写视图层，那是另一个量级的工作、且会牺牲已验证的部分——我判断不是最优，故未做（见 §0）。
5. **命令面板内联文献跳转仍读 mock**：次要入口；主检索已接真引擎。

---

## 7. 结论

不从零重写。**重构表现层、保留引擎**是此处的最优解：一个布局自适应修复消掉黑边/侧栏被盖/关闭被切/文字重叠四病；配色(petrol 替金)+字体(Inter 替花体)去掉 Claude/AI 味；信息架构把"检索+全文下载"扶正为核心着陆、空查询不再造垃圾、默认不再假装有订阅；doi 真打开、DeepSeek 真可用。13 条逐一处置在册。**所有视觉与端到端效果须真机验收**——这条必须当面说清。

---

## 接续 · 会议4 契约对接表（接线保留，重构未动引擎）

## 2. R-Contract：契约对接表（逐通道核对）

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

---

## 3. R-Verify：端到端验收标准

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
| 每订阅独立推送通道 | channels 不生效 | **暂存不路由**（保留异议），UI 仍可填 |
| 主题选择刷新即丢 | 体验割裂 | **保留异议**：未接持久化 |
| 纯浏览器打开 | 无引擎 | hasBackend=false → mock 演示，不崩 |
| 撤稿文献被总结 | 误导风险 | grounded 层回撤稿横幅 + 卡片撤稿徽章 |
| 主题浮层错位 | 用户点不到主题 | 浮层锚定按钮下方 + 最高 z 层，不静默 |
| toast 与模态互抢 | 反馈被遮挡 | 浮层分层：模态居中、toast 独立层，不静默 |

---

## §0 交互流表（§3.4 必含，UX+接线）

| 步骤 | 用户操作 | 1 秒内应看见 | 证据 | 缺口 |
|---|---|---|---|---|
| 订阅入口 | 点头部「订阅/推送」 | 居中弹出订阅管理器 | `SubscribeEntry`→`setSubMgr` | 无 |
| 新建订阅 | 填名+检索式→保存 | toast「订阅已保存」+ 列表新增 | `SubscriptionManager` + `subsSave` | 无 |
| 获取全文 | 点卡片「获取全文」 | loading→成功 toast 或机构访问提示 | `lf-act-ft` + `bridge.fetchFullText` | 无 |
| 切主题 | 点主题图标→选一套 | 圆形过渡切换全局配色 | `ThemePicker` | 无 |
| 窗口控制 | 点标题栏 –/▢/✕ | 最小化/最大化/关闭 | `TitleBar`→`luminaWin` | 无 |

### 反馈策略
- **异步/动作双反馈**：触发区 1 秒内可见变化（toast 或 loading 态），不静默。
- **空态非静默**：空订阅列表给引导文案；无效输入禁用提交而非默默无视。
- **浮层分层**：模态/弹窗/标题栏/toast 各占独立 z 层与屏幕区域，杜绝右下角互抢。
