import { useBand } from "../lib/band-context";

export function BandSelector() {
  const { bands, activeBand, setActiveBandId, loading } = useBand();

  if (loading || bands.length === 0) {
    return null;
  }

  return (
    <label className="flex max-w-[9.5rem] items-center gap-2 text-sm text-slate-300 sm:max-w-none">
      <span className="hidden lg:inline">Banda</span>
      <select
        value={activeBand?.id ?? ""}
        onChange={(event) => setActiveBandId(event.target.value)}
        className="sm-input max-w-full truncate py-1.5 text-sm"
        aria-label="Banda ativa"
      >
        {bands.map((band) => (
          <option key={band.id} value={band.id}>
            {band.name}
          </option>
        ))}
      </select>
    </label>
  );
}
