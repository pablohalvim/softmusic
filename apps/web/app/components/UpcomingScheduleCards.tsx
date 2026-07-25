import { formatRelativeTime } from "@softmusic/shared/datetime";
import { useQuery } from "@tanstack/react-query";

import { fetchUpcomingSchedule, type UpcomingOccurrence } from "../lib/api";
import { btnPrimary, panelClass } from "../lib/ui-classes";

export function UpcomingScheduleCards() {
  const query = useQuery({
    queryKey: ["schedule-upcoming"],
    queryFn: fetchUpcomingSchedule,
    staleTime: 30_000,
  });

  if (query.isLoading || query.isError || !query.data) {
    return null;
  }

  const { next_rehearsal, next_event } = query.data;
  if (!next_rehearsal && !next_event) {
    return null;
  }

  return (
    <section className="grid gap-3 sm:grid-cols-2" aria-label="Próximos compromissos">
      {next_rehearsal ? (
        <OccurrenceCard title="Ensaio próximo" occurrence={next_rehearsal} accent="amber" />
      ) : null}
      {next_event ? (
        <OccurrenceCard title="Evento próximo" occurrence={next_event} accent="green" />
      ) : null}
    </section>
  );
}

function OccurrenceCard({
  title,
  occurrence,
  accent,
}: {
  title: string;
  occurrence: UpcomingOccurrence;
  accent: "green" | "amber";
}) {
  const accentClass =
    accent === "green"
      ? "border-green-500/25 bg-green-500/[0.06]"
      : "border-amber-500/25 bg-amber-500/[0.06]";
  const labelClass = accent === "green" ? "text-green-300/80" : "text-amber-300/80";

  return (
    <article className={`${panelClass} ${accentClass} p-4`}>
      <p className={`text-xs font-medium uppercase tracking-wide ${labelClass}`}>{title}</p>
      <h2 className="mt-1 truncate text-lg font-semibold text-slate-50">
        {occurrence.title || occurrence.band_name}
      </h2>
      <p className="mt-1 text-sm text-slate-400">{occurrence.band_name}</p>
      <p className="mt-2 text-sm text-slate-300">
        {new Date(occurrence.starts_at).toLocaleString("pt-BR", {
          dateStyle: "short",
          timeStyle: "short",
        })}{" "}
        · {formatRelativeTime(occurrence.starts_at)}
      </p>
      <p className="mt-1 line-clamp-2 text-sm text-slate-400">{occurrence.formatted_address}</p>
      <a
        href={occurrence.maps_url}
        target="_blank"
        rel="noopener noreferrer"
        className={`${btnPrimary} mt-4 inline-flex w-full justify-center px-4 py-2.5 text-sm sm:w-auto`}
      >
        Localização
      </a>
    </article>
  );
}
