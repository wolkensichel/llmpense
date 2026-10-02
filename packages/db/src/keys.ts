import { createHash, randomBytes } from "node:crypto";

const PREFIX = "lpk_";

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = PREFIX + randomBytes(24).toString("base64url");
  return { key, prefix: key.slice(0, 10), hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
