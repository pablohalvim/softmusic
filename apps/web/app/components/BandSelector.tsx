import { useBand } from "../lib/band-context";

export function BandSelector() {
  const { bands, activeBand, setActiveBandId, loading } = useBand();

  if (loading || bands.length === 0) {
    return null;
  }

  return (
    <label className="flex items-center gap-2 text-sm text-slate-300">
      <span className="hidden sm:inline">Banda</span>
      <select
        value={activeBand?.id ?? ""}
        onChange={(event) => setActiveBandId(event.target.value)}
        className="sm-input py-1.5 text-sm"
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
