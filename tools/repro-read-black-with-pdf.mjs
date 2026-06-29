#!/usr/bin/env node
/** Repro: open Read tab with restored PDF tab — must not black-screen */
const CDP = process.env.CDP || "http://127.0.0.1:9223";

async function main() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("no CDP page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const errors = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.method === "Runtime.exceptionThrown") {
      errors.push(msg.params.exceptionDetails?.text || JSON.stringify(msg.params));
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await new Promise((r) => ws.addEventListener("open", r));
  await send("Runtime.enable");

  const evalJs = async (expr) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", {
      expression: `(async()=>{ ${expr} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
    return result.value;
  };

  const ARXIV = "smoke-arxiv-1706";
  const URL = "https://arxiv.org/pdf/1706.03762.pdf";
  const open = await evalJs(`
    const list = await window.luminaOa.listPdfs();
    if (!list.find(x => x.paperId === ${JSON.stringify(ARXIV)})) {
      await window.luminaOa.fetchPdf(${JSON.stringify(URL)}, ${JSON.stringify(ARXIV)});
    }
    await window.luminaReader.recordOpen({ paperId: ${JSON.stringify(ARXIV)}, title: "Attention", page: 1 });
    const readTab = [...document.querySelectorAll(".lf-tab")].find(b => (b.textContent||"").includes("\\u9605\\u8bfb"));
    if (readTab) readTab.click();
    await new Promise(r => setTimeout(r, 900));
    const tab = document.querySelector(".rhx-tab:not(.rhx-home)");
    if (tab) tab.click();
    for (let i = 0; i < 50; i++) {
      if (document.querySelector(".rd") && !document.querySelector(".rd-loading")) {
        return {
          ok: true,
          rd: true,
          canvas: !!document.querySelector(".rd canvas"),
          stageH: document.querySelector(".lf-stage")?.offsetHeight,
          text: document.body.innerText.slice(0, 80),
        };
      }
      await new Promise(r => setTimeout(r, 400));
    }
    return {
      ok: false,
      rd: !!document.querySelector(".rd"),
      stageH: document.querySelector(".lf-stage")?.offsetHeight,
      text: document.body.innerText.slice(0, 120),
    };
  `);

  console.log("open:", open);
  console.log("errors:", errors.length ? errors : "(none)");
  ws.close();
  if (!open?.ok || errors.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
