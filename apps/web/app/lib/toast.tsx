import { createContext, useCallback, useContext, useMemo, useState } from "react";

type ToastKind = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const KIND_CLASS: Record<ToastKind, string> = {
  success: "border-green-500/40 bg-green-500/15 text-green-100",
  error: "border-red-500/40 bg-red-500/15 text-red-100",
  info: "border-emerald-400/30 bg-slate-900/95 text-slate-100",
  warning: "border-amber-400/40 bg-amber-500/15 text-amber-50",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, kind: ToastKind = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setItems((prev) => [...prev, { id, kind, message }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      toast: push,
      success: (message) => push(message, "success"),
      error: (message) => push(message, "error"),
      info: (message) => push(message, "info"),
      warn: (message) => push(message, "warning"),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4">
        {items.map((item) => (
          <div
            key={item.id}
            className={`pointer-events-auto w-full max-w-md rounded-2xl border px-4 py-3 text-sm shadow-xl shadow-black/40 backdrop-blur ${KIND_CLASS[item.kind]}`}
            role="status"
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast deve ser usado dentro de ToastProvider");
  }
  return ctx;
}
