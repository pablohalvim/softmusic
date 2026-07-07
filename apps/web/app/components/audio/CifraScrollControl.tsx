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
      onClick={togglePlaying}
      className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
        playing
          ? "border-green-500/50 bg-green-500/15 text-green-300 hover:bg-green-500/25"
          : "border-white/10 text-slate-200 hover:border-green-500/40 hover:text-green-300"
      } ${compact ? "py-1" : ""}`}
      aria-label={playing ? "Pausar rolagem da cifra" : "Iniciar rolagem da cifra"}
      title={playing ? "Pausar rolagem" : "Iniciar rolagem"}
    >
      {playing ? "⏸ Rolagem" : "▶ Rolagem"}
    </button>
  );
}
