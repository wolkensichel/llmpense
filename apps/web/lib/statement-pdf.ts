import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import {
  aggregateLinesByProject,
  CURRENCY_NAMES,
  ECB_ACKNOWLEDGEMENT,
  formatMoney,
  parsePeriod,
  rateNote,
  type StatementData,
  type StatementLine,
  type StatementStatus,
} from "@llmpense/core";
import type { Branding } from "./branding.ts";
import { compactNum, count, longDate, monthLabel, shortDate } from "./format.ts";

/**
 * The client-facing statement as an A4 PDF, drawn with PDFKit (no browser). Same content as the
 * print view: agency branding, statement number and dates, line items in the billing currency,
 * totals, the exchange-rate note and the footer. Fonts (IBM Plex Sans, OFL) are embedded as
 * subsets.
 */
export interface StatementPdfInput {
  brand: Branding;
  /** PNG or JPEG bytes of the logo, or null. */
  logo: Uint8Array | null;
  clientName: string;
  status: StatementStatus;
  invoice: { number: string | null; issueDate: string | null; dueDate: string | null };
  data: StatementData;
  showModelNames: boolean;
  /** "As of" date for drafts and the end of the prorated fee. */
  now: Date;
}

const FONT_DIR_CANDIDATES = [join(process.cwd(), "assets/fonts"), join(process.cwd(), "apps/web/assets/fonts")];

function fontDir(): string {
  const dir = FONT_DIR_CANDIDATES.find((d) => existsSync(join(d, "IBMPlexSans-Regular.ttf")));
  if (!dir) throw new Error("Statement PDF fonts not found (apps/web/assets/fonts)");
  return dir;
}

let fontCache: { regular: Buffer; semibold: Buffer } | null = null;
function fonts() {
  if (!fontCache) {
    const dir = fontDir();
    fontCache = { regular: readFileSync(join(dir, "IBMPlexSans-Regular.ttf")), semibold: readFileSync(join(dir, "IBMPlexSans-SemiBold.ttf")) };
  }
  return fontCache;
}

const INK = "#15171c";
const INK2 = "#4b4f58";
const INK3 = "#767a83";
const LINE = "#e3e6ea";
const LINE_STRONG = "#cfd4da";
const DRAFT = "#8a5a00";

const A4 = { w: 595.28, h: 841.89 };
const M = { x: 40, top: 40, bottom: 48 };
const W = A4.w - 2 * M.x;

const day = (iso: string) => longDate(new Date(`${iso}T00:00:00Z`));

