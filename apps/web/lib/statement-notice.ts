type SP = Record<string, string | string[] | undefined>;

const NO_RATE = "add a manual rate under Settings > Exchange rates, then try again.";

function count(v: string | string[] | undefined): number {
  const n = typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

const statements = (n: number) => `${n} statement${n === 1 ? "" : "s"}`;

/**
 * Message for a statement action that could not finish. The action redirects with a code in the
 * URL, because the form that sent it may be gone from the page by then. Unknown codes show nothing.
 */
export function statementNotice(sp: SP): string | null {
  switch (sp.notice) {
    case "no-rate":
      return `No exchange rate for this month, so the statement wasn't closed. Wait for the next rate download or ${NO_RATE}`;
    case "close-partial": {
      const closed = count(sp.closed);
      const noRate = count(sp.noRate);
      return `Closed ${statements(closed)}. ${statements(noRate)} stayed open because the exchange rate is missing: ${NO_RATE}`;
    }
    case "not-ended":
      return "This month hasn't ended yet, so it can't be closed.";
    case "invalid-date":
      return "Nothing was changed: the issue date must be a valid date on or after the last day of the month.";
    case "not-allowed":
      return "Nothing was changed: the statement's status changed in the meantime. Check it and try again.";
    case "skipped":
      return `Marked ${statements(count(sp.done))}. ${statements(count(sp.skipped))} skipped because their status changed in the meantime.`;
    default:
      return null;
  }
}
