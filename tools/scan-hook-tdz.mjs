#!/usr/bin/env node
/** Static scan: hook deps referencing const useCallback declared later (TDZ risk) */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "ui");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const fp = path.join(dir, name);
    const st = statSync(fp);
    if (st.isDirectory()) walk(fp, out);
    else if (/\.(jsx|js|tsx|ts)$/.test(name)) out.push(fp);
  }
  return out;
}

function scanFile(fp) {
  const src = readFileSync(fp, "utf8");
  if (!/export default function|function \w+\(/.test(src)) return [];
  const lines = src.split(/\r?\n/);
  const cbDecl = new Map(); // name -> line (1-based)
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*const\s+(\w+)\s*=\s*useCallback\s*\(/);
    if (m) cbDecl.set(m[1], i + 1);
  }
  const issues = [];
  const depRe = /\],\s*\[([^\]]*)\]\s*;/g;
  let hookLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/useEffect\s*\(|useMemo\s*\(|useCallback\s*\(/.test(line)) hookLine = i + 1;
    const depInline = line.match(/\],\s*\[([^\]]*)\]\s*;/);
    if (!depInline) continue;
    const deps = depInline[1].split(",").map((s) => s.trim().split(/\s/)[0]).filter(Boolean);
    for (const dep of deps) {
      const decl = cbDecl.get(dep);
      if (decl && decl > hookLine) {
        issues.push({ file: fp, hookLine, dep, declLine: decl });
      }
    }
  }
  // multiline deps: find `}, [` blocks
  const blockRe = /use(?:Effect|Memo|Callback)\([\s\S]*?\},\s*\[([\s\S]*?)\]\s*\)/g;
  let m;
  while ((m = blockRe.exec(src))) {
    const blockStart = src.slice(0, m.index).split(/\r?\n/).length;
    const deps = m[1]
      .split(",")
      .map((s) => s.replace(/\/\/.*$/, "").trim().split(/\s/)[0])
      .filter((d) => d && /^[A-Za-z_$]/.test(d));
    for (const dep of deps) {
      const decl = cbDecl.get(dep);
      if (decl && decl > blockStart) {
        issues.push({ file: fp, hookLine: blockStart, dep, declLine: decl });
      }
    }
  }
  return issues;
}

const files = walk(ROOT);
const all = [];
for (const f of files) all.push(...scanFile(f));
const uniq = new Map();
for (const it of all) uniq.set(`${it.file}:${it.hookLine}:${it.dep}`, it);

if (!uniq.size) {
  console.log("TDZ scan: 0 potential issues in src/ui");
  process.exit(0);
}
console.log(`TDZ scan: ${uniq.size} potential issue(s)`);
for (const it of uniq.values()) {
  console.log(`  ${path.relative(path.join(ROOT, ".."), it.file)}:${it.hookLine} dep '${it.dep}' declared at ${it.declLine}`);
}
process.exit(1);
