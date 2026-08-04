import { formatDateTime } from "@softmusic/shared/datetime";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import {
  fetchMySchedules,
  formatScheduleMemberLabel,
  type MyScheduleItem,
} from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { btnGhost, btnPrimary, linkClass, panelClass } from "../lib/ui-classes";

export default function AgendaPage() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["schedule-mine"],
    queryFn: fetchMySchedules,
    enabled: Boolean(user),
  });

  if (!user) {
    return (
      <section className="space-y-4">
        <h1 className="sm-page-title">Agenda</h1>
        <p className="sm-page-subtitle">Entre para ver as escalas em que você participa.</p>
        <Link to="/login" className={btnPrimary}>
          Entrar
        </Link>
      </section>
    );
  }

  const items = query.data ?? [];

  return (
    <section className="space-y-6">
      <div>
        <h1 className="sm-page-title">Agenda</h1>
        <p className="sm-page-subtitle">
          Programações futuras em que você está escalado — músicas, tom e integrantes.
        </p>
      </div>

      {query.isLoading ? <p className="text-sm text-slate-400">Carregando...</p> : null}
      {query.isError ? (
        <p className="text-sm text-red-400">
          {query.error instanceof Error ? query.error.message : "Não foi possível carregar a agenda"}
        </p>
      ) : null}

      {!query.isLoading && !query.isError && items.length === 0 ? (
        <div className={`${panelClass} p-5`}>
          <p className="text-sm text-slate-400">Nenhuma escala futura com a sua participação.</p>
        </div>
      ) : null}

      <div className="space-y-3">
        {items.map((item) => (
          <AgendaCard key={`${item.schedule_id}-${item.id}`} item={item} />
        ))}
      </div>
    </section>
  );
}

function AgendaCard({ item }: { item: MyScheduleItem }) {
  const songs = item.songs ?? [];
  const members = item.members ?? [];

  return (
    <article className={`${panelClass} space-y-3 p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-slate-50">
              {item.title || item.band_name}
            </h2>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                item.kind === "event"
                  ? "bg-green-500/15 text-green-300"
                  : "bg-amber-500/15 text-amber-300"
              }`}
            >
              {item.kind === "event" ? "Evento" : "Ensaio"}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-400">{item.band_name}</p>
          <p className="mt-2 text-sm text-slate-300">
            {formatDateTime(item.starts_at)}
            {" · até "}
            {formatDateTime(item.ends_at)}
          </p>
          <p className="mt-1 line-clamp-2 text-sm text-slate-500">{item.formatted_address}</p>
        </div>
        <Link
          to={`/agenda/${item.band_id}/${item.schedule_id}`}
          className={`${btnPrimary} shrink-0 px-3 py-1.5 text-sm`}
        >
          Ver detalhes
        </Link>
      </div>

      <div className="grid gap-3 border-t border-white/10 pt-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Músicas</p>
          {songs.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">Sem repertório informado.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm text-slate-300">
              {songs.slice(0, 4).map((song) => (
                <li key={song.song_id}>
                  {song.title || "Sem título"}
                  {song.musical_key ? (
                    <span className="text-slate-500"> · Tom {song.musical_key}</span>
                  ) : null}
                </li>
              ))}
              {songs.length > 4 ? (
                <li className="text-slate-500">+{songs.length - 4} mais</li>
              ) : null}
            </ul>
          )}
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Integrantes</p>
          {members.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">Nenhum integrante.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm text-slate-300">
              {members.slice(0, 4).map((member) => (
                <li key={member.member_id}>{formatScheduleMemberLabel(member)}</li>
              ))}
              {members.length > 4 ? (
                <li className="text-slate-500">+{members.length - 4} mais</li>
              ) : null}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href={item.maps_url}
          target="_blank"
          rel="noopener noreferrer"
          className={`${btnGhost} px-3 py-1.5 text-sm`}
        >
          Localização
        </a>
        <Link to={`/agenda/${item.band_id}/${item.schedule_id}`} className={`${linkClass} text-sm`}>
          Ver músicas e participantes
        </Link>
      </div>
    </article>
  );
}
