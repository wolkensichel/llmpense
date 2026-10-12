"use client";

import { useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Lock, LockOpen } from "lucide-react";

const ICONS = { lock: Lock, unlock: LockOpen } as const;

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
}: {
  action: (form: FormData) => void | Promise<void>;
  /** Hidden inputs sent with the form. */
  fields: Record<string, string>;
  label: string;
  icon?: keyof typeof ICONS;
  variant?: "primary" | "quiet";
  className?: string;
  title: string;
  body: string;
  confirmLabel: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  const [open, setOpen] = useState(false);
  const id = useId();
  const Icon = icon ? ICONS[icon] : null;

  return (
    <form
      ref={form}
      action={action}
      className={className}
      onSubmit={(e) => {
        if (confirmed.current) {
          confirmed.current = false;
          return;
        }
        e.preventDefault();
        setOpen(true);
        dialog.current?.showModal();
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton variant={variant} pending={open}>
        {Icon && <Icon size={16} aria-hidden />} {label}
      </SubmitButton>

      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        onClose={() => setOpen(false)}
        onKeyDown={(e) => {
          // Keep Tab and Shift+Tab cycling between the dialog's buttons.
          if (e.key !== "Tab") return;
          const items = [...(dialog.current?.querySelectorAll<HTMLElement>("button") ?? [])];
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
          <h2 id={`${id}-title`} className="text-[17px] leading-6 font-semibold">
            {title}
          </h2>
          <p id={`${id}-body`} className="mt-2 text-[14px] leading-relaxed text-ink-2">
            {body}
          </p>
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

function SubmitButton({ variant, pending, children }: { variant: "primary" | "quiet"; pending: boolean; children: React.ReactNode }) {
  const status = useFormStatus();
  return (
    <button
      className={`btn ${variant === "primary" ? "btn-primary" : "btn-quiet"} w-full`}
      disabled={status.pending}
      aria-haspopup="dialog"
      aria-expanded={pending}
    >
      {children}
    </button>
  );
}
