// Pure-syntax JSX/TSX checker via the TypeScript parser API.
// createSourceFile(..., ScriptKind.JSX) runs ONLY the parser: no type-checking,
// no module resolution -> sourceFile.parseDiagnostics holds genuine syntax
// errors only. JSX-correct (unlike brace counting). Degrades gracefully:
// if 'typescript' isn't resolvable, prints SKIP and exits 0 (non-fatal),
// since the shipped verify-lumina-reader-plus-graph.mjs already brace-checks.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const path = process.argv[2];
if (!path) { console.log("usage: node jsx-syntax-check.mjs <file.jsx>"); process.exit(2); }

function loadTS() {
  const candidates = [
    process.cwd() + "/node_modules/",                 // repo-local
    process.env.HOME + "/.npm-global/lib/node_modules/", // global (npm prefix)
    "/usr/local/lib/node_modules/",
    "/usr/lib/node_modules/",
  ];
  for (const base of candidates) {
    try { return createRequire(base)("typescript"); } catch { /* try next */ }
  }
  try { return createRequire(import.meta.url)("typescript"); } catch { return null; }
}

const ts = loadTS();
if (!ts) {
  console.log("SKIP jsx-syntax-check: typescript not found (non-fatal; brace-balance in main verifier still applies)");
  process.exit(0);
}

const text = readFileSync(path, "utf8");
const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JSX);
const diags = sf.parseDiagnostics || [];
if (diags.length === 0) { console.log("SYNTAX_OK " + path); process.exit(0); }
console.log("SYNTAX_FAIL " + path + "  (" + diags.length + " parse error(s))");
for (const d of diags.slice(0, 25)) {
  const pos = d.start != null ? sf.getLineAndCharacterOfPosition(d.start) : { line: -1, character: 0 };
  console.log(`  L${pos.line + 1}:${pos.character + 1}  ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
}
process.exit(1);
