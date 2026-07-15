// mirror-health · LibGen / Anna / Sci-Hub 镜像探活与排序（P5）
import altMirrors from "./config/alt-mirrors.json" with { type: "json" };

export type MirrorKind = "libgen" | "annas" | "scihub";

export interface AltMirrorSettings {
  libgen?: string[];
  annas?: string[];
  scihub?: string[];
}

const DEFAULTS: Record<MirrorKind, string[]> = {
  libgen: (altMirrors as { libgen_mirrors?: string[] }).libgen_mirrors ?? [],
  annas: ((altMirrors as { annas_mirrors?: string[] }).annas_mirrors ?? []).map((m) =>
    (m.startsWith("http") ? m : `https://${m}`).replace(/\/$/, "")),
  scihub: (altMirrors as { scihub_mirrors?: string[] }).scihub_mirrors ?? [],
};

const cache = new Map<string, { order: string[]; at: number }>();
const CACHE_MS = 5 * 60 * 1000;
const PROBE_MS = 3500;

function dedupeUrls(list: string[]): string[] {
  const seen = new Set<string>();
  return list.map((m) => m.replace(/\/$/, "")).filter((m) => {
    const k = m.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Custom mirrors take priority, then built-in defaults are appended so Settings never erase working hosts. */
export function baseMirrors(kind: MirrorKind, settings?: AltMirrorSettings): string[] {
  const custom = settings?.[kind];
  const defaults = DEFAULTS[kind];
  if (custom?.length) return dedupeUrls([...custom, ...defaults]);
  return dedupeUrls(defaults);
}

async function probeOne(
  kind: MirrorKind,
  base: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<{ url: string; ok: boolean; ms: number }> {
  const t0 = Date.now();
  const root = base.replace(/\/$/, "");
  let probeUrl = root;
  if (kind === "libgen") probeUrl = `${root}/index.php`;
  else if (kind === "annas") probeUrl = `${root}/`;
  else probeUrl = `${root}/`;

  try {
    const res = await fetchImpl(probeUrl, {
      method: "GET",
      signal: signal ?? AbortSignal.timeout(PROBE_MS),
      redirect: "follow",
      headers: { accept: "text/html,*/*" },
    } as RequestInit);
    return { url: root, ok: res.ok || res.status < 500, ms: Date.now() - t0 };
  } catch {
    return { url: root, ok: false, ms: Date.now() - t0 };
  }
}

/** 探活并返回按延迟排序的镜像列表（可达的在前） */
export async function orderMirrors(
  kind: MirrorKind,
  settings?: AltMirrorSettings,
  deps: { fetchImpl?: typeof fetch; signal?: AbortSignal; refresh?: boolean } = {},
): Promise<{ ordered: string[]; probes: { url: string; ok: boolean; ms: number }[] }> {
  const list = baseMirrors(kind, settings);
  const cacheKey = `${kind}:${list.join("|")}`;
  const hit = cache.get(cacheKey);
  if (!deps.refresh && hit && Date.now() - hit.at < CACHE_MS) {
    return { ordered: hit.order, probes: hit.order.map((url) => ({ url, ok: true, ms: 0 })) };
  }

  const f = deps.fetchImpl ?? fetch;
  const probes = await Promise.all(list.map((url) => probeOne(kind, url, f, deps.signal)));
  const ok = probes.filter((p) => p.ok).sort((a, b) => a.ms - b.ms);
  const bad = probes.filter((p) => !p.ok);
  const ordered = [...ok.map((p) => p.url), ...bad.map((p) => p.url)];
  cache.set(cacheKey, { order: ordered.length ? ordered : list, at: Date.now() });
  return { ordered: ordered.length ? ordered : list, probes };
}

export async function probeAllMirrors(
  settings?: AltMirrorSettings,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<Record<MirrorKind, { ordered: string[]; probes: { url: string; ok: boolean; ms: number }[] }>> {
  const kinds: MirrorKind[] = ["libgen", "annas", "scihub"];
  const out = {} as Record<MirrorKind, { ordered: string[]; probes: { url: string; ok: boolean; ms: number }[] }>;
  await Promise.all(kinds.map(async (k) => { out[k] = await orderMirrors(k, settings, { ...deps, refresh: true }); }));
  return out;
}
