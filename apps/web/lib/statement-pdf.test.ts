import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURE_STATEMENTS } from "./accounting/fixtures.ts";
import { fetchLogo, imageKind, renderStatementPdf, type StatementPdfInput } from "./statement-pdf.ts";

const brand = { name: "Demo Agency", address: "Example Street 1\n00100 Example City", footer: "Payment within 14 days.", logoUrl: null, showModelNames: true };

function input(i: number, o: Partial<StatementPdfInput> = {}): StatementPdfInput {
  const s = FIXTURE_STATEMENTS[i]!;
  return {
    brand,
    logo: null,
    clientName: s.client.name,
    status: s.status,
    invoice: s.invoice,
    data: s.data,
    showModelNames: s.showModelNames,
    now: new Date("2026-10-12T08:00:00Z"),
    ...o,
  };
}

const latin1 = (b: Buffer) => b.toString("latin1");
/** PDFKit writes info strings as literals, in UTF-16BE when they contain non-ASCII characters. */
const hasInfoText = (pdf: Buffer, s: string) => latin1(pdf).includes(s) || latin1(pdf).includes(Buffer.from(s, "utf16le").swap16().toString("latin1"));

// A 1x1 transparent PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

describe("statement PDF", () => {
  it("renders a valid PDF that carries the statement number", async () => {
    const pdf = await renderStatementPdf(input(0));
    if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, pdf);
    expect(latin1(pdf.subarray(0, 5))).toBe("%PDF-");
    expect(latin1(pdf).trimEnd().endsWith("%%EOF")).toBe(true);
    expect(hasInfoText(pdf, "ST-2026-0001")).toBe(true);
    // Embedded font subsets, not the standard 14 fonts.
    expect(latin1(pdf)).toMatch(/\/FontFile2/);
    expect(latin1(pdf)).toMatch(/IBMPlexSans/);
    expect(latin1(pdf)).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
  });

  it("renders a JPY fixed-fee statement, a draft and a logo", async () => {
    const jpy = await renderStatementPdf(input(2, { logo: PNG }));
    expect(hasInfoText(jpy, "ST-2026-0003")).toBe(true);
    expect(latin1(jpy)).toMatch(/\/Subtype \/Image/);
    const draft = await renderStatementPdf(input(3));
    expect(latin1(draft.subarray(0, 5))).toBe("%PDF-");
  });

  it("breaks long statements over several pages", async () => {
    const s = FIXTURE_STATEMENTS[0]!;
    const many = { ...s.data, lines: Array.from({ length: 80 }, (_, i) => ({ ...s.data.lines[0]!, project: `Project ${i}` })) };
    const pdf = await renderStatementPdf(input(0, { data: many }));
    expect((latin1(pdf).match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });
});

describe("logo download", () => {
  it("accepts PNG and JPEG only", async () => {
    expect(imageKind(PNG)).toBe("png");
    expect(imageKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(imageKind(Buffer.from("<svg/>"))).toBeNull();
    const ok = (body: Buffer | string) => (async () => new Response(typeof body === "string" ? body : new Uint8Array(body))) as unknown as typeof fetch;
    expect(await fetchLogo("https://example.com/logo.png", ok(PNG))).toHaveLength(PNG.length);
    expect(await fetchLogo("https://example.com/logo.svg", ok("<svg/>"))).toBeNull();
    expect(await fetchLogo("file:///etc/passwd", ok(PNG))).toBeNull();
    expect(await fetchLogo(null)).toBeNull();
    const failing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await fetchLogo("https://example.com/logo.png", failing)).toBeNull();
  });
});
