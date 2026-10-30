import { describe, expect, it } from "vitest";
import { statementNotice } from "./statement-notice.ts";

describe("statementNotice", () => {
  it("reports a partly closed month with its counts", () => {
    const text = statementNotice({ notice: "close-partial", closed: "3", noRate: "1" });
    expect(text).toContain("Closed 3 statements. 1 statement stayed open");
  });

  it("explains an invalid issue date", () => {
    expect(statementNotice({ notice: "invalid-date" })).toContain("issue date");
  });

  it("treats bad counts as zero", () => {
    expect(statementNotice({ notice: "skipped", done: "<b>", skipped: "-1" })).toContain("Marked 0 statements. 0 statements");
  });

  it("shows nothing without a known code", () => {
    expect(statementNotice({})).toBeNull();
    expect(statementNotice({ notice: "anything else" })).toBeNull();
    expect(statementNotice({ notice: ["no-rate", "no-rate"] })).toBeNull();
  });
});
