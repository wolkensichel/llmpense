"use client";

import { useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { CircleCheck, Lock, LockOpen, Send, Undo2 } from "lucide-react";

const ICONS = { lock: Lock, unlock: LockOpen, send: Send, check: CircleCheck, undo: Undo2 } as const;

/**
 * A form whose submit button asks for confirmation first, in a modal dialog that states the
 * consequence. The dialog only gates the submission: the form posts to the same server action
 * as before, and without JavaScript it submits directly.
 *
 * The native modal <dialog> makes the rest of the page inert, Tab cycles inside it, it closes on
 * Esc, and returns focus to the button that opened it.
 */
export function ConfirmForm({
  action,
  fields,
  label,
  icon,
  variant = "primary",
  className = "",
  title,
  body,
  confirmLabel,
  id,
  extra,
  disabled = false,
}: {
  action: (form: FormData) => void | Promise<void>;
  /** Hidden inputs sent with the form. */
  /** Hidden inputs; an array repeats the name (e.g. several selected ids). */
  fields: Record<string, string | readonly string[]>;
  label: string;
  icon?: keyof typeof ICONS;
  variant?: "primary" | "quiet";
  className?: string;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  /** Form id, so inputs elsewhere on the page (e.g. row checkboxes) can belong to it via `form=`. */
  id?: string;
  /** Extra form controls shown in the dialog, e.g. a date. */
  extra?: React.ReactNode;
  disabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  const [open, setOpen] = useState(false);
  const uid = useId();
  const Icon = icon ? ICONS[icon] : null;

  return (
    <form
      ref={form}
      id={id}
      action={action}
      className={className}
      onSubmit={(e) => {
        if (confirmed.current) {
          confirmed.current = false;
          return;
        }
        // Enter in a field inside the open dialog counts as confirming.
        if (dialog.current?.open) {
          dialog.current.close();
          return;
        }
        e.preventDefault();
        setOpen(true);
        dialog.current?.showModal();
      }}
    >
      {Object.entries(fields).flatMap(([name, value]) =>
        (typeof value === "string" ? [value] : value).map((v, i) => <input key={`${name}-${i}`} type="hidden" name={name} value={v} />),
      )}
      <SubmitButton variant={variant} pending={open} disabled={disabled}>
        {Icon && <Icon size={16} aria-hidden />} {label}
      </SubmitButton>

      <dialog
        ref={dialog}
        aria-labelledby={`${uid}-title`}
        aria-describedby={`${uid}-body`}
        onClose={() => setOpen(false)}
        onKeyDown={(e) => {
          // Keep Tab and Shift+Tab cycling between the dialog's controls.
          if (e.key !== "Tab") return;
          const items = [...(dialog.current?.querySelectorAll<HTMLElement>("button, input, select") ?? [])];
          const first = items[0];
          const last = items.at(-1);
          if (!first || !last) return;
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
        onClick={(e) => {
          // A click on the backdrop (the dialog element itself, outside its panel) cancels.
          if (e.target === dialog.current) dialog.current?.close();
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-line bg-surface p-0 text-ink shadow-[0_12px_40px_rgba(16,24,40,0.25)] backdrop:bg-[rgba(15,20,27,0.55)]"
      >
        <div className="p-5">
          <h2 id={`${uid}-title`} className="text-[17px] leading-6 font-semibold">
            {title}
          </h2>
          <div id={`${uid}-body`} className="mt-2 text-[14px] leading-relaxed text-ink-2">
            {body}
          </div>
          {extra && <div className="mt-4">{extra}</div>}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" autoFocus className="btn btn-quiet w-full sm:w-auto" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary w-full sm:w-auto"
              onClick={() => {
                confirmed.current = true;
                dialog.current?.close();
                form.current?.requestSubmit();
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
    </form>
  );
}

function SubmitButton({
  variant,
  pending,
  disabled,
  children,
}: {
  variant: "primary" | "quiet";
  pending: boolean;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const status = useFormStatus();
  return (
    <button
      className={`btn ${variant === "primary" ? "btn-primary" : "btn-quiet"} w-full`}
      disabled={status.pending || disabled}
      aria-haspopup="dialog"
      aria-expanded={pending}
    >
      {children}
    </button>
  );
}
