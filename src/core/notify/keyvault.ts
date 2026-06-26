// lumina-feed · 密钥保管
// 桌面端用系统钥匙串（keytar）；不可用时用基于机器派生口令的本地 AES 加密文件兜底。
// 绝不明文落库。worker(C) 一律走 env，不用本文件。
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import * as fs from "node:fs";

const SERVICE = "lumina-feed";

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** 钥匙串实现（npm i keytar，动态导入） */
export function keytarStore(service = SERVICE): SecretStore {
  const get = async () => (await import("keytar")).default as any;
  return {
    async get(key) { return (await get()).getPassword(service, key); },
    async set(key, value) { await (await get()).setPassword(service, key, value); },
    async delete(key) { await (await get()).deletePassword(service, key); },
  };
}

/** 兜底：本地加密文件（口令由机器特征派生；安全性弱于钥匙串，仅在 keytar 不可用时用） */
export function encryptedFileStore(filePath: string, passphrase: string): SecretStore {
  const keyOf = () => scryptSync(passphrase, "lumina-salt-v1", 32);
  const load = (): Record<string, string> => {
    try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return {}; }
  };
  const save = (o: Record<string, string>) => fs.writeFileSync(filePath, JSON.stringify(o), { mode: 0o600 });
  const enc = (plain: string) => {
    const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", keyOf(), iv);
    const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]); const tag = c.getAuthTag();
    return Buffer.concat([iv, tag, ct]).toString("base64");
  };
  const dec = (b64: string) => {
    const buf = Buffer.from(b64, "base64");
    const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
    const d = createDecipheriv("aes-256-gcm", keyOf(), iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  };
  return {
    async get(key) { const o = load(); return o[key] ? dec(o[key]) : null; },
    async set(key, value) { const o = load(); o[key] = enc(value); save(o); },
    async delete(key) { const o = load(); delete o[key]; save(o); },
  };
}

/** worker(C) 用：从环境变量取密钥 */
export function envStore(prefix = "LUMINA_"): SecretStore {
  return {
    async get(key) { return process.env[prefix + key.toUpperCase()] ?? null; },
    async set() { throw new Error("env 只读"); },
    async delete() { throw new Error("env 只读"); },
  };
}
