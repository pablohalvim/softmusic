import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router";

import { resolvePageTutorial } from "../lib/page-tutorials";
import { btnGhost, modalOverlayClass, modalPanelClass } from "../lib/ui-classes";

export function PageTutorialButton() {
  const { pathname } = useLocation();
  const tutorial = resolvePageTutorial(pathname);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const tooltipId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!tutorial) return null;

  const dialog =
    open && mounted
      ? createPortal(
          <div
            className={`${modalOverlayClass} items-center justify-center`}
            role="presentation"
            onClick={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className={`${modalPanelClass} max-h-[min(85vh,40rem)] max-w-lg overflow-y-auto sm-animate-in`}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-green-400/90">
                    Tutorial
                  </p>
                  <h2 id={titleId} className="mt-1 font-display text-xl font-semibold text-slate-50">
                    {tutorial.title}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{tutorial.summary}</p>
                </div>
                <button
                  type="button"
                  className={`${btnGhost} shrink-0 px-2.5 py-1.5 text-sm`}
                  onClick={() => setOpen(false)}
                  aria-label="Fechar tutorial"
                >
                  ✕
                </button>
              </div>

              <ol className="space-y-3">
                {tutorial.sections.map((section, index) => (
                  <li
                    key={section.title}
                    className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3.5"
                  >
                    <p className="flex items-center gap-2 text-sm font-semibold text-green-200">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-500/15 text-xs text-green-300">
                        {index + 1}
                      </span>
                      {section.title}
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-slate-300">{section.body}</p>
                  </li>
                ))}
              </ol>

              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  className="sm-btn-primary px-4 py-2 text-sm"
                  onClick={() => setOpen(false)}
                >
                  Entendi
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div className="group relative">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="tutorial-help-btn"
          aria-label="Tutorial da página"
          aria-describedby={tooltipId}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <span aria-hidden>?</span>
        </button>
        <span
          id={tooltipId}
          role="tooltip"
          className="tutorial-help-tooltip pointer-events-none absolute right-0 top-[calc(100%+0.45rem)] z-50 whitespace-nowrap rounded-lg border border-white/10 bg-[#0a1610]/95 px-2.5 py-1.5 text-xs font-medium text-slate-100 opacity-0 shadow-xl backdrop-blur-md transition duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          Tutorial da página
        </span>
      </div>
      {dialog}
    </>
  );
}
