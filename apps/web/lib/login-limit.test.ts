import { describe, expect, it } from "vitest";
import { clientOf, createLoginLimiter, LOGIN_WINDOW_MS } from "./login-limit.ts";

describe("login limiter", () => {
  it("blocks a client after 5 failures, until the window passes", () => {
    const l = createLoginLimiter();
    for (let i = 0; i < 4; i++) l.fail("a", 1000);
    expect(l.blocked("a", 1000)).toBe(false);
    l.fail("a", 1000);
    expect(l.blocked("a", 1000)).toBe(true);
    expect(l.blocked("b", 1000)).toBe(false);
    expect(l.blocked("a", 1000 + LOGIN_WINDOW_MS)).toBe(false);
  });

  it("blocks everyone when failures come from many addresses", () => {
    const l = createLoginLimiter();
    for (let i = 0; i < 30; i++) l.fail(`forged-${i}`, 1000);
    expect(l.blocked("someone-else", 1000)).toBe(true);
  });

  it("clears a client's failures after a successful sign-in", () => {
    const l = createLoginLimiter();
    for (let i = 0; i < 5; i++) l.fail("a", 1000);
    l.succeed("a");
    expect(l.blocked("a", 1000)).toBe(false);
  });
});

describe("clientOf", () => {
  it("uses the first forwarded address, then x-real-ip, then a shared bucket", () => {
    expect(clientOf(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientOf(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientOf(new Headers())).toBe("direct");
  });
});
