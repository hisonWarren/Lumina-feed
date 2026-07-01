// lumina-feed · PDF 本地存储路径（默认 userData/pdfs，可在设置中自定义）
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { Store } from "../src/core/store/index.ts";
import type { AppSettings } from "./settings.ts";

let storeRef: Store | null = null;

export function bindPdfStorageStore(store: Store): void {
  storeRef = store;
}

export function defaultPdfStorageDir(): string {
  return path.join(app.getPath("userData"), "pdfs");
}

export function pdfStorageDirFromSettings(settings?: Pick<AppSettings, "pdfStorageDir"> | null): string {
  const custom = settings?.pdfStorageDir?.trim();
  if (custom) {
    const resolved = path.resolve(custom);
    fs.mkdirSync(resolved, { recursive: true });
    return resolved;
  }
  const d = defaultPdfStorageDir();
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function readPdfStorageDirSetting(store: Store): string | undefined {
  try {
    const r = store.db.prepare("SELECT payload FROM sources_cache WHERE key=?").get("app_settings") as { payload?: string } | undefined;
    if (!r?.payload) return undefined;
    const parsed = JSON.parse(r.payload) as AppSettings;
    const custom = parsed.pdfStorageDir?.trim();
    return custom || undefined;
  } catch {
    return undefined;
  }
}

/** 当前生效的 PDF 目录（同步；主进程取文/读盘路径）。 */
export function activePdfStorageDir(store?: Store | null): string {
  const st = store ?? storeRef;
  if (!st) return pdfStorageDirFromSettings(null);
  try {
    const r = st.db.prepare("SELECT payload FROM sources_cache WHERE key=?").get("app_settings") as { payload?: string } | undefined;
    if (r?.payload) return pdfStorageDirFromSettings(JSON.parse(r.payload) as AppSettings);
  } catch { /* ignore */ }
  return pdfStorageDirFromSettings(null);
}

export function pdfPathForId(paperId: string, store?: Store | null): string {
  return path.join(activePdfStorageDir(store), `${encodeURIComponent(paperId)}.pdf`);
}

export function countPdfsInDir(dir: string): number {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".pdf")).length;
  } catch {
    return 0;
  }
}

export function validatePdfStorageDir(dir: string): { ok: boolean; error?: string } {
  const trimmed = dir?.trim();
  if (!trimmed) return { ok: false, error: "empty_path" };
  const resolved = path.resolve(trimmed);
  try {
    fs.mkdirSync(resolved, { recursive: true });
    const probe = path.join(resolved, `.lumina-pdf-write-${process.pid}`);
    fs.writeFileSync(probe, "1");
    fs.unlinkSync(probe);
    return { ok: true };
  } catch {
    return { ok: false, error: "not_writable" };
  }
}

/** 将旧目录中的 PDF 移到新目录（同名已存在则删旧留新）。 */
export function migratePdfStorageDir(fromDir: string, toDir: string): { moved: number; errors: number } {
  fs.mkdirSync(toDir, { recursive: true });
  let moved = 0;
  let errors = 0;
  const from = path.resolve(fromDir);
  const to = path.resolve(toDir);
  if (from === to) return { moved: 0, errors: 0 };
  try {
    for (const f of fs.readdirSync(from)) {
      if (!f.endsWith(".pdf")) continue;
      const src = path.join(from, f);
      const dest = path.join(to, f);
      try {
        if (fs.existsSync(dest)) {
          fs.unlinkSync(src);
          moved++;
          continue;
        }
        fs.renameSync(src, dest);
        moved++;
      } catch {
        try {
          fs.copyFileSync(src, dest);
          fs.unlinkSync(src);
          moved++;
        } catch {
          errors++;
        }
      }
    }
  } catch { /* ignore */ }
  return { moved, errors };
}

export function clearPdfStorageDir(dir: string): void {
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".pdf")) continue;
      try { fs.unlinkSync(path.join(dir, name)); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}
