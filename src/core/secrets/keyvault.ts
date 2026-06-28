// lumina-feed · 密钥存储（OS 钥匙串 / 环境变量回退）
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export function keytarStore(): SecretStore {
  return {
    async get(key) {
      try {
        const keytar = await import("keytar");
        return keytar.default.getPassword("lumina-feed", key);
      } catch {
        return process.env[`LUMINA_${key.toUpperCase()}`] ?? null;
      }
    },
    async set(key, value) {
      try {
        const keytar = await import("keytar");
        await keytar.default.setPassword("lumina-feed", key, value);
      } catch {
        process.env[`LUMINA_${key.toUpperCase()}`] = value;
      }
    },
    async delete(key) {
      try {
        const keytar = await import("keytar");
        await keytar.default.deletePassword("lumina-feed", key);
      } catch {
        delete process.env[`LUMINA_${key.toUpperCase()}`];
      }
    },
  };
}
