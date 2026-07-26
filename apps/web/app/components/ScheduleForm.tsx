import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";

import { PlacesAddressInput } from "./PlacesAddressInput";
import {
  createBandSchedule,
  fetchBandAddresses,
  fetchBandMembers,
  fetchBandSchedule,
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
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());

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
  const scheduleQuery = useQuery({
    queryKey: ["band-schedule", bandId, scheduleId],
    queryFn: () => fetchBandSchedule(bandId, scheduleId!),
    enabled: mode === "edit" && Boolean(scheduleId),
  });

  useEffect(() => {
    if (mode !== "edit" || !scheduleQuery.data) return;
    const schedule = scheduleQuery.data;
    setTitle(schedule.title || "");
    setSelectedMembers(new Set(schedule.members.map((m) => m.member_id)));
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
  }, [mode, scheduleQuery.data, occurrenceId]);

  const createMutation = useMutation({
    mutationFn: async () => {
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
        member_ids: [...selectedMembers],
        event: eventBlock,
        rehearsals: rehearsalsPayload,
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
      if (!occurrenceId) throw new Error("Ocorrência inválida");
      const saved = addressesQuery.data?.find((a) => a.id === editSavedId);
      const body: Record<string, unknown> = {
        starts_at: fromDatetimeLocalValue(editStart),
        ends_at: fromDatetimeLocalValue(editEnd),
        member_ids: [...selectedMembers],
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
            <label className={labelClass}>
              <span>Título</span>
              <input
                required
                className={inputClass}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Culto de Domingo"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                <span>Início do evento</span>
                <input
                  type="datetime-local"
                  required
                  className={inputClass}
                  value={eventStart}
                  onChange={(e) => setEventStart(e.target.value)}
                />
              </label>
              <label className={labelClass}>
                <span>Fim do evento</span>
                <input
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
                  <label className={labelClass}>
                    <span>Início do ensaio</span>
                    <input
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
                  <label className={labelClass}>
                    <span>Fim do ensaio</span>
                    <input
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
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
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
            <label className={labelClass}>
              <span>Título</span>
              <input
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
            <label className={labelClass}>
              <span>Início</span>
              <input
                type="datetime-local"
                required
                className={inputClass}
                value={editStart}
                onChange={(e) => setEditStart(e.target.value)}
              />
            </label>
            <label className={labelClass}>
              <span>Fim</span>
              <input
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
        <div className="grid gap-2 sm:grid-cols-2">
          {(membersQuery.data ?? []).map((member) => {
            const checked = selectedMembers.has(member.id);
            const rolesLabel = member.roles.map((r) => r.name).join(", ");
            return (
              <label
                key={member.id}
                className="flex items-start gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-sm text-slate-300"
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={checked}
                  onChange={() => {
                    setSelectedMembers((prev) => {
                      const next = new Set(prev);
                      if (next.has(member.id)) next.delete(member.id);
                      else next.add(member.id);
                      return next;
                    });
                  }}
                />
                <span className="min-w-0">
                  <span className="block font-medium text-slate-200">{member.full_name}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {rolesLabel || "Sem função definida"}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
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
  return (
    <div className="space-y-3">
      <label className={labelClass}>
        <span>Endereço salvo</span>
        <select
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
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={saveAddress}
              onChange={(e) => onSaveAddress(e.target.checked)}
            />
            Salvar endereço para reutilizar
          </label>
          {saveAddress ? (
            <input
              className={inputClass}
              placeholder="Nome do local (ex.: Igreja Central)"
              value={saveLabel}
              onChange={(e) => onSaveLabel(e.target.value)}
              required={saveAddress}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
