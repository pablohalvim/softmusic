import { useState } from "react";

import { usePwaInstall, type UsePwaInstallOptions } from "../lib/use-pwa-install";
import { modalOverlayClass, modalPanelClass } from "../lib/ui-classes";

interface InstallButtonProps extends UsePwaInstallOptions {
  className?: string;
  label?: string;
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="7" y="2" width="10" height="20" rx="2.5" />
      <path d="M11 18h2" />
    </svg>
  );
}

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15V3" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

function InstallHelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      className={`${modalOverlayClass} items-end sm:items-center`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pwa-install-title"
      onClick={onClose}
    >
      <div
        className={`${modalPanelClass} max-w-md text-slate-100`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id="pwa-install-title" className="text-lg font-semibold">
            Instalar o SoftMusic
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            aria-label="Fechar"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <ol className="list-decimal space-y-3 pl-5 text-sm text-slate-300">
          <li>
            <strong className="text-slate-100">iPhone/iPad (Safari):</strong> toque em{" "}
            <ShareIcon className="inline h-4 w-4 align-text-bottom" /> Compartilhar →{" "}
            <strong className="text-slate-100">Adicionar à Tela de Início</strong>.
          </li>
          <li>
            <strong className="text-slate-100">Android (Chrome):</strong> menu ⋮ →{" "}
            <strong className="text-slate-100">Instalar app</strong> ou{" "}
            <strong className="text-slate-100">Adicionar à tela inicial</strong>.
          </li>
          <li>
            <strong className="text-slate-100">Computador (Chrome/Edge):</strong> ícone de instalação na barra de endereço.
          </li>
        </ol>
      </div>
    </div>
  );
}

export function InstallButton({ className, label = "Instalar app", ...options }: InstallButtonProps) {
  const { showShortcut, install } = usePwaInstall(options);
  const [helpOpen, setHelpOpen] = useState(false);

  if (!showShortcut) return null;

  const handleClick = async () => {
    const result = await install();
    if (result === "instructions") {
      setHelpOpen(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        className={
          className ??
          "inline-flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:border-green-400 hover:text-white"
        }
      >
        <PhoneIcon className="h-4 w-4" />
        {label}
      </button>
      <InstallHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
