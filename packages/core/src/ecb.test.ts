import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fetchEcbRates, parseEcbXml } from "./ecb.ts";
import { selectRate } from "./fx.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("parseEcbXml", () => {
  it("parses the daily feed (single-quoted attributes) and keeps the supported currencies", () => {
    const rates = parseEcbXml(fixture("ecb-daily.xml"));
    expect(rates.map((r) => r.currency).sort()).toEqual(["CHF", "CNY", "GBP", "JPY", "USD"]);
    expect(rates.every((r) => r.date === "2026-10-09" && r.source === "ecb")).toBe(true);
    expect(rates.find((r) => r.currency === "USD")!.ratePerEur).toBe(1.1206);
    expect(rates.find((r) => r.currency === "GBP")!.ratePerEur).toBe(0.84763);
  });

  it("parses the 90-day feed (double-quoted, several days)", () => {
    const rates = parseEcbXml(fixture("ecb-hist-90d-excerpt.xml"));
    expect([...new Set(rates.map((r) => r.date))]).toEqual(["2026-10-05", "2026-10-02", "2026-10-01", "2026-09-30"]);
    expect(rates).toHaveLength(20);
    expect(rates.find((r) => r.date === "2026-09-30" && r.currency === "CNY")!.ratePerEur).toBe(7.613);
    // September 2026 uses Wednesday 30 Sep: 1 USD = 1 / 1.1355 EUR.
    const eur = selectRate({ currency: "EUR", period: "2026-09", today: "2026-10-12", rates })!;
    expect(eur.date).toBe("2026-09-30");
    expect(eur.perUsd.toFixed(4)).toBe("0.8807");
  });

  it("can keep other currencies on request", () => {
    expect(parseEcbXml(fixture("ecb-daily.xml"), ["SEK"])).toEqual([{ date: "2026-10-09", currency: "SEK", ratePerEur: 11.1675, source: "ecb" }]);
  });

  it("rejects documents that are not ECB reference rates", () => {
    expect(() => parseEcbXml("<html><body>Maintenance</body></html>")).toThrow(/Not an ECB/);
    expect(() => parseEcbXml('<gesmes:Envelope xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><Cube></Cube></gesmes:Envelope>')).toThrow(
      /no dated rates/,
    );
    expect(() =>
      parseEcbXml(
        "<gesmes:Envelope xmlns='http://www.ecb.int/vocabulary/2002-08-01/eurofxref'><Cube><Cube time='2026-10-09'><Cube currency='USD' rate='abc'/></Cube></Cube></gesmes:Envelope>",
      ),
    ).toThrow(/Invalid ECB rate/);
    expect(() =>
      parseEcbXml("<gesmes:Envelope xmlns='eurofxref'><Cube><Cube time='9 Oct'><Cube currency='USD' rate='1'/></Cube></Cube></gesmes:Envelope>"),
    ).toThrow(/Unexpected date/);
  });
});

describe("fetchEcbRates", () => {
  it("parses a successful response from the injected fetch", async () => {
    const body = fixture("ecb-daily.xml");
    const rates = await fetchEcbRates("daily", { fetch: async () => new Response(body, { status: 200 }) });
    expect(rates).toHaveLength(5);
  });

  it("reports HTTP errors and timeouts clearly", async () => {
    await expect(fetchEcbRates("daily", { fetch: async () => new Response("nope", { status: 503 }) })).rejects.toThrow(/HTTP 503/);
    const hang: typeof fetch = (_url, init) =>
      new Promise((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)));
    await expect(fetchEcbRates("daily", { fetch: hang, timeoutMs: 20 })).rejects.toThrow(/timed out after 20 ms/);
    await expect(fetchEcbRates("90d", { fetch: async () => Promise.reject(new TypeError("fetch failed")) })).rejects.toThrow(/Could not reach/);
  });
});
