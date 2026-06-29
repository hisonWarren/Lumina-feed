#!/usr/bin/env node
/** 真机：检测检索时是否触发后台预取 / 取文 UI */
const CDP = "http://127.0.0.1:9222";
const QUERY = "biological motion";

async function getWs() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
  if (!page) throw new Error("CDP page not found — start Electron with --remote-debugging-port=9222");
  return page.webSocketDebuggerUrl;
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 1;
    const pending = new Map();
    ws.addEventListener("open", () => resolve({ ws, send, evalJs }));
    ws.addEventListener("error", reject);
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      }
    });
    function send(method, params = {}) {
      const n = id++;
      return new Promise((res, rej) => {
        pending.set(n, { resolve: res, reject: rej });
        ws.send(JSON.stringify({ id: n, method, params }));
      });
    }
    async function evalJs(expr) {
      const { result, exceptionDetails } = await send("Runtime.evaluate", {
        expression: `(async()=>{ ${expr} })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
      return result.value;
    }
  });
}

const wsUrl = await getWs();
const cdp = await connect(wsUrl);
await cdp.send("Runtime.enable");

const settings = await cdp.evalJs(`
  const s = await window.luminaApi.getSettings();
  return {
    prefetchOnIdentifier: s.prefetchOnIdentifier,
    prefetchOaResults: s.prefetchOaResults,
    primaryAutoOpenReader: s.primaryAutoOpenReader,
    version: await window.luminaApi.getVersion?.() || "unknown",
  };
`);
console.log("SETTINGS", JSON.stringify(settings));

await cdp.evalJs(`[...document.querySelectorAll(".lf-tab")].find(b=>b.textContent.includes("检索"))?.click();`);
await new Promise((r) => setTimeout(r, 400));

await cdp.evalJs(`
  const inp = document.querySelector(".ff-bar input");
  inp.value = ${JSON.stringify(QUERY)};
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
`);

const samples = [];
for (let i = 0; i < 25; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const snap = await cdp.evalJs(`
    const cards = document.querySelectorAll(".ff-card");
    const primary = document.querySelector(".ff-card.ff-primary");
    const loadingBtn = primary?.querySelector(".ff-act.loading");
    const btnText = loadingBtn?.textContent?.trim() || "";
    const banner = document.querySelector(".ff-primary-banner")?.textContent?.trim() || "";
    return {
      cards: cards.length,
      primaryLoading: !!loadingBtn,
      btnText: btnText.slice(0, 60),
      banner: banner.slice(0, 80),
      locateMode: window.__ffLocateMode || null,
    };
  `);
  samples.push({ sec: i + 1, ...snap });
  console.log(`t+${i + 1}s`, JSON.stringify(snap));
  if (snap.primaryLoading) {
    console.log("AUTO_FETCH_UI_DETECTED", snap.btnText);
    break;
  }
}

console.log("SUMMARY", JSON.stringify({ settings, autoDetected: samples.some((s) => s.primaryLoading), samples: samples.slice(-5) }));
cdp.ws.close();
process.exit(samples.some((s) => s.primaryLoading) ? 2 : 0);
