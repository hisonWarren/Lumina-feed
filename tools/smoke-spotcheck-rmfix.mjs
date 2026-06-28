#!/usr/bin/env node
/** 真机 spot-check：realmachine_fixes + shell_redesign（无需 LUMINA_TEST_KEY，用钥匙串） */
const CDP = "http://127.0.0.1:9222";
const pass = (m) => console.log("  ✓ " + m);
const fail = (m) => { console.log("  ✗ " + m); process.exitCode = 1; };

const list = await (await fetch(`${CDP}/json/list`)).json();
const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
if (!page) throw new Error("Electron CDP 未就绪");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
let nextId = 1;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.id && pending.has(msg.id)) {
    const { resolve: res, reject: rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = nextId++;
  pending.set(id, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id, method, params }));
});
await send("Runtime.enable");
const evalJs = async (expr) => {
  const { result, exceptionDetails } = await send("Runtime.evaluate", {
    expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true,
  });
  if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
  return result.value;
};

console.log("\n── 真机 spot-check（shell + realmachine_fixes）──\n");

const shell = await evalJs(`
  return {
    logo: !!document.querySelector('.lf-logo'),
    tagline: (document.querySelector('.lf-wm .tg')||{}).textContent||'',
    nav: document.querySelectorAll('.lf-tab').length,
    status: (document.querySelector('.lf-status')||{}).textContent||'',
    themeBtn: !!document.querySelector('.lf-icon[title="主题"]'),
  };
`);
shell.logo && shell.tagline.includes("Locate") ? pass("shell：真 logo + tagline") : fail("shell logo/tagline");
shell.nav === 4 ? pass("shell：四 tab 居中导航") : fail("shell nav count=" + shell.nav);
shell.status.includes("本机") ? pass("shell：状态药丸") : fail("shell status");
shell.themeBtn ? pass("shell：顶栏主题色板入口") : fail("shell theme");

await evalJs(`
  const b = document.querySelector('.lf-icon[aria-label="设置"]');
  b.click();
  return true;
`);
await new Promise((r) => setTimeout(r, 400));
const warn = await evalJs(`return !!document.querySelector('.set-warn');`);
warn ? pass("ISSUE-001：DeepSeek 开读图时 Settings 警告可见") : fail("Settings 无 .set-warn");

const tiny = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
await evalJs(`const s=await window.luminaApi.getSettings(); s.llm={...s.llm,visionConsent:true}; await window.luminaApi.saveSettings(s);`);
const fig = await evalJs(`return await window.luminaReader.figure(${JSON.stringify(tiny)}, "test");`);
fig?.refused?.reason ? pass("ISSUE-001：figure 拒绝信封 — " + fig.refused.reason.slice(0, 50) + "…") : fail("figure 应 refused，得 " + JSON.stringify(fig).slice(0, 80));

const pages = [{ page: 1, text: "Introduction. N=500 participants (250 treatment, 250 placebo)." }, { page: 2, text: "Methods. p=0.042 efficacy 68%." }];
const sum = await evalJs(`return await window.luminaReader.summarize({ pages: ${JSON.stringify(pages)} });`);
(sum?.groundedRatio ?? 0) > 0 ? pass("ISSUE-003：groundedRatio=" + sum.groundedRatio) : fail("groundedRatio 仍为 0");

const test = await evalJs(`return await window.luminaApi.testLlm({});`);
test?.ok ? pass("llm:test 钥匙串 — " + test.model + " · " + test.ms + "ms") : fail("llm:test " + JSON.stringify(test));

ws.close();
console.log("\nspot-check 完成\n");
