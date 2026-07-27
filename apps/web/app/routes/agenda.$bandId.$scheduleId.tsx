import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import {
  fetchBandSchedule,
  formatScheduleMemberLabel,
  type BandScheduleSong,
  type ScheduleMember,
  type ScheduleOccurrence,
} from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { btnGhost, btnPrimary, linkClass, panelClass } from "../lib/ui-classes";

export default function AgendaDetailPage() {
  const { bandId, scheduleId } = useParams();
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["band-schedule", bandId, scheduleId],
    queryFn: () => fetchBandSchedule(bandId!, scheduleId!),
    enabled: Boolean(user && bandId && scheduleId),
  });

  if (!user) {
    return (
      <section className="space-y-4">
        <h1 className="sm-page-title">Agenda</h1>
        <p className="sm-page-subtitle">Entre para ver os detalhes desta escala.</p>
        <Link to="/login" className={btnPrimary}>
          Entrar
        </Link>
      </section>
    );
  }

  if (query.isLoading) {
    return <p className="text-slate-400">Carregando...</p>;
  }

  if (query.isError || !query.data) {
    return (
      <section className="space-y-4">
        <Link to="/agenda" className={linkClass}>
          ← Voltar à agenda
        </Link>
        <p className="text-red-400">
          {query.error instanceof Error
            ? query.error.message
            : "Não foi possível carregar esta escala"}
        </p>
      </section>
    );
  }

  const schedule = query.data;
  const songs = schedule.songs ?? [];
  const members = schedule.members ?? [];
  const occurrences = schedule.occurrences ?? [];

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <Link to="/agenda" className={linkClass}>
          ← Voltar à agenda
        </Link>
        <h1 className="sm-page-title">{schedule.title || "Escala"}</h1>
        <p className="sm-page-subtitle">Músicas, tom e participantes desta programação.</p>
      </div>

      <div className={`${panelClass} space-y-3 p-4`}>
        <h2 className="font-medium">Datas</h2>
        {occurrences.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma data ativa.</p>
        ) : (
          <ul className="space-y-3">
            {occurrences.map((occ) => (
              <OccurrenceRow key={occ.id} occurrence={occ} />
            ))}
          </ul>
        )}
      </div>

      <div className={`${panelClass} space-y-3 p-4`}>
        <h2 className="font-medium">Músicas</h2>
        {songs.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma música no repertório.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {songs.map((song, index) => (
              <SongRow key={song.song_id} song={song} index={index} />
            ))}
          </ul>
        )}
      </div>

      <div className={`${panelClass} space-y-3 p-4`}>
        <h2 className="font-medium">Integrantes</h2>
        {members.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum integrante escalado.</p>
        ) : (
          <ul className="space-y-2 text-sm text-slate-300">
            {members.map((member) => (
              <MemberRow key={member.member_id} member={member} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function OccurrenceRow({ occurrence }: { occurrence: ScheduleOccurrence }) {
  return (
    <li className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            occurrence.kind === "event"
              ? "bg-green-500/15 text-green-300"
              : "bg-amber-500/15 text-amber-300"
          }`}
        >
          {occurrence.kind === "event" ? "Evento" : "Ensaio"}
        </span>
        <span className="text-sm font-medium text-slate-200">
          {occurrence.title || (occurrence.kind === "event" ? "Evento" : "Ensaio")}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-300">
        {new Date(occurrence.starts_at).toLocaleString("pt-BR", {
          dateStyle: "short",
          timeStyle: "short",
        })}
        {" · até "}
        {new Date(occurrence.ends_at).toLocaleString("pt-BR", {
          dateStyle: "short",
          timeStyle: "short",
        })}
      </p>
      <p className="mt-1 text-sm text-slate-500">{occurrence.formatted_address}</p>
      {occurrence.maps_url ? (
        <a
          href={occurrence.maps_url}
          target="_blank"
          rel="noopener noreferrer"
          className={`${btnGhost} mt-3 inline-flex px-3 py-1.5 text-sm`}
        >
          Abrir no Maps
        </a>
      ) : null}
    </li>
  );
}

function SongRow({ song, index }: { song: BandScheduleSong; index: number }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 py-3 first:pt-0 last:pb-0">
      <div>
        <p className="text-sm font-medium text-slate-100">
          {index + 1}. {song.title || "Sem título"}
        </p>
        {song.artist ? <p className="text-xs text-slate-500">{song.artist}</p> : null}
      </div>
      <p className="text-sm text-slate-300">
        Tom: <span className="font-medium text-green-300">{song.musical_key || "—"}</span>
      </p>
    </li>
  );
}

function MemberRow({ member }: { member: ScheduleMember }) {
  return <li>{formatScheduleMemberLabel(member)}</li>;
}
