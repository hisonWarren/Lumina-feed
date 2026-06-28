#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(ROOT, "..", "secrets.local.env");
const text = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const key = text.match(/^DOUBAO_API_KEY=(.+)$/m)?.[1]?.trim() || process.env.DOUBAO_API_KEY;
const model = text.match(/^DOUBAO_MODEL=(.+)$/m)?.[1]?.trim() || "doubao-seed-2-1-pro-260628";

const CDP = "http://127.0.0.1:9222";
const list = await (await fetch(`${CDP}/json/list`)).json();
const page = list.find((t) => t.type === "page" && /index/.test(t.url || ""));
if (!page) { console.error("CDP 未就绪"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 1;
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
  const n = id++;
  pending.set(n, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evalJs = async (expr) => {
  const { result, exceptionDetails } = await send("Runtime.evaluate", {
    expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true,
  });
  if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
  return result.value;
};
await send("Runtime.enable");

await evalJs(`
  await window.luminaApi.setSecret("doubao_key", ${JSON.stringify(key)});
  const s = await window.luminaApi.getSettings();
  s.llm = { provider: "doubao", model: ${JSON.stringify(model)}, baseUrl: "https://ark.cn-beijing.volces.com/api/v3" };
  await window.luminaApi.saveSettings(s);
`);
const test = await evalJs(`
  return await window.luminaApi.testLlm({ provider:"doubao", model:${JSON.stringify(model)}, baseUrl:"https://ark.cn-beijing.volces.com/api/v3", apiKey:${JSON.stringify(key)} });
`);
console.log("model:", model);
console.log("llm:test:", test);
ws.close();
process.exit(test?.ok ? 0 : 1);
