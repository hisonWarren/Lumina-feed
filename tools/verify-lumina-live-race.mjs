#!/usr/bin/env node
/** Structure + unit: slot-parallel liveMetrics + raceFirstValid cancel-on-win. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];
function ok(name, pass, detail = "") {
  checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

const ipc = fs.readFileSync(path.join(ROOT, "electron/journal-ipc.ts"), "utf8");
ok("raceFirstValid imported", ipc.includes('from "../src/core/net/race-first.ts"'));
ok("Promise.all slots", /Promise\.all\(\[\s*wantOa[\s\S]*wantJif[\s\S]*wantCas/.test(ipc));
ok("liveJifSlot + liveCasSlot + liveOpenAlexSlot", ipc.includes("liveJifSlot") && ipc.includes("liveCasSlot") && ipc.includes("liveOpenAlexSlot"));
ok("opts gate slots", ipc.includes("wantJif") && ipc.includes("wantOa") && ipc.includes("openalex?:"));

const ui = fs.readFileSync(path.join(ROOT, "src/ui/modules/Journals.jsx"), "utf8");
ok("UI passes slot opts", ui.includes("openalex: needOa") && ui.includes("jif: needJif"));
ok("UI merges openalex patch", ui.includes("live?.openalex") && ui.includes("next.impact2yr"));

const racePath = path.join(ROOT, "src/core/net/race-first.ts");
ok("race-first module exists", fs.existsSync(racePath));

// Runtime: first valid wins, slower leg cancelled
const { raceFirstValid } = await import(pathToFileURL(racePath).href);
let slowStarted = false;
let slowAborted = false;
const winner = await raceFirstValid(
  [
    async (signal) => {
      await new Promise((r, j) => {
        const t = setTimeout(r, 30);
        signal.addEventListener("abort", () => { clearTimeout(t); j(Object.assign(new Error("aborted"), { name: "AbortError" })); }, { once: true });
      });
      return { n: 1, ok: false };
    },
    async () => ({ n: 2, ok: true }),
    async (signal) => {
      slowStarted = true;
      await new Promise((r, j) => {
        const t = setTimeout(() => r(undefined), 500);
        signal.addEventListener("abort", () => {
          clearTimeout(t);
          slowAborted = true;
          j(Object.assign(new Error("aborted"), { name: "AbortError" }));
        }, { once: true });
      });
      return { n: 3, ok: true };
    },
  ],
  (v) => !!(v && v.ok),
  { timeoutMs: 2000 },
);
ok("race picks first valid", winner && winner.n === 2, JSON.stringify(winner));
ok("slower leg started then aborted or skipped", slowStarted === false || slowAborted === true);

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
