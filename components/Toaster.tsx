"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import { createContext, useCallback, useContext, useState } from "react";

type Tone = "info" | "error" | "success";
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

const Ctx = createContext<(message: string, tone?: Tone) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: Tone = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex flex-col items-center gap-2 px-4 pt-safe"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="mt-3 flex max-w-md animate-fade-up items-start gap-2.5 rounded-2xl border border-line bg-elevated px-4 py-3 text-sm text-ink shadow-soft"
          >
            {toast.tone === "error" ? (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
            ) : (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
            )}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
