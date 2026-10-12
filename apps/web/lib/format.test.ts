import { describe, expect, it } from "vitest";
import { usdPer } from "./format.ts";

describe("usdPer", () => {
  it("shows unit costs with enough precision", () => {
    expect(usdPer(1.8)).toBe("$1.80");
    expect(usdPer(0.2134)).toBe("$0.213");
    expect(usdPer(0.2)).toBe("$0.20");
    expect(usdPer(0.0042)).toBe("$0.0042");
    expect(usdPer(0.0198)).toBe("$0.0198");
    expect(usdPer(0.02)).toBe("$0.020");
    expect(usdPer(0)).toBe("$0.00");
  });
});
