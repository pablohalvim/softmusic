interface VolumeControlProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  className?: string;
}

export function VolumeControl({ label, value, onChange, className }: VolumeControlProps) {
  const percent = Math.round(value * 100);

  return (
    <label className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <span className="flex items-center justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span className="tabular-nums text-slate-500">{percent}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        className="accent-chord h-3 w-full cursor-pointer"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      />
    </label>
  );
}
