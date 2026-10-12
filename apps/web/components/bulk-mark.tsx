"use client";

import { useEffect, useState } from "react";
import { ConfirmForm } from "./confirm-form.tsx";

type Selected = { id: string; status: string }[];

/** Row checkbox for the bulk actions; read by <BulkMark> through its data attributes. */
export function SelectStatement({ clientId, status, label }: { clientId: string; status: string; label: string }) {
  return <input type="checkbox" data-bulk={clientId} data-status={status} aria-label={label} className="size-5 shrink-0 cursor-pointer accent-[var(--accent)]" />;
}

/** "Select all" checkbox for the rows shown. */
export function SelectAllStatements() {
  return (
    <input
      type="checkbox"
      data-bulk-all
      aria-label="Select all closed and sent statements shown"
      className="size-5 cursor-pointer accent-[var(--accent)]"
      onChange={(e) => {
        for (const box of document.querySelectorAll<HTMLInputElement>("input[data-bulk]")) box.checked = e.currentTarget.checked;
        document.dispatchEvent(new Event("bulk-change"));
      }}
    />
  );
}

/**
 * Marks the selected statements of a month as sent or paid, behind the confirm dialog. Only closed
 * statements can be marked as sent and only sent ones as paid; the rest of the selection is skipped
 * and the dialog says how many that are.
 */
export function BulkMark({
  period,
  monthLabel,
  today,
  minIssueDate,
  markAction,
}: {
  period: string;
  monthLabel: string;
  today: string;
  minIssueDate: string;
  markAction: (form: FormData) => void | Promise<void>;
}) {
  const [selected, setSelected] = useState<Selected>([]);
  useEffect(() => {
    const read = () =>
      setSelected(
        [...document.querySelectorAll<HTMLInputElement>("input[data-bulk]")]
          .filter((b) => b.checked && b.offsetParent !== null)
          .map((b) => ({ id: b.dataset.bulk!, status: b.dataset.status! })),
      );
    const onChange = (e: Event) => {
      if (e.type === "change" && !(e.target instanceof HTMLInputElement && e.target.dataset.bulk !== undefined)) return;
      read();
    };
    document.addEventListener("change", onChange);
    document.addEventListener("bulk-change", onChange);
    // Phone and desktop layouts each render their own checkboxes; recount when the layout switches.
    window.addEventListener("resize", read);
    read();
    return () => {
      document.removeEventListener("change", onChange);
      document.removeEventListener("bulk-change", onChange);
      window.removeEventListener("resize", read);
    };
  }, []);

  const closed = selected.filter((s) => s.status === "closed");
  const sent = selected.filter((s) => s.status === "sent");
  const n = (k: number) => `${k} statement${k === 1 ? "" : "s"}`;
  const skipped = (k: number) => (selected.length - k > 0 ? ` ${n(selected.length - k)} of your selection ${selected.length - k === 1 ? "is" : "are"} skipped.` : "");

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[13px] text-ink-2" aria-live="polite">
        {selected.length ? `${n(selected.length)} selected` : "Select closed or sent statements to mark them in one go."}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <ConfirmForm
          action={markAction}
          fields={{ period, action: "mark_sent", clientId: closed.map((s) => s.id) }}
          icon="send"
          variant="quiet"
          disabled={closed.length === 0}
          label={closed.length ? `Mark ${closed.length} as sent` : "Mark as sent"}
          title={`Mark ${n(closed.length)} for ${monthLabel} as sent?`}
          body={`Records that ${closed.length === 1 ? "it" : "they"} went to the clients. Sent statements can't be reopened until they are unmarked one by one, and show as overdue after their due date.${skipped(closed.length)}`}
          extra={
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">
                Issue date <span className="font-normal text-ink-3">(optional)</span>
              </span>
              <input type="date" name="issueDate" min={minIssueDate} max={today} className="field num" />
              <span className="mt-1 block text-[13px] text-ink-3">Empty keeps each statement&apos;s close date. A date moves the due dates with it.</span>
            </label>
          }
          confirmLabel={`Mark ${closed.length} as sent`}
        />
        <ConfirmForm
          action={markAction}
          fields={{ period, action: "mark_paid", clientId: sent.map((s) => s.id) }}
          icon="check"
          variant="quiet"
          disabled={sent.length === 0}
          label={sent.length ? `Mark ${sent.length} as paid` : "Mark as paid"}
          title={`Mark ${n(sent.length)} for ${monthLabel} as paid?`}
          body={`Records today as the payment date; ${sent.length === 1 ? "it no longer counts" : "they no longer count"} as overdue. Each can be unmarked on its statement page.${skipped(sent.length)}`}
          confirmLabel={`Mark ${sent.length} as paid`}
        />
      </div>
    </div>
  );
}
