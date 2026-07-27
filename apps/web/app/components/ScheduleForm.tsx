import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { Link, useNavigate } from "react-router";

import { KEY_OPTIONS } from "@softmusic/shared/chords";

import { PlacesAddressInput } from "./PlacesAddressInput";
import {
  createBandSchedule,
  fetchBandAddresses,
  fetchBandMembers,
  fetchBandSchedule,
  fetchSongs,
  updateScheduleOccurrence,
} from "../lib/api";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "../lib/datetime-local";
import type { PlaceSelection as Place } from "../lib/places";
import { btnGhost, btnPrimary, inputClass, labelClass, linkClass, panelClass } from "../lib/ui-classes";

type RehearsalDraft = {
  key: string;
  start: string;
  end: string;
  sameAsEvent: boolean;
  place: Place | null;
  savedId: string;
  saveAddress: boolean;
  saveLabel: string;
};

type SongDraft = {
  key: string;
  songId: string;
  musicalKey: string;
};

function newRehearsal(): RehearsalDraft {
  return {
    key: `reh_${Math.random().toString(36).slice(2, 9)}`,
    start: "",
    end: "",
    sameAsEvent: true,
    place: null,
    savedId: "",
    saveAddress: false,
    saveLabel: "",
  };
}

function newSongDraft(songId = "", musicalKey = ""): SongDraft {
  return {
    key: `song_${Math.random().toString(36).slice(2, 9)}`,
    songId,
    musicalKey,
  };
}

type Props = {
  bandId: string;
  mode: "create" | "edit";
  scheduleId?: string;
  occurrenceId?: string | null;
};

