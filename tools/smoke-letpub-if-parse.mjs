#!/usr/bin/env node
/** 离线：用本地 LetPub HTML 跑 parseLetPubImpactHtml（tsx） */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLetPubImpactHtml } from "../src/core/journal/letpub-impact.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(path.join(ROOT, "tools/_tmp-letpub-nature.html"), "utf8");
const row = parseLetPubImpactHtml(html);
console.log(JSON.stringify(row, null, 2));
if (!row || row.jif == null || Math.abs(row.jif - 56.1) > 0.05) {
  console.error("FAIL expected jif≈56.1");
  process.exit(1);
}
if (row.jif5yr == null || Math.abs(row.jif5yr - 56.702) > 0.05) {
  console.error("FAIL expected jif5yr≈56.702");
  process.exit(1);
}
console.log("PASS");
