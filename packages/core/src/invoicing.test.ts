import { describe, expect, it } from "vitest";
import {
  addDays,
  allowedActions,
  counterYear,
  daysOverdue,
  dueDateFor,
  formatStatementNumber,
  isFrozen,
  isIsoDay,
  isIssued,
  isOverdue,
  nextStatus,
  paymentTermsFor,
  statementFileName,
  STATEMENT_ACTIONS,
  validateNumberFormat,
} from "./invoicing.ts";
import { STATEMENT_STATUSES, type StatementStatus } from "./statements.ts";

describe("statement lifecycle", () => {
  it("allows exactly the documented transitions", () => {
    const allowed: Record<string, StatementStatus> = {
      "draft/close": "closed",
      "closed/reopen": "draft",
      "closed/mark_sent": "sent",
      "sent/mark_paid": "paid",
      "sent/unmark_sent": "closed",
      "paid/unmark_paid": "sent",
    };
    for (const from of STATEMENT_STATUSES) {
      for (const action of STATEMENT_ACTIONS) {
        expect(nextStatus(from, action), `${from} -> ${action}`).toBe(allowed[`${from}/${action}`] ?? null);
      }
    }
  });

  it("refuses to reopen sent or paid statements and to skip steps", () => {
    expect(nextStatus("sent", "reopen")).toBeNull();
    expect(nextStatus("paid", "reopen")).toBeNull();
    expect(nextStatus("draft", "mark_sent")).toBeNull();
    expect(nextStatus("closed", "mark_paid")).toBeNull();
    expect(nextStatus("paid", "unmark_sent")).toBeNull();
    expect(nextStatus("closed", "close")).toBeNull();
  });

  it("lists the actions per status", () => {
    expect(allowedActions("draft")).toEqual(["close"]);
    expect(allowedActions("closed")).toEqual(["reopen", "mark_sent"]);
    expect(allowedActions("sent")).toEqual(["mark_paid", "unmark_sent"]);
    expect(allowedActions("paid")).toEqual(["unmark_paid"]);
  });

  it("treats every status but draft as frozen and issued", () => {
    expect(STATEMENT_STATUSES.filter(isFrozen)).toEqual(["closed", "sent", "paid"]);
    expect(STATEMENT_STATUSES.filter(isIssued)).toEqual(["closed", "sent", "paid"]);
  });
});

describe("statement numbers", () => {
  it("formats year and zero-padded counter", () => {
    expect(formatStatementNumber("ST-{YYYY}-{NNNN}", 2026, 1)).toBe("ST-2026-0001");
    expect(formatStatementNumber("INV/{YY}/{NNN}", 2026, 42)).toBe("INV/26/042");
    expect(formatStatementNumber("{N}", 2026, 12345)).toBe("12345");
    expect(formatStatementNumber("R{NN}", 2026, 123)).toBe("R123");
  });

  it("counts per year only when the format has a year", () => {
    expect(counterYear("ST-{YYYY}-{NNNN}", 2026)).toBe(2026);
    expect(counterYear("ST-{YY}{NNNN}", 2026)).toBe(2026);
    expect(counterYear("ST-{NNNNNN}", 2026)).toBe(0);
  });

  it("validates formats", () => {
    expect(validateNumberFormat("ST-{YYYY}-{NNNN}").ok).toBe(true);
    expect(validateNumberFormat("RE/{YY}/{NNNNN}").ok).toBe(true);
    expect(validateNumberFormat("").ok).toBe(false);
    expect(validateNumberFormat("ST-{YYYY}").ok).toBe(false);
    expect(validateNumberFormat("{NNNN}-{NNNN}").ok).toBe(false);
    expect(validateNumberFormat("ST {NNNN}").ok).toBe(false);
    expect(validateNumberFormat("ST.{NNNN}").ok).toBe(false);
    expect(validateNumberFormat("ST-{MM}-{NNNN}").ok).toBe(false);
    expect(validateNumberFormat("{NNNNNNNNN}").ok).toBe(false);
    expect(validateNumberFormat(`${"A".repeat(30)}-{NNNNNNNN}`).ok).toBe(false);
  });
});

describe("due dates", () => {
  it("adds payment terms in calendar days across months and leap years", () => {
    expect(dueDateFor("2026-10-02", 14)).toBe("2026-10-16");
    expect(dueDateFor("2026-12-20", 14)).toBe("2027-01-03");
    expect(dueDateFor("2028-02-20", 10)).toBe("2028-03-01");
    expect(addDays("2026-10-02", 0)).toBe("2026-10-02");
  });

  it("uses the client's terms when set", () => {
    expect(paymentTermsFor(14, null)).toBe(14);
    expect(paymentTermsFor(14, 30)).toBe(30);
    expect(paymentTermsFor(14, 0)).toBe(0);
  });

  it("marks sent statements overdue from the day after the due date", () => {
    expect(isOverdue("sent", "2026-10-16", "2026-10-16")).toBe(false);
    expect(isOverdue("sent", "2026-10-16", "2026-10-17")).toBe(true);
    expect(daysOverdue("sent", "2026-10-16", "2026-10-20")).toBe(4);
    expect(isOverdue("paid", "2026-10-16", "2026-11-01")).toBe(false);
    expect(isOverdue("closed", "2026-10-16", "2026-11-01")).toBe(false);
    expect(isOverdue("sent", null, "2026-11-01")).toBe(false);
  });

  it("validates ISO days", () => {
    expect(isIsoDay("2026-02-28")).toBe(true);
    expect(isIsoDay("2026-02-30")).toBe(false);
    expect(isIsoDay("26-02-01")).toBe(false);
  });
});

describe("file names", () => {
  it("joins number, client and month", () => {
    expect(statementFileName({ number: "ST-2026-0001", clientSlug: "acme-retail", period: "2026-09", ext: "pdf" })).toBe(
      "ST-2026-0001-acme-retail-2026-09.pdf",
    );
    expect(statementFileName({ number: "RE/26/7", clientSlug: "acme", period: "2026-09", ext: "pdf" })).toBe("RE-26-7-acme-2026-09.pdf");
    expect(statementFileName({ number: null, clientSlug: "acme", period: "2026-09", ext: "pdf" })).toBe("acme-2026-09.pdf");
  });
});
