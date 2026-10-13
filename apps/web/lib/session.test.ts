import { describe, expect, it } from "vitest";
import { authEnabled, authWarnings, createSessionToken, SESSION_TTL_MS, verifySessionToken } from "./session.ts";

const KEY = "test-secret-at-least-16";

describe("authEnabled", () => {
  it("is on only when ADMIN_PASSWORD is non-empty", () => {
    expect(authEnabled({ ADMIN_PASSWORD: "secret" })).toBe(true);
    expect(authEnabled({ ADMIN_PASSWORD: "" })).toBe(false);
    expect(authEnabled({})).toBe(false);
  });
});

describe("authWarnings", () => {
  it("warns when the dashboard is open", () => {
    expect(authWarnings({})).toEqual([expect.stringContaining("without a login")]);
  });

  it("warns when a password is set without a usable session secret", () => {
    expect(authWarnings({ ADMIN_PASSWORD: "pw" })).toEqual([expect.stringContaining("SESSION_SECRET")]);
    expect(authWarnings({ ADMIN_PASSWORD: "pw", SESSION_SECRET: "short" })).toHaveLength(1);
  });

  it("is quiet when login is fully set up", () => {
    expect(authWarnings({ ADMIN_PASSWORD: "pw", SESSION_SECRET: KEY })).toEqual([]);
  });
});

describe("session tokens", () => {
  it("verifies its own token until expiry", async () => {
    const now = 1_000_000;
    const t = await createSessionToken(now, KEY);
    expect(await verifySessionToken(t, now + 1000, KEY)).toBe(true);
    expect(await verifySessionToken(t, now + SESSION_TTL_MS + 1, KEY)).toBe(false);
  });

  it("rejects tampering and other secrets", async () => {
    const now = 1_000_000;
    const t = await createSessionToken(now, KEY);
    const [exp, sig] = t.split(".");
    expect(await verifySessionToken(`${Number(exp) + 1}.${sig}`, now, KEY)).toBe(false);
    expect(await verifySessionToken(t, now, "another-secret-value")).toBe(false);
    expect(await verifySessionToken("garbage", now, KEY)).toBe(false);
    expect(await verifySessionToken(undefined, now, KEY)).toBe(false);
  });
});
