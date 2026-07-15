import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const R = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
console.log("── reader_plus_vision（P5 读图 + 图表分析）契约自检 ──");
for (const f of ["src/core/summarize/types.ts", "src/core/summarize/llm-client.ts", "src/core/reader/reader-plus.ts", "electron/ipc.ts"]) {
  try { execSync("node --experimental-strip-types --check " + f, { stdio: "pipe" }); ok(true, f.split("/").pop() + " strip-types"); } catch { ok(false, f.split("/").pop() + " strip-types"); }
}
try { execSync("node --check src/ui/pdf-engine.js", { stdio: "pipe" }); ok(true, "pdf-engine.js node --check"); } catch { ok(false, "pdf-engine.js node --check"); }
const ty = R("src/core/summarize/types.ts");
ok(/images\?:\s*string\[\]/.test(ty), "LlmCompleteOpts 增 images?（dataURL 数组）");
const lc = R("src/core/summarize/llm-client.ts");
ok(/function dataUrlParts/.test(lc) && /function lastUserIdx/.test(lc), "llm-client 视觉工具（dataUrlParts/lastUserIdx）");
ok(/type: "image", source: \{ type: "base64"/.test(lc), "anthropic 附 base64 图块");
ok(/type: "image_url", image_url:/.test(lc), "openai 附 image_url");
ok(/images: b64/.test(lc), "ollama 附 images（本地视觉）");
const pe = R("src/ui/pdf-engine.js");
ok(/export async function renderRegion/.test(pe) && /toDataURL\("image\/png"\)/.test(pe), "pdf-engine renderRegion（归一 bbox 高清渲染→PNG）");
const rp = R("src/core/reader/reader-plus.ts");
ok(/export async function analyzeFigure/.test(rp), "reader-plus analyzeFigure");
ok(/sourceBasis: "fulltext\+vision"/.test(rp), "图表信封 sourceBasis 标 fulltext+vision");
ok(/制作工具推测[^]*confidence: "c3"/.test(rp) && /可观察风格[^]*confidence: "c1"/.test(rp), "风格 c1（可观察）/ 工具 c3（不可确证）分别标把握度");
ok(/figure:\s*\{ lane: "inference"/.test(rp), "figure 仍推断车道（KIND_REGISTRY）");
const ipc = R("electron/ipc.ts");
ok(/reader:figure/.test(ipc) && /analyzeFigure/.test(ipc), "ipc reader:figure → analyzeFigure");
ok(/provider === "ollama"/.test(ipc) && /visionConsent/.test(ipc) && /!isLocal && !consent/.test(ipc), "隐私闸：本地直放 / 云端需 visionConsent（红线7）");
ok(/refused:.*云端视觉模型/.test(ipc), "未授权返回拒绝信封（图像授权前不出本机）");
const pre = R("electron/preload.ts"); ok(/figure:.*reader:figure/.test(pre), "preload 暴露 figure");
const br = R("src/ui/lumina-bridge.js"); ok(/async readerFigure/.test(br) && /kind === "figure"/.test(br), "bridge readerFigure + figure mock");
const rd = R("src/ui/modules/Reader.jsx");
ok(/renderRegion } from "..\/pdf-engine.js"/.test(rd), "Reader 导入 renderRegion");
ok(/const doFigure = useCallback/.test(rd) && /bridge\.readerFigure\(dataUrl/.test(rd), "doFigure：已有 dataUrl → readerFigure");
ok(/rd-snip-acts/.test(rd) && /onSnipCopy/.test(rd) && /onSnipSave/.test(rd) && /分析图表/.test(rd), "框选后动作条：复制/保存/分析图表");
ok(/reader:copyImage/.test(ipc) && /reader:saveImage/.test(ipc), "ipc reader:copyImage + reader:saveImage");
ok(/copyImage:.*reader:copyImage/.test(pre) && /saveImage:.*reader:saveImage/.test(pre), "preload 暴露 copyImage/saveImage");
ok(/async readerCopyImage/.test(br) && /async readerSaveImage/.test(br), "bridge readerCopyImage/SaveImage");
ok(/框选/.test(rd) && !/> 截图</.test(rd), "工具栏文案为「框选」而非独占「截图」");
ok(/<InfCard env=\{figureEnv\}/.test(rd), "图表结果走 InfCard（env.lane inference 路由，HC-1 不破）");
const st = R("src/ui/modules/Settings.jsx");
ok(/const \[visionConsent/.test(st) && (/onToggleVisionConsent/.test(st) || /persistSettings/.test(st)) && /云端读图开关/.test(st), "Settings 云端读图授权开关 + 持久化到 llm.visionConsent");
ok(!/&&\s*(AssistantPanel|InfCard|InfBody|EvidenceCard|EnvelopeCard|ReaderPanel|EvidencePane|InferencePane|InfAnalyzer)\(/.test(rd), "无危险 Hook 条件调用");
console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
