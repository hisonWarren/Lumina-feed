/** Probe candidate Sci-Hub / LibGen / Anna mirrors; print ok + optional DOI extract. */
const doi = "10.1017/s1355617716000114";
const sci = [
  "https://sci-hub.jp",
  "https://sci-hub.st",
  "https://sci-hub.se",
  "https://sci-hub.ru",
  "https://sci-hub.red",
  "https://sci-hub.box",
  "https://sci-hub.wf",
  "https://sci-hub.ee",
];
const libgen = [
  "https://libgen.li",
  "https://libgen.vg",
  "https://libgen.gl",
  "https://libgen.bz",
  "https://libgen.la",
  "https://libgen.is",
  "https://libgen.rs",
  "https://libgen.mx",
];
const annas = [
  "https://annas-archive.gl",
  "https://annas-archive.pk",
  "https://annas-archive.gd",
  "https://annas-archive.org",
  "https://annas-archive.se",
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function probe(kind, base) {
  const root = base.replace(/\/$/, "");
  const t0 = Date.now();
  try {
    if (kind === "scihub") {
      const res = await fetch(`${root}/${doi}`, {
        redirect: "follow",
        headers: { accept: "text/html,application/pdf,*/*", "user-agent": UA, referer: root + "/" },
        signal: AbortSignal.timeout(8000),
      });
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("pdf")) return { base: root, ok: true, ms: Date.now() - t0, note: "direct-pdf", status: res.status };
      const html = await res.text();
      const captcha = /are you are robot/i.test(html);
      const hasPdf = /\.pdf/i.test(html) && /storage|iframe|embed|object/i.test(html);
      return { base: root, ok: res.ok && !captcha && hasPdf, ms: Date.now() - t0, status: res.status, captcha, hasPdf, final: res.url.slice(0, 80) };
    }
    const url = kind === "libgen" ? `${root}/index.php` : `${root}/`;
    const res = await fetch(url, {
      redirect: "follow",
      headers: { accept: "text/html,*/*", "user-agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    return { base: root, ok: res.ok || res.status < 500, ms: Date.now() - t0, status: res.status, final: String(res.url).slice(0, 80) };
  } catch (e) {
    return { base: root, ok: false, ms: Date.now() - t0, err: String(e.message || e).slice(0, 80) };
  }
}

for (const [kind, list] of [["scihub", sci], ["libgen", libgen], ["annas", annas]]) {
  console.log(`\n=== ${kind} ===`);
  const results = await Promise.all(list.map((u) => probe(kind, u)));
  results.sort((a, b) => (b.ok - a.ok) || a.ms - b.ms);
  for (const r of results) console.log(JSON.stringify(r));
  console.log("OK:", results.filter((r) => r.ok).map((r) => r.base).join(", ") || "(none)");
}