export function ScheduleForm({ bandId, mode, scheduleId, occurrenceId }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [eventStart, setEventStart] = useState("");
  const [eventEnd, setEventEnd] = useState("");
  const [eventPlace, setEventPlace] = useState<Place | null>(null);
  const [savedEventId, setSavedEventId] = useState("");
  const [saveEventAddress, setSaveEventAddress] = useState(false);
  const [saveEventLabel, setSaveEventLabel] = useState("");
  const [rehearsals, setRehearsals] = useState<RehearsalDraft[]>([newRehearsal()]);
  const [songs, setSongs] = useState<SongDraft[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  /** Funções escolhidas por integrante nesta escala. */
  const [selectedRoles, setSelectedRoles] = useState<Map<string, Set<string>>>(() => new Map());

  // Edit mode: single occurrence fields
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editPlace, setEditPlace] = useState<Place | null>(null);
  const [editSavedId, setEditSavedId] = useState("");
  const [editKind, setEditKind] = useState<"event" | "rehearsal">("event");

  const membersQuery = useQuery({
    queryKey: ["band-members", bandId],
    queryFn: () => fetchBandMembers(bandId),
  });
  const addressesQuery = useQuery({
    queryKey: ["band-addresses", bandId],
    queryFn: () => fetchBandAddresses(bandId),
  });
  const songsQuery = useQuery({
    queryKey: ["band-songs-picker", bandId],
    queryFn: () => fetchSongs(200),
  });
  const scheduleQuery = useQuery({
    queryKey: ["band-schedule", bandId, scheduleId],
    queryFn: () => fetchBandSchedule(bandId, scheduleId!),
    enabled: mode === "edit" && Boolean(scheduleId),
  });

  useEffect(() => {
    if (mode !== "edit" || !scheduleQuery.data) return;
    const schedule = scheduleQuery.data;
    const catalog = membersQuery.data ?? [];
    setTitle(schedule.title || "");
    setSelectedMembers(new Set(schedule.members.map((m) => m.member_id)));

    const rolesMap = new Map<string, Set<string>>();
    for (const entry of schedule.members) {
      if (entry.role_ids && entry.role_ids.length > 0) {
        rolesMap.set(entry.member_id, new Set(entry.role_ids));
        continue;
      }
      const profile = catalog.find((member) => member.id === entry.member_id);
      if (!profile) continue;
      if (entry.role_names && entry.role_names.length > 0) {
        const matched = profile.roles
          .filter((role) => entry.role_names!.includes(role.name))
          .map((role) => role.id);
        if (matched.length > 0) {
          rolesMap.set(entry.member_id, new Set(matched));
          continue;
        }
      }
      if (profile.roles.length === 1) {
        rolesMap.set(entry.member_id, new Set([profile.roles[0]!.id]));
      }
    }
    setSelectedRoles(rolesMap);

    setSongs(
      (schedule.songs ?? []).map((item) =>
        newSongDraft(item.song_id, item.musical_key || ""),
      ),
    );

    const occ =
      schedule.occurrences.find((o) => o.id === occurrenceId) ?? schedule.occurrences[0];
    if (!occ) return;
    setEditKind(occ.kind);
    setEditStart(toDatetimeLocalValue(occ.starts_at));
    setEditEnd(toDatetimeLocalValue(occ.ends_at));
    if (occ.saved_address_id) {
      setEditSavedId(occ.saved_address_id);
      setEditPlace(null);
    } else {
      setEditSavedId("");
      setEditPlace({
        formatted_address: occ.formatted_address,
        lat: occ.lat,
        lng: occ.lng,
        place_id: occ.place_id ?? null,
      });
    }
  }, [mode, scheduleQuery.data, occurrenceId, membersQuery.data]);

  function buildMembersPayload() {
    const catalog = membersQuery.data ?? [];
    return [...selectedMembers].map((memberId) => {
      const profile = catalog.find((member) => member.id === memberId);
      const picked = selectedRoles.get(memberId);
      let roleIds = picked ? [...picked] : [];
      if (roleIds.length === 0 && profile?.roles.length === 1) {
        roleIds = [profile.roles[0]!.id];
      }
      return { member_id: memberId, role_ids: roleIds };
    });
  }

  function assertMembersReady() {
    if (selectedMembers.size === 0) {
      throw new Error("Selecione ao menos um integrante");
    }
    const catalog = membersQuery.data ?? [];
    for (const memberId of selectedMembers) {
      const profile = catalog.find((member) => member.id === memberId);
      if (!profile || profile.roles.length === 0) continue;
      const picked = selectedRoles.get(memberId);
      const count = picked?.size ?? (profile.roles.length === 1 ? 1 : 0);
      if (count === 0) {
        throw new Error(`Escolha a função de ${profile.full_name} nesta escala`);
      }
    }
  }

  function buildSongsPayload() {
    const payload: Array<{ song_id: string; musical_key: string }> = [];
    const seen = new Set<string>();
    for (const item of songs) {
      if (!item.songId) {
        throw new Error("Selecione a música em cada linha do repertório");
      }
      if (seen.has(item.songId)) {
        throw new Error("Não repita a mesma música no repertório");
      }
      if (!item.musicalKey.trim()) {
        throw new Error("Informe o tom de cada música");
      }
      seen.add(item.songId);
      payload.push({ song_id: item.songId, musical_key: item.musicalKey.trim() });
    }
    return payload;
  }

  function toggleMember(memberId: string, roleIds: string[]) {
    const willSelect = !selectedMembers.has(memberId);
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (willSelect) next.add(memberId);
      else next.delete(memberId);
      return next;
    });
    setSelectedRoles((prev) => {
      const next = new Map(prev);
      if (!willSelect) {
        next.delete(memberId);
      } else if (roleIds.length === 1) {
        next.set(memberId, new Set(roleIds));
      } else if (roleIds.length > 1) {
        // Multi-função: começa sem seleção para o usuário escolher.
        next.set(memberId, new Set());
      } else {
        next.delete(memberId);
      }
      return next;
    });
  }

  function toggleMemberRole(memberId: string, roleId: string) {
    setSelectedRoles((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(memberId) ?? []);
      if (current.has(roleId)) current.delete(roleId);
      else current.add(roleId);
      next.set(memberId, current);
      return next;
    });
    setSelectedMembers((prev) => {
      if (prev.has(memberId)) return prev;
      const next = new Set(prev);
      next.add(memberId);
      return next;
    });
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      assertMembersReady();
      const saved = addressesQuery.data?.find((a) => a.id === savedEventId);
      if (!saved && !eventPlace) throw new Error("Informe o endereço do evento");
      if (!title.trim()) throw new Error("Informe o título");

      const eventBlock = saved
        ? {
            starts_at: fromDatetimeLocalValue(eventStart),
            ends_at: fromDatetimeLocalValue(eventEnd),
            saved_address_id: saved.id,
          }
        : {
            starts_at: fromDatetimeLocalValue(eventStart),
            ends_at: fromDatetimeLocalValue(eventEnd),
            formatted_address: eventPlace!.formatted_address,
            lat: eventPlace!.lat,
            lng: eventPlace!.lng,
            place_id: eventPlace!.place_id,
          };

      const rehearsalsPayload = rehearsals.map((reh) => {
        if (!reh.start || !reh.end) throw new Error("Informe início e fim de cada ensaio");
        if (reh.sameAsEvent) {
          return {
            starts_at: fromDatetimeLocalValue(reh.start),
            ends_at: fromDatetimeLocalValue(reh.end),
            same_as_event_address: true,
          };
        }
        const rehSaved = addressesQuery.data?.find((a) => a.id === reh.savedId);
        if (rehSaved) {
          return {
            starts_at: fromDatetimeLocalValue(reh.start),
            ends_at: fromDatetimeLocalValue(reh.end),
            saved_address_id: rehSaved.id,
            save_address: false,
          };
        }
        if (!reh.place) throw new Error("Informe o endereço de cada ensaio");
        return {
          starts_at: fromDatetimeLocalValue(reh.start),
          ends_at: fromDatetimeLocalValue(reh.end),
          formatted_address: reh.place.formatted_address,
          lat: reh.place.lat,
          lng: reh.place.lng,
          place_id: reh.place.place_id,
          save_address: reh.saveAddress,
          save_address_label: reh.saveLabel.trim() || null,
        };
      });

      return createBandSchedule(bandId, {
        title: title.trim(),
        members: buildMembersPayload(),
        event: eventBlock,
        rehearsals: rehearsalsPayload,
        songs: buildSongsPayload(),
        save_event_address: saveEventAddress && !saved,
        save_event_address_label: saveEventLabel.trim() || null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["band-schedules", bandId] });
      await queryClient.invalidateQueries({ queryKey: ["band-addresses", bandId] });
      await queryClient.invalidateQueries({ queryKey: ["schedule-upcoming"] });
      navigate(`/bandas/${bandId}?tab=agenda`);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Erro"),
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      assertMembersReady();
      if (!occurrenceId) throw new Error("Ocorrência inválida");
      const saved = addressesQuery.data?.find((a) => a.id === editSavedId);
      const body: Record<string, unknown> = {
        starts_at: fromDatetimeLocalValue(editStart),
        ends_at: fromDatetimeLocalValue(editEnd),
        members: buildMembersPayload(),
        songs: buildSongsPayload(),
      };
      if (editKind === "event") {
        body.title = title.trim();
        if (!title.trim()) throw new Error("Informe o título");
      }
      if (saved) {
        body.saved_address_id = saved.id;
      } else if (editPlace) {
        body.formatted_address = editPlace.formatted_address;
        body.lat = editPlace.lat;
        body.lng = editPlace.lng;
        body.place_id = editPlace.place_id;
      } else {
        throw new Error("Informe o endereço");
      }
      return updateScheduleOccurrence(bandId, occurrenceId, body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["band-schedules", bandId] });
      await queryClient.invalidateQueries({ queryKey: ["band-schedule", bandId, scheduleId] });
      await queryClient.invalidateQueries({ queryKey: ["schedule-upcoming"] });
      navigate(`/bandas/${bandId}?tab=agenda`);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Erro"),
  });

  const backTo = `/bandas/${bandId}?tab=agenda`;
  const busy = createMutation.isPending || editMutation.isPending;

  if (mode === "edit" && scheduleQuery.isLoading) {
    return <p className="text-slate-400">Carregando escala...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link to={backTo} className={`${linkClass} text-sm`}>
            ← Voltar para agenda
          </Link>
          <h2 className="mt-1 text-lg font-semibold">
            {mode === "create" ? "Nova escala" : "Editar escala"}
          </h2>
        </div>
      </div>

      {mode === "create" ? (
        <>
          <div className={`${panelClass} space-y-4 p-4`}>
            <h3 className="font-medium">Evento</h3>
            <label htmlFor="schedule-title" className={labelClass}>
              <span>Título</span>
              <input
                id="schedule-title"
                name="schedule-title"
                required
                className={inputClass}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Culto de Domingo"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label htmlFor="event-start" className={labelClass}>
                <span>Início do evento</span>
                <input
                  id="event-start"
                  name="event-start"
                  type="datetime-local"
                  required
                  className={inputClass}
                  value={eventStart}
                  onChange={(e) => setEventStart(e.target.value)}
                />
              </label>
              <label htmlFor="event-end" className={labelClass}>
                <span>Fim do evento</span>
                <input
                  id="event-end"
                  name="event-end"
                  type="datetime-local"
                  required
                  className={inputClass}
                  value={eventEnd}
                  onChange={(e) => setEventEnd(e.target.value)}
                />
              </label>
            </div>
            <AddressFields
              addresses={addressesQuery.data ?? []}
              savedId={savedEventId}
              onSavedId={(id) => {
                setSavedEventId(id);
                if (id) setEventPlace(null);
              }}
              place={eventPlace}
              onPlace={setEventPlace}
              saveAddress={saveEventAddress}
              onSaveAddress={setSaveEventAddress}
              saveLabel={saveEventLabel}
              onSaveLabel={setSaveEventLabel}
              label="Endereço do evento"
            />
          </div>

          <div className={`${panelClass} space-y-4 p-4`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">Ensaios</h3>
              <button
                type="button"
                className={`${btnGhost} px-3 py-1.5 text-sm`}
                onClick={() => setRehearsals((prev) => [...prev, newRehearsal()])}
              >
                + Novo Ensaio
              </button>
            </div>
            {rehearsals.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum ensaio. Use “+ Novo Ensaio” se precisar.</p>
            ) : null}
            {rehearsals.map((reh, index) => (
              <div
                key={reh.key}
                className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-200">Ensaio {index + 1}</p>
                  <button
                    type="button"
                    className="text-xs text-red-300 hover:text-red-200"
                    onClick={() =>
                      setRehearsals((prev) => prev.filter((item) => item.key !== reh.key))
                    }
                  >
                    Remover
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                  Título no grid: Ensaio {title.trim() || "…"}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label htmlFor={`rehearsal-start-${reh.key}`} className={labelClass}>
                    <span>Início do ensaio</span>
                    <input
                      id={`rehearsal-start-${reh.key}`}
                      name={`rehearsal-start-${reh.key}`}
                      type="datetime-local"
                      required
                      className={inputClass}
                      value={reh.start}
                      onChange={(e) =>
                        setRehearsals((prev) =>
                          prev.map((item) =>
                            item.key === reh.key ? { ...item, start: e.target.value } : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <label htmlFor={`rehearsal-end-${reh.key}`} className={labelClass}>
                    <span>Fim do ensaio</span>
                    <input
                      id={`rehearsal-end-${reh.key}`}
                      name={`rehearsal-end-${reh.key}`}
                      type="datetime-local"
                      required
                      className={inputClass}
                      value={reh.end}
                      onChange={(e) =>
                        setRehearsals((prev) =>
                          prev.map((item) =>
                            item.key === reh.key ? { ...item, end: e.target.value } : item,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
                <label
                  htmlFor={`rehearsal-same-address-${reh.key}`}
                  className="flex items-center gap-2 text-sm text-slate-300"
                >
                  <input
                    id={`rehearsal-same-address-${reh.key}`}
                    name={`rehearsal-same-address-${reh.key}`}
                    type="checkbox"
                    checked={reh.sameAsEvent}
                    onChange={(e) =>
                      setRehearsals((prev) =>
                        prev.map((item) =>
                          item.key === reh.key
                            ? { ...item, sameAsEvent: e.target.checked }
                            : item,
                        ),
                      )
                    }
                  />
                  Ensaio no mesmo endereço do evento
                </label>
                {!reh.sameAsEvent ? (
                  <AddressFields
                    addresses={addressesQuery.data ?? []}
                    savedId={reh.savedId}
                    onSavedId={(id) =>
                      setRehearsals((prev) =>
                        prev.map((item) =>
                          item.key === reh.key
                            ? { ...item, savedId: id, place: id ? null : item.place }
                            : item,
                        ),
                      )
                    }
                    place={reh.place}
                    onPlace={(place) =>
                      setRehearsals((prev) =>
                        prev.map((item) => (item.key === reh.key ? { ...item, place } : item)),
                      )
                    }
                    saveAddress={reh.saveAddress}
                    onSaveAddress={(value) =>
                      setRehearsals((prev) =>
                        prev.map((item) =>
                          item.key === reh.key ? { ...item, saveAddress: value } : item,
                        ),
                      )
                    }
                    saveLabel={reh.saveLabel}
                    onSaveLabel={(value) =>
                      setRehearsals((prev) =>
                        prev.map((item) =>
                          item.key === reh.key ? { ...item, saveLabel: value } : item,
                        ),
                      )
                    }
                    label="Endereço do ensaio"
                  />
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className={`${panelClass} space-y-4 p-4`}>
          <h3 className="font-medium">{editKind === "event" ? "Evento" : "Ensaio"}</h3>
          {editKind === "event" ? (
            <label htmlFor="edit-schedule-title" className={labelClass}>
              <span>Título</span>
              <input
                id="edit-schedule-title"
                name="edit-schedule-title"
                required
                className={inputClass}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
          ) : (
            <p className="text-sm text-slate-400">Título: {title ? `Ensaio ${title}` : "—"}</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label htmlFor="edit-start" className={labelClass}>
              <span>Início</span>
              <input
                id="edit-start"
                name="edit-start"
                type="datetime-local"
                required
                className={inputClass}
                value={editStart}
                onChange={(e) => setEditStart(e.target.value)}
              />
            </label>
            <label htmlFor="edit-end" className={labelClass}>
              <span>Fim</span>
              <input
                id="edit-end"
                name="edit-end"
                type="datetime-local"
                required
                className={inputClass}
                value={editEnd}
                onChange={(e) => setEditEnd(e.target.value)}
              />
            </label>
          </div>
          <AddressFields
            addresses={addressesQuery.data ?? []}
            savedId={editSavedId}
            onSavedId={(id) => {
              setEditSavedId(id);
              if (id) setEditPlace(null);
            }}
            place={editPlace}
            onPlace={setEditPlace}
            saveAddress={false}
            onSaveAddress={() => undefined}
            saveLabel=""
            onSaveLabel={() => undefined}
            label="Endereço"
            hideSave
          />
        </div>
      )}

      <div className={`${panelClass} space-y-3 p-4`}>
        <h3 className="font-medium">Integrantes</h3>
        <p className="text-xs text-slate-500">
          Marque quem toca e escolha a função desta escala (ex.: só Violão).
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(membersQuery.data ?? []).map((member) => {
            const checked = selectedMembers.has(member.id);
            const roleIds = member.roles.map((role) => role.id);
            const picked = selectedRoles.get(member.id) ?? new Set<string>();
            const multiRole = member.roles.length > 1;
            return (
              <div
                key={member.id}
                className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-sm text-slate-300"
              >
                <label htmlFor={`schedule-member-${member.id}`} className="flex items-start gap-2">
                  <input
                    id={`schedule-member-${member.id}`}
                    name={`schedule-member-${member.id}`}
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    onChange={() => toggleMember(member.id, roleIds)}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-slate-200">{member.full_name}</span>
                    {!multiRole ? (
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {member.roles[0]?.name ?? "Sem função definida"}
                      </span>
                    ) : null}
                  </span>
                </label>
                {checked && multiRole ? (
                  <div className="mt-2 ml-6 space-y-1.5 border-l border-white/10 pl-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">
                      Função nesta escala
                    </p>
                    {member.roles.map((role) => (
                      <label
                        key={role.id}
                        htmlFor={`schedule-member-role-${member.id}-${role.id}`}
                        className="flex items-center gap-2 text-xs text-slate-300"
                      >
                        <input
                          id={`schedule-member-role-${member.id}-${role.id}`}
                          name={`schedule-member-role-${member.id}-${role.id}`}
                          type="checkbox"
                          checked={picked.has(role.id)}
                          onChange={() => toggleMemberRole(member.id, role.id)}
                        />
                        <span>{role.name}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className={`${panelClass} space-y-3 p-4`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-medium">Músicas</h3>
            <p className="text-xs text-slate-500">
              Repertório desta escala — escolha músicas da banda e o tom de cada uma.
            </p>
          </div>
          <button
            type="button"
            className={`${btnGhost} shrink-0 rounded-full px-3 py-1.5 text-sm`}
            onClick={() => setSongs((prev) => [...prev, newSongDraft()])}
          >
            + Adicionar música
          </button>
        </div>

        {songs.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma música adicionada ainda.</p>
        ) : null}

        <div className="space-y-3">
          {songs.map((entry, index) => {
            const selectedIds = new Set(songs.map((item) => item.songId).filter(Boolean));
            return (
              <div
                key={entry.key}
                className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-200">Música {index + 1}</p>
                  <button
                    type="button"
                    className="text-sm text-red-400 hover:text-red-300"
                    onClick={() =>
                      setSongs((prev) => prev.filter((item) => item.key !== entry.key))
                    }
                  >
                    Remover
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                  <label htmlFor={`schedule-song-${entry.key}`} className={labelClass}>
                    <span>Música</span>
                    <select
                      id={`schedule-song-${entry.key}`}
                      name={`schedule-song-${entry.key}`}
                      className={inputClass}
                      value={entry.songId}
                      onChange={(e) =>
                        setSongs((prev) =>
                          prev.map((item) =>
                            item.key === entry.key ? { ...item, songId: e.target.value } : item,
                          ),
                        )
                      }
                    >
                      <option value="">Selecione...</option>
                      {(songsQuery.data?.items ?? []).map((song) => {
                        const taken = selectedIds.has(song.id) && song.id !== entry.songId;
                        return (
                          <option key={song.id} value={song.id} disabled={taken}>
                            {song.title || "Sem título"}
                            {song.artist ? ` — ${song.artist}` : ""}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label htmlFor={`schedule-song-key-${entry.key}`} className={labelClass}>
                    <span>Tom</span>
                    <select
                      id={`schedule-song-key-${entry.key}`}
                      name={`schedule-song-key-${entry.key}`}
                      className={inputClass}
                      value={entry.musicalKey}
                      onChange={(e) =>
                        setSongs((prev) =>
                          prev.map((item) =>
                            item.key === entry.key
                              ? { ...item, musicalKey: e.target.value }
                              : item,
                          ),
                        )
                      }
                    >
                      <option value="">—</option>
                      {KEY_OPTIONS.map((key) => (
                        <option key={key} value={key}>
                          {key}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        {songsQuery.isLoading ? (
          <p className="text-xs text-slate-500">Carregando músicas da banda...</p>
        ) : null}
        {!songsQuery.isLoading && (songsQuery.data?.items.length ?? 0) === 0 ? (
          <p className="text-xs text-amber-400/90">
            Esta banda ainda não tem músicas vinculadas. Adicione em Biblioteca antes.
          </p>
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || selectedMembers.size === 0}
          className={`${btnPrimary} disabled:opacity-60`}
          onClick={() => {
            setError(null);
            if (mode === "create") createMutation.mutate();
            else editMutation.mutate();
          }}
        >
          {busy
            ? "Salvando..."
            : mode === "create"
              ? "Criar Escala"
              : "Salvar alterações"}
        </button>
        <Link to={backTo} className={`${btnGhost} px-4 py-2 text-sm`}>
          Cancelar
        </Link>
      </div>
    </div>
  );
}

function AddressFields({
  addresses,
  savedId,
  onSavedId,
  place,
  onPlace,
  saveAddress,
  onSaveAddress,
  saveLabel,
  onSaveLabel,
  label,
  hideSave = false,
}: {
  addresses: Array<{ id: string; label: string; formatted_address: string }>;
  savedId: string;
  onSavedId: (id: string) => void;
  place: Place | null;
  onPlace: (place: Place | null) => void;
  saveAddress: boolean;
  onSaveAddress: (value: boolean) => void;
  saveLabel: string;
  onSaveLabel: (value: string) => void;
  label: string;
  hideSave?: boolean;
}) {
  const fieldId = useId();
  const savedAddressId = `${fieldId}-saved-address`;
  const saveAddressId = `${fieldId}-save-address`;
  const saveLabelId = `${fieldId}-save-label`;

  return (
    <div className="space-y-3">
      <label htmlFor={savedAddressId} className={labelClass}>
        <span>Endereço salvo</span>
        <select
          id={savedAddressId}
          name={savedAddressId}
          className={inputClass}
          value={savedId}
          onChange={(e) => onSavedId(e.target.value)}
        >
          <option value="">Usar busca de endereço</option>
          {addresses.map((addr) => (
            <option key={addr.id} value={addr.id}>
              {addr.label} — {addr.formatted_address}
            </option>
          ))}
        </select>
      </label>
      {!savedId ? (
        <PlacesAddressInput label={label} value={place} onChange={onPlace} />
      ) : null}
      {!hideSave && !savedId ? (
        <div className="space-y-2">
          <label htmlFor={saveAddressId} className="flex items-center gap-2 text-sm text-slate-300">
            <input
              id={saveAddressId}
              name={saveAddressId}
              type="checkbox"
              checked={saveAddress}
              onChange={(e) => onSaveAddress(e.target.checked)}
            />
            Salvar endereço para reutilizar
          </label>
          {saveAddress ? (
            <label htmlFor={saveLabelId} className={labelClass}>
              <span className="sr-only">Nome do local</span>
              <input
                id={saveLabelId}
                name={saveLabelId}
                className={inputClass}
                placeholder="Nome do local (ex.: Igreja Central)"
                value={saveLabel}
                onChange={(e) => onSaveLabel(e.target.value)}
                required={saveAddress}
              />
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
