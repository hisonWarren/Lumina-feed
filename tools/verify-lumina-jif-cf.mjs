#!/usr/bin/env node
/** Structure verify: JIF online uses origin-browser-fetch (Cloudflare), not bare session.fetch. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];
function ok(name, pass, detail = "") {
  checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

const obf = fs.readFileSync(path.join(ROOT, "electron/origin-browser-fetch.ts"), "utf8");
ok("origin-browser-fetch exists", obf.includes("createOriginBrowserFetch"));
ok("in-page fetch", /executeJavaScript[\s\S]*fetch\(/.test(obf));
ok("CF html detect helper", obf.includes("isCloudflareChallengeHtml"));

ok("warm can show interactive Turnstile window", /showAfterMs|请在弹出窗口完成人机验证/.test(obf));
ok("hard reset clears hung queue", /hardReset|reset:\s*hardReset/.test(obf));
ok("loadURL timeout", /loadTimeoutMs|loadURL timeout/.test(obf));

const ipc = fs.readFileSync(path.join(ROOT, "electron/journal-ipc.ts"), "utf8");
ok("ipc imports origin-browser-fetch", ipc.includes("origin-browser-fetch"));
ok("updateJif uses browser.fetch", /crawlWosJifDataset\(\s*browser\.fetch/.test(ipc));
ok("liveMetrics uses getWosBrowserFetch", ipc.includes("getWosBrowserFetch().fetch"));
ok("liveMetrics slot-parallel", ipc.includes("liveOpenAlexSlot") && ipc.includes("Promise.all"));
ok("no crawl via sessionFetch for JIF", !/crawlWosJifDataset\(\s*sessionFetch/.test(ipc));
ok("cancelJif / resetWosBrowserFetch", ipc.includes("journal:cancelJif") && ipc.includes("resetWosBrowserFetch"));
ok("live miss resets WOS queue", /resetWosBrowserFetch\(\)/.test(ipc));
const wos = fs.readFileSync(path.join(ROOT, "src/core/journal/wos-jif.ts"), "utf8");
ok("listing rejects CF html", wos.includes("isWosCloudflareHtml") && wos.includes("Cloudflare challenge"));

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
