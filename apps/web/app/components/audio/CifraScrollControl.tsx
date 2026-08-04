import { useOptionalCifraScroll } from "../cifra/cifra-scroll-context";

interface CifraScrollControlProps {
  compact?: boolean;
}

export function CifraScrollControl({ compact = false }: CifraScrollControlProps) {
  const scroll = useOptionalCifraScroll();
  if (!scroll) return null;

  const { playing, togglePlaying } = scroll;

  return (
    <button
      type="button"
      data-cifra-scroll-control
      onClick={togglePlaying}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
        playing
          ? "border-green-500/50 bg-green-500/15 text-green-300 hover:bg-green-500/25"
          : "border-white/10 text-slate-200 hover:border-green-500/40 hover:text-green-300"
      } ${compact ? "py-1" : ""}`}
      aria-label={playing ? "Parar rolagem da cifra" : "Iniciar rolagem da cifra"}
      title={playing ? "Parar rolagem (não afeta o áudio)" : "Iniciar rolagem (não afeta o áudio)"}
    >
      <span
        className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] leading-none ${
          playing ? "bg-green-500/30 text-green-200" : "bg-sky-500/25 text-sky-200"
        }`}
        aria-hidden
      >
        {playing ? "⏸" : "▶"}
      </span>
      {playing ? "Rolando" : "Rolagem"}
    </button>
  );
}
