"use client";

import { AudioLines } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { usePrefs } from "@/lib/prefs";
import type { BookStatus } from "@/lib/types";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-serif text-xl font-semibold tracking-tight ${className}`}>
      <span className="grid size-8 place-items-center rounded-xl bg-accent text-accent-ink">
        <AudioLines className="size-4.5" strokeWidth={2.4} />
      </span>
      ayvu
    </span>
  );
}

export function Spinner({ className = "size-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-line ${className}`}>
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  );
}

export function StatusPill({ status, done, total }: { status: BookStatus; done?: number; total?: number }) {
  const { t } = usePrefs();
  const active = status === "preparing" || status === "generating" || status === "queued" || status === "uploaded";
  const tone =
    status === "failed"
      ? "bg-danger-soft text-danger"
      : status === "completed"
        ? "bg-success-soft text-success"
        : "bg-accent-soft text-accent";
  const label =
    status === "generating" && total ? t("status.progress", { done: done ?? 0, total }) : t(`status.${status}`);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}>
      {active && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {label}
    </span>
  );
}

/** Bottom sheet on phones, centered dialog on wider screens. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    // Trava o scroll da página por trás enquanto o sheet está aberto.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  // Portal no body: ancestrais com transform (ex.: animate-fade-up) viram containing block
  // de elementos fixed, e o sheet acabaria preso ao fim da página em vez da viewport.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="dialog" aria-modal>
      <button aria-label="Close" className="absolute inset-0 animate-fade bg-scrim backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative max-h-[85dvh] w-full animate-sheet-up overflow-y-auto rounded-t-[28px] border border-line bg-surface p-5 pb-safe shadow-soft sm:max-w-md sm:animate-fade-up sm:rounded-[28px]">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong sm:hidden" />
        {title && <h2 className="mb-4 font-serif text-xl">{title}</h2>}
        <div className="pb-3">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = usePrefs();
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {body && <p className="mb-6 text-[15px] leading-relaxed text-muted">{body}</p>}
      <div className="flex gap-3">
        <button className="btn-secondary flex-1" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button className={`${danger ? "btn-danger" : "btn-primary"} flex-1`} onClick={onConfirm} disabled={busy}>
          {busy ? <Spinner className="size-4" /> : confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}
