import { describe, expect, it } from "vitest";
import { buildStatement, type UsageLine } from "@llmpense/core";
import { brandingOf, brandingSchema } from "./branding.ts";
import { resolvePeriod } from "./period.ts";
import { csvResponse, monthCsv, statementCsv, type StatementForCsv } from "./statement-csv.ts";

const usage = (o: Partial<UsageLine>): UsageLine => ({
  project: "Support bot",
  provider: "openai",
  model: "gpt-5-mini",
  requests: 10,
  inputTokens: 1000,
  outputTokens: 200,
  cacheReadTokens: 50,
  cacheWriteTokens: 5,
  costUsd: 1,
  billedUsd: 1.3,
  ...o,
});

const AFTER = new Date("2026-10-05T00:00:00Z");

const acme: StatementForCsv = {
  status: "closed",
  client: { name: "Acme, Inc.", slug: "acme" },
  data: buildStatement({
    period: "2026-09",
    terms: { billingMode: "markup", markupPct: 30, fixedFeeUsd: 0 },
    asOf: AFTER,
    usage: [usage({}), usage({ model: "gpt-5", costUsd: 2.123456789, billedUsd: 2.76049 })],
  }),
};
const northwind: StatementForCsv = {
  status: "draft",
  client: { name: "Northwind", slug: "northwind" },
  data: buildStatement({
    period: "2026-09",
    terms: { billingMode: "fixed", markupPct: 0, fixedFeeUsd: 300 },
    asOf: AFTER,
    usage: [usage({ billedUsd: 0, costUsd: 40 })],
  }),
};

const parse = (csv: string) => csv.trimEnd().split("\r\n");

describe("statementCsv", () => {
  it("writes one row per line item plus a total, with cents for billed amounts", () => {
    const rows = parse(statementCsv(acme));
    expect(rows[0]).toBe(
      "period,client,status,line_type,project,provider,model,requests,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,cost_usd,billed_usd",
    );
    expect(rows[1]).toBe('2026-09,"Acme, Inc.",closed,usage,Support bot,openai,gpt-5,10,1000,200,50,5,2.123457,2.76');
    expect(rows[2]).toBe('2026-09,"Acme, Inc.",closed,usage,Support bot,openai,gpt-5-mini,10,1000,200,50,5,1.000000,1.30');
    expect(rows[3]).toBe('2026-09,"Acme, Inc.",closed,total,,,,20,2000,400,100,10,3.123457,4.06');
    expect(rows).toHaveLength(4);
  });

  it("includes the fixed fee as its own line and in the total", () => {
    const rows = parse(statementCsv(northwind));
    expect(rows[2]).toBe("2026-09,Northwind,draft,fixed_fee,Fixed monthly fee,,,0,0,0,0,0,0.000000,300.00");
    expect(rows[3]).toBe("2026-09,Northwind,draft,total,,,,10,1000,200,50,5,40.000000,300.00");
  });
});

describe("monthCsv", () => {
  it("writes one row per client with billing mode, billed amount, fixed fee and status", () => {
    const rows = parse(monthCsv("2026-09", [acme, northwind]));
    expect(rows).toEqual([
      "period,client,client_slug,billing_mode,billed_usd,fixed_fee_usd,total_usd,status",
      '2026-09,"Acme, Inc.",acme,markup,4.06,0.00,4.06,closed',
      "2026-09,Northwind,northwind,fixed,0.00,300.00,300.00,draft",
    ]);
  });

  it("neutralises client names that a spreadsheet would run as a formula", () => {
    const csv = monthCsv("2026-09", [{ ...acme, client: { name: "=HYPERLINK()", slug: "x" } }]);
    expect(parse(csv)[1]).toContain("'=HYPERLINK()");
  });
});

describe("csvResponse", () => {
  it("sends an attachment with a safe filename", () => {
    const res = csvResponse("a\r\n", 'llmpense-"acme"/2026-09.csv');
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="llmpense--acme--2026-09.csv"');
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("resolvePeriod", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  it("accepts valid months up to the current one", () => {
    expect(resolvePeriod("2026-09", "x", now)).toBe("2026-09");
    expect(resolvePeriod(["2026-10"], "x", now)).toBe("2026-10");
  });
  it("falls back for missing, malformed or future months", () => {
    expect(resolvePeriod(undefined, "2026-09", now)).toBe("2026-09");
    expect(resolvePeriod("2026-9", "2026-09", now)).toBe("2026-09");
    expect(resolvePeriod("2026-11", "2026-09", now)).toBe("2026-09");
  });
});

describe("branding", () => {
  it("falls back to the org name and drops blank fields", () => {
    expect(brandingOf({ name: "My agency", brandName: "  ", brandAddress: "", brandFooter: null, brandLogoUrl: " https://x.test/l.png " })).toEqual({
      name: "My agency",
      address: null,
      footer: null,
      logoUrl: "https://x.test/l.png",
    });
  });

  it("validates the form: name required, logo must be http(s)", () => {
    expect(brandingSchema.safeParse({ brandName: "Demo", brandAddress: "", brandFooter: "", brandLogoUrl: "" }).data).toEqual({
      brandName: "Demo",
      brandAddress: null,
      brandFooter: null,
      brandLogoUrl: null,
    });
    expect(brandingSchema.safeParse({ brandName: "", brandAddress: "", brandFooter: "", brandLogoUrl: "" }).success).toBe(false);
    for (const url of ["javascript:alert(1)", "data:image/png;base64,xx", "ftp://x", "https://x.test/a b.png"]) {
      expect(brandingSchema.safeParse({ brandName: "D", brandAddress: "", brandFooter: "", brandLogoUrl: url }).success).toBe(false);
    }
  });
});
