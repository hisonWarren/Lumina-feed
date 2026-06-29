#!/usr/bin/env node
/** Repro: click 阅读 tab, capture React/JS errors */
const CDP = "http://127.0.0.1:9223";

async function main() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("no CDP page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.method === "Runtime.exceptionThrown") {
      console.log("EXCEPTION:", msg.params.exceptionDetails?.text || JSON.stringify(msg.params));
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
  await send("Log.enable");

  const evalJs = async (expr) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", {
      expression: `(async()=>{ ${expr} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails?.text) throw new Error(exceptionDetails.text);
    return result.value;
  };

  const before = await evalJs(`return { text: document.body.innerText.slice(0,80), rh: !!document.querySelector('.rh') };`);
  console.log("before:", before);

  try {
    const after = await evalJs(`
      const t = [...document.querySelectorAll('.lf-tab')].find(b => (b.textContent||'').includes('\\u9605\\u8bfb'));
      if (t) t.click();
      await new Promise(r => setTimeout(r, 1200));
      return {
        text: document.body.innerText.slice(0,120),
        rh: !!document.querySelector('.rh'),
        rhx: !!document.querySelector('.rhx'),
        rd: !!document.querySelector('.rd'),
        stage: document.querySelector('.lf-stage')?.offsetHeight,
        readPaneHidden: document.querySelector('.lf-pane')?.className,
      };
    `);
    console.log("after:", after);
  } catch (e) {
    console.log("eval error:", e.message);
  }
  ws.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
