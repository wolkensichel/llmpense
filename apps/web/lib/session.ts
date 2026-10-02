/**
 * Admin session: `<expiresAtMs>.<base64url HMAC-SHA256("llmpense-admin:" + expiresAtMs)>`.
 * Uses Web Crypto only, so it runs in the proxy (any runtime) and in route handlers.
 */
export const SESSION_COOKIE = "llmpense_session";
export const SESSION_TTL_MS = 30 * 86_400_000;

/** Login is on only when ADMIN_PASSWORD is set; an empty password opens the dashboard without one. */
export function authEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.ADMIN_PASSWORD);
}

const enc = new TextEncoder();

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET must be set (16+ chars)");
  return s;
}

async function hmac(data: string, key = secret()): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
  return Buffer.from(sig).toString("base64url");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(now = Date.now(), key?: string): Promise<string> {
  const exp = now + SESSION_TTL_MS;
  return `${exp}.${await hmac(`llmpense-admin:${exp}`, key)}`;
}

export async function verifySessionToken(token: string | undefined | null, now = Date.now(), key?: string) {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const exp = Number(token.slice(0, dot));
  if (!Number.isFinite(exp) || exp < now) return false;
  return constantTimeEqual(token.slice(dot + 1), await hmac(`llmpense-admin:${exp}`, key));
}

/** Compares HMACs of both values so neither length nor content leaks through timing. */
export async function checkPassword(candidate: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const k = secret();
  return constantTimeEqual(await hmac(`pw:${candidate}`, k), await hmac(`pw:${expected}`, k));
}
