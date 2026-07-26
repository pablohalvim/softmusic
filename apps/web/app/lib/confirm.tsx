import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { btnGhost, btnPrimary, panelClass } from "./ui-classes";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(
    null,
  );

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...options, resolve });
    });
  }, []);

  const value = useMemo(() => ({ confirm }), [confirm]);

  function close(result: boolean) {
    state?.resolve(result);
    setState(null);
  }

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {state ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center">
          <div
            className={`${panelClass} w-full max-w-md space-y-4 border-green-500/20 p-5 shadow-[0_0_40px_rgba(34,197,94,0.12)]`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <div>
              <h2 id="confirm-title" className="text-lg font-semibold text-slate-50">
                {state.title}
              </h2>
              <p className="mt-2 text-sm text-slate-300">{state.message}</p>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className={btnGhost} onClick={() => close(false)}>
                {state.cancelLabel ?? "Cancelar"}
              </button>
              <button
                type="button"
                className={
                  state.danger
                    ? `${btnGhost} border-red-500/40 text-red-200 hover:border-red-400`
                    : btnPrimary
                }
                onClick={() => close(true)}
              >
                {state.confirmLabel ?? "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm deve ser usado dentro de ConfirmProvider");
  }
  return ctx;
}
