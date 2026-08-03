import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

interface ShineStatCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "brand" | "muted" | "danger" | "hero";
  className?: string;
}

/** Inspirado em glass/glowing cards do 21st.dev — adaptado à paleta SoftMusic. */
export function ShineStatCard({
  label,
  value,
  hint,
  tone = "muted",
  className,
}: ShineStatCardProps) {
  return (
    <article
      className={cn(
        "sm-shine-card relative overflow-hidden rounded-2xl border p-5 backdrop-blur-md",
        tone === "hero" &&
          "border-green-500/25 bg-gradient-to-br from-green-500/15 via-[#0a1610]/90 to-[#050f0a]",
        tone === "brand" && "border-green-500/20 bg-green-500/[0.07]",
        tone === "muted" && "border-white/[0.08] bg-white/[0.03]",
        tone === "danger" && "border-red-500/25 bg-red-500/[0.07]",
        className,
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full blur-2xl",
          tone === "danger" ? "bg-red-500/20" : "bg-green-400/20",
        )}
        aria-hidden
      />
      <div className="sm-shine-sweep pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative z-10">
        <p
          className={cn(
            "text-sm",
            tone === "danger" ? "text-red-200/80" : "text-green-200/75",
            tone === "muted" && "text-slate-400",
          )}
        >
          {label}
        </p>
        <p
          className={cn(
            "font-display mt-2 font-bold tracking-tight",
            tone === "hero" ? "text-5xl text-green-300 drop-shadow-[0_0_24px_rgba(74,222,128,0.35)]" : "text-2xl",
            tone === "brand" && "text-green-300",
            tone === "muted" && "text-slate-100",
            tone === "danger" && "text-red-300",
          )}
        >
          {value}
        </p>
        {hint ? <p className="mt-2 text-sm text-slate-400">{hint}</p> : null}
      </div>
    </article>
  );
}