export function renderStatementPdf(input: StatementPdfInput): Promise<Buffer> {
  const { brand, data, status, invoice } = input;
  const { totals, terms, feeCoverage, fx } = data;
  const period = parsePeriod(data.period)!;
  const c = terms.currency;
  const f = fonts();
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: M.top, bottom: M.bottom, left: M.x, right: M.x },
    bufferPages: true,
    autoFirstPage: true,
    info: {
      Title: `Statement ${invoice.number ?? data.period} ${input.clientName}`,
      Author: brand.name,
      Subject: `AI usage, ${monthLabel(data.period)}`,
      Creator: "LLMpense",
    },
  });
  doc.registerFont("regular", f.regular);
  doc.registerFont("semibold", f.semibold);
  const chunks: Buffer[] = [];
  doc.on("data", (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const text = (s: string, x: number, y: number, o: PDFKit.Mixins.TextOptions & { font?: string; size?: number; color?: string } = {}) => {
    doc.font(o.font ?? "regular").fontSize(o.size ?? 9.5).fillColor(o.color ?? INK);
    doc.text(s, x, y, { lineBreak: true, ...o });
    return doc.y;
  };
  const rule = (y: number, color = LINE, width = 0.75, x1 = M.x, x2 = M.x + W) => {
    doc.moveTo(x1, y).lineTo(x2, y).lineWidth(width).strokeColor(color).stroke();
  };
  const amt = (n: number | null) => (n === null ? "–" : formatMoney(n, c));

  // ---------------------------------------------------------------- header
  let left = M.top;
  if (input.logo) {
    try {
      doc.image(Buffer.from(input.logo), M.x, left, { fit: [150, 40] });
      left += 50;
    } catch {
      // Unsupported image data: leave the logo out.
    }
  }
  left = text(brand.name, M.x, left, { font: "semibold", size: 13, width: W * 0.55 });
  if (brand.address) left = text(brand.address, M.x, left + 3, { size: 9, color: INK2, width: W * 0.55 });

  let right = M.top;
  const rx = M.x + W * 0.55;
  const rw = W * 0.45;
  right = text(status === "draft" ? "Statement (draft)" : "Statement", rx, right, { font: "semibold", size: 18, width: rw, align: "right" });
  right = text(`AI usage, ${monthLabel(data.period)}`, rx, right + 1, { size: 9.5, color: INK2, width: rw, align: "right" });
  if (status === "draft") {
    right = text("Draft: may still change", rx, right + 2, { size: 8.5, color: DRAFT, width: rw, align: "right" });
  }

  // ---------------------------------------------------------------- meta row
  let y = Math.max(left, right) + 22;
  rule(y);
  y += 10;
  const lastDay = new Date(Math.min(period.end.getTime(), input.now.getTime()) - 1);
  const meta: [string, string][] = [
    ["Client", input.clientName],
    ["Statement no.", invoice.number ?? "Not assigned yet"],
    ["Period (UTC)", `${shortDate(period.start)} – ${shortDate(lastDay)}, ${lastDay.getUTCFullYear()}`],
    [status === "draft" ? "As of" : "Issue date", invoice.issueDate && status !== "draft" ? day(invoice.issueDate) : longDate(input.now)],
    ["Due date", invoice.dueDate && status !== "draft" ? day(invoice.dueDate) : "–"],
  ];
  const colW = [W * 0.26, W * 0.19, W * 0.21, W * 0.17, W * 0.17];
  let mx = M.x;
  let metaBottom = y;
  meta.forEach(([k, v], i) => {
    text(k, mx, y, { size: 8, color: INK3, width: colW[i]! - 8 });
    const b = text(v, mx, y + 11, { font: i === 0 || i === 1 ? "semibold" : "regular", size: 9.5, width: colW[i]! - 8 });
    metaBottom = Math.max(metaBottom, b);
    mx += colW[i]!;
  });
  y = metaBottom + 10;
  rule(y);

  // ---------------------------------------------------------------- line items
  const lines = input.showModelNames ? data.lines : aggregateLinesByProject(data.lines, c);
  const usage = lines.filter((l) => l.kind === "usage");
  const fee = lines.find((l) => l.kind === "fixed_fee");
  const cols = { desc: M.x, reqR: M.x + W * 0.66, tokR: M.x + W * 0.8, amtR: M.x + W };
  const numW = 70;
  const amountOf = (l: StatementLine) => (terms.billingMode === "fixed" ? "Included" : terms.billingMode === "absorbed" ? "No charge" : amt(l.billed));
  const pageBottom = A4.h - M.bottom - 40;

  const tableHeader = (at: number) => {
    text("Description", cols.desc, at, { size: 8, color: INK3 });
    text("Requests", cols.reqR - numW, at, { size: 8, color: INK3, width: numW, align: "right" });
    text("Tokens", cols.tokR - numW, at, { size: 8, color: INK3, width: numW, align: "right" });
    text("Amount", cols.amtR - numW - 20, at, { size: 8, color: INK3, width: numW + 20, align: "right" });
    rule(at + 14, LINE_STRONG);
    return at + 20;
  };
  y = tableHeader(y + 16);

  const row = (title: string, sub: string | null, reqs: string, toks: string, amount: string) => {
    doc.font("semibold").fontSize(9.5);
    const descW = cols.reqR - numW - cols.desc - 8;
    const h = doc.heightOfString(title, { width: descW }) + (sub ? doc.font("regular").fontSize(8).heightOfString(sub, { width: descW }) + 1 : 0);
    if (y + h + 8 > pageBottom) {
      doc.addPage();
      y = tableHeader(M.top);
    }
    const top = y;
    let b = text(title, cols.desc, top, { font: "semibold", width: descW });
    if (sub) b = text(sub, cols.desc, b + 1, { size: 8, color: INK3, width: descW });
    text(reqs, cols.reqR - numW, top, { width: numW, align: "right" });
    text(toks, cols.tokR - numW, top, { width: numW, align: "right" });
    text(amount, cols.amtR - numW - 30, top, { width: numW + 30, align: "right" });
    y = Math.max(b, top + 12) + 6;
    rule(y - 2);
    y += 4;
  };

  if (usage.length === 0 && !fee) {
    text("No AI usage in this period.", M.x, y + 6, { color: INK3, width: W, align: "center" });
    y = doc.y + 14;
  }
  for (const l of usage) {
    row(
      l.project,
      input.showModelNames && l.model ? l.model : null,
      count(l.requests),
      compactNum(l.inputTokens + l.outputTokens + l.cacheReadTokens + l.cacheWriteTokens),
      amountOf(l),
    );
  }
  if (fee) {
    row(
      fee.project,
      feeCoverage === "to_date" ? `Prorated to ${longDate(input.now)} of ${amt(terms.fixedFee)} per month` : "Covers all AI usage in the period",
      "",
      "",
      amt(fee.billed),
    );
  }

  // ---------------------------------------------------------------- totals
  const note = rateNote(fx);
  const totalsH = (fee ? 30 : 0) + 30 + (note ? 16 : 0);
  if (y + totalsH > pageBottom) {
    doc.addPage();
    y = M.top;
  }
  const tx = M.x + W - 220;
  y += 6;
  const totalRow = (k: string, v: string, strong = false) => {
    text(k, tx, y, { font: strong ? "semibold" : "regular", size: strong ? 11 : 9.5, color: strong ? INK : INK2, width: 120 });
    text(v, tx + 100, y, { font: strong ? "semibold" : "regular", size: strong ? 11 : 9.5, color: strong ? INK : INK2, width: 120, align: "right" });
    y += strong ? 18 : 14;
  };
  if (fee) {
    totalRow("Usage", amt(totals.usageBilled));
    totalRow("Fixed fee", amt(totals.fixedFee));
  }
  rule(y, INK, 1, tx, M.x + W);
  y += 6;
  totalRow(`Total (${c})`, amt(totals.totalBilled), true);
  if (note) {
    text(note, M.x, y + 2, { size: 7.5, color: INK3, width: W, align: "right" });
    y = doc.y;
  }

  // ---------------------------------------------------------------- footer (last page, bottom)
  const footerLines = [
    brand.footer,
    `${brand.name} · Statement ${invoice.number ? `${invoice.number} ` : ""}for ${input.clientName}, ${monthLabel(data.period)}. Amounts in ${CURRENCY_NAMES[c]} (${c}); usage is counted per calendar month in UTC.`,
    note && fx?.source === "ecb" ? ECB_ACKNOWLEDGEMENT : null,
  ].filter((s): s is string => !!s);
  doc.font("regular").fontSize(8);
  const footerH = footerLines.reduce((a, s) => a + doc.heightOfString(s, { width: W }) + 3, 0) + 12;
  let fy = A4.h - M.bottom - 16 - footerH;
  if (fy < y + 20) {
    doc.addPage();
    fy = A4.h - M.bottom - 16 - footerH;
  }
  rule(fy);
  fy += 8;
  footerLines.forEach((s, i) => {
    fy = text(s, M.x, fy, { size: 8, color: i === 0 && brand.footer ? INK2 : INK3, width: W }) + 3;
  });

  // Page numbers on every page.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing below the bottom margin must not add a page.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    text(`${invoice.number ?? "Draft"} · Page ${i + 1} of ${range.count}`, M.x, A4.h - M.bottom + 4, { size: 7.5, color: INK3, width: W, align: "right", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}

// ---------------------------------------------------------------- logo

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** PNG or JPEG by magic bytes. */
export function imageKind(b: Uint8Array): "png" | "jpeg" | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  return null;
}

/**
 * Downloads the agency logo for the PDF: http(s) only, 3 seconds, at most 2 MB, PNG or JPEG
 * (other formats such as SVG are left out). Returns null on any failure.
 */
export async function fetchLogo(url: string | null, fetchImpl: typeof fetch = fetch): Promise<Uint8Array | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(3000), redirect: "follow", headers: { accept: "image/png,image/jpeg" } });
    if (!res.ok || !res.body) return null;
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_LOGO_BYTES) return null;
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_LOGO_BYTES) {
        await reader.cancel();
        return null;
      }
      parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const p of parts) {
      bytes.set(p, at);
      at += p.byteLength;
    }
    return imageKind(bytes) ? bytes : null;
  } catch {
    return null;
  }
}
