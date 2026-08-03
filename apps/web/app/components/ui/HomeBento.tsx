import { Link } from "react-router";

import { cn } from "../../lib/cn";
import { btnAccent, btnGhost, btnPrimary } from "../../lib/ui-classes";

interface HomeBentoProps {
  loggedIn: boolean;
}

/** Layout bento inspirado no Feature Bento do 21st.dev, com identidade SoftMusic. */
export function HomeBento({ loggedIn }: HomeBentoProps) {
  return (
    <div className="grid auto-rows-[minmax(10rem,auto)] grid-cols-1 gap-3 md:grid-cols-3 md:auto-rows-[minmax(11rem,auto)]">
      <div className="sm-shine-card relative overflow-hidden rounded-3xl border border-green-500/25 bg-gradient-to-br from-green-600/30 via-[#0a1610] to-[#020806] p-6 sm:p-8 md:col-span-2 md:row-span-2 md:p-10">
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-green-400/20 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-20 left-10 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl"
          aria-hidden
        />
        <div className="sm-shine-sweep pointer-events-none absolute inset-0" aria-hidden />

        <div className="relative z-10 flex h-full flex-col justify-end">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-green-100 backdrop-blur-sm">
            <span className="size-2 animate-pulse rounded-full bg-green-400" />
            SoftMusic para bandas
          </span>
          <h1 className="font-display mt-4 max-w-xl text-3xl font-bold leading-[1.08] text-white sm:text-4xl md:text-5xl">
            Ensaie melhor.
            <span className="mt-1 block bg-gradient-to-r from-green-200 to-emerald-400 bg-clip-text text-transparent">
              Entenda a música.
            </span>
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/80 sm:text-base">
            Análise com IA, cifra, stems Demucs, metrônomo e agenda — tudo no mesmo lugar para o
            ensaio render de verdade.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {loggedIn ? (
              <>
                <Link to="/analyze" className={`${btnAccent} text-center`}>
                  Analisar música
                </Link>
                <Link to="/library" className={`${btnGhost} border-white/20 text-center text-white`}>
                  Abrir biblioteca
                </Link>
                <Link to="/dashboard" className={`${btnPrimary} text-center`}>
                  Ver resumo
                </Link>
              </>
            ) : (
              <>
                <Link to="/cadastro" className={`${btnPrimary} text-center`}>
                  Criar conta grátis
                </Link>
                <Link to="/login" className={`${btnGhost} border-white/20 text-center text-white`}>
                  Já tenho conta
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      {loggedIn ? (
        <>
          <BentoLink
            to="/analyze"
            eyebrow="IA"
            title="Analisar"
            description="YouTube ou arquivo → harmonia, BPM e stems"
            tone="accent"
          />
          <BentoLink
            to="/library"
            eyebrow="Treino"
            title="Biblioteca"
            description="Cifras, player e faixas separadas"
          />
          <BentoLink
            to="/agenda"
            eyebrow="Equipe"
            title="Agenda"
            description="Ensaios, eventos e repertório"
          />
          <BentoLink
            to="/bandas"
            eyebrow="Gestão"
            title="Bandas"
            description="Membros, funções e convites"
            tone="brand"
          />
        </>
      ) : (
        <>
          <StepCard step="1" title="Cadastre" body="Crie a banda e convide a equipe" />
          <StepCard step="2" title="Analise" body="Gere cifra, tom e stems do áudio" />
          <StepCard step="3" title="Ensaie" body="Monte a agenda e treine com o player" className="md:col-span-1" />
        </>
      )}
    </div>
  );
}

function BentoLink({
  to,
  eyebrow,
  title,
  description,
  tone = "default",
}: {
  to: string;
  eyebrow: string;
  title: string;
  description: string;
  tone?: "default" | "accent" | "brand";
}) {
  return (
    <Link
      to={to}
      className={cn(
        "sm-shine-card group relative flex flex-col justify-between overflow-hidden rounded-3xl border p-5 transition duration-300",
        tone === "accent" &&
          "border-red-500/30 bg-gradient-to-br from-red-600/25 to-[#0a1610] hover:border-red-400/45",
        tone === "brand" &&
          "border-green-500/30 bg-gradient-to-br from-green-600/20 to-[#0a1610] hover:border-green-400/45",
        tone === "default" &&
          "border-white/[0.08] bg-white/[0.03] hover:border-green-500/30 hover:bg-white/[0.05]",
      )}
    >
      <div className="sm-shine-sweep pointer-events-none absolute inset-0 opacity-0 transition group-hover:opacity-100" aria-hidden />
      <div className="relative z-10 flex items-start justify-between gap-2">
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-200">
          {eyebrow}
        </span>
        <span className="flex size-8 items-center justify-center rounded-full bg-white/10 text-sm text-white transition group-hover:rotate-45 group-hover:bg-white/20">
          ↗
        </span>
      </div>
      <div className="relative z-10 mt-6">
        <p className="font-display text-xl font-bold text-white">{title}</p>
        <p className="mt-1 text-sm text-slate-300/90">{description}</p>
      </div>
    </Link>
  );
}

function StepCard({
  step,
  title,
  body,
  className,
}: {
  step: string;
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sm-shine-card relative overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.03] p-5",
        className,
      )}
    >
      <p className="font-display text-3xl font-black text-green-400/90">{step}</p>
      <p className="font-display mt-3 text-lg font-semibold text-slate-50">{title}</p>
      <p className="mt-1 text-sm text-slate-400">{body}</p>
    </div>
  );
}
