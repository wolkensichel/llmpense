import { describe, expect, it } from "vitest";
import { toCsv } from "./csv.ts";

describe("toCsv", () => {
  it("quotes separators and escapes quotes", () => {
    expect(toCsv([["a,b", 'say "hi"', 3]])).toBe('"a,b","say ""hi""",3\r\n');
  });

  it("neutralises spreadsheet formulas in text cells but not numbers", () => {
    expect(toCsv([["=SUM(A1)", -5, "-x"]])).toBe("'=SUM(A1),-5,'-x\r\n");
  });
});
