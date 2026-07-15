/**
 * v0.4.98 真机烟测（CDP 9222）：标签右键菜单文案、无 MAX_TABS 硬拦、镜像默认、DOIcoerce（结构侧）。
 * 用法：先启动 electron --remote-debugging-port=9222，再 node tools/smoke-v0498.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

console.log("\n── v0.4.98 结构烟测 ──\n");
const hub = readFileSync(join(root, "src/ui/modules/ReadHub.jsx"), "utf8");
const mirrors = JSON.parse(readFileSync(join(root, "src/core/oa/config/alt-mirrors.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const parse = readFileSync(join(root, "src/core/locate/parse-identifier.ts"), "utf8");
const mh = readFileSync(join(root, "src/core/oa/mirror-health.ts"), "utf8");
const alt = readFileSync(join(root, "src/core/oa/alt-sources.ts"), "utf8");

ok(pkg.version === "0.4.98", "version 0.4.98");
ok(!hub.includes("const MAX_TABS = 6"), "无 MAX_TABS=6");
ok(hub.includes("关闭其他标签页") && hub.includes("关闭左侧标签页") && hub.includes("关闭右侧标签页"), "标签右键四项");
ok(hub.includes("tabs-dense") && hub.includes("TAB_SOFT_WARN"), "收缩密度 + 软提示");
ok(mirrors.scihub_mirrors.includes("https://sci-hub.jp") && mirrors.scihub_mirrors.includes("https://sci-hub.ee"), "默认 Sci-Hub 含 jp/ee");
ok(mirrors.libgen_mirrors.includes("https://libgen.bz"), "默认 LibGen 含 bz");
ok(mh.includes("[...custom, ...defaults]"), "镜像 union merge");
ok(parse.includes("coerceDoiCandidate"), "DOI coerce");
ok(alt.includes("extractPdfUrlFromHtml") && alt.includes("<object"), "Sci-Hub object 解析");
ok(existsSync(join(root, "electron/safe-fetch.ts")), "ByteString safe-fetch");

// CDP optional
const CDP = "http://127.0.0.1:9222/json";
let cdpOk = false;
try {
  const tabs = await (await fetch(CDP)).json();
  const page = (tabs || []).find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (page) {
    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
    let id = 1;
    const send = (method, params = {}) => new Promise((resolve) => {
      const mid = id++;
      const onMsg = (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.id === mid) { ws.off("message", onMsg); resolve(msg); }
      };
      ws.on("message", onMsg);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
    await send("Runtime.enable");
    const r = await send("Runtime.evaluate", {
      expression: `({ hasRead: !!document.querySelector('.rhx,.rh'), ver: document.title })`,
      returnByValue: true,
    });
    cdpOk = !!r?.result?.result?.value;
    ws.close();
    ok(cdpOk, "CDP 连上渲染进程");
  } else {
    console.log("  · CDP 无 page（跳过真机 UI，结构项已验）");
  }
} catch {
  console.log("  · CDP 9222 不可用（跳过真机 UI，结构项已验）");
}

console.log(`\n── 结果 ${pass}/${pass + fail} ──\n`);
process.exit(fail ? 1 : 0);
