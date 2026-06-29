#!/usr/bin/env node
const CDP = process.env.CDP || "http://127.0.0.1:9223";

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
      const d = msg.params.exceptionDetails;
      console.log("EXCEPTION:", d?.exception?.description || d?.text);
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
  await new Promise((r) => setTimeout(r, 3000));
  ws.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
