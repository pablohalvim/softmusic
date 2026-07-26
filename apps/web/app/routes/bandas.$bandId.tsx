import { PLANS, formatBrl } from "@softmusic/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { PlacesAddressInput } from "../components/PlacesAddressInput";
import {
  changeBandPlan,
  createBandRole,
  createBandSchedule,
  deleteBandRole,
  fetchBandAddresses,
  fetchBandMembers,
  fetchBandRoles,
  fetchBandSchedules,
  removeBandMember,
  updateBandMember,
  updateBandRole,
  type BandMemberDetail,
} from "../lib/api";
import { useBand } from "../lib/band-context";
import type { PlaceSelection } from "../lib/google-places";
import {
  btnGhost,
  btnPrimary,
  inputClass,
  labelClass,
  linkClass,
  panelClass,
} from "../lib/ui-classes";

type TabId = "funcoes" | "membros" | "agenda" | "plano";

export default function BandManagePage() {
  const { bandId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { bands, loading, refreshBands } = useBand();
  const band = bands.find((item) => item.id === bandId) ?? null;

  const tabParam = searchParams.get("tab") as TabId | null;
  const tab: TabId =
    tabParam && ["funcoes", "membros", "agenda", "plano"].includes(tabParam)
      ? tabParam
      : "funcoes";

  const tabs = useMemo(() => {
    const base: Array<{ id: TabId; label: string }> = [
      { id: "funcoes", label: "Funções" },
      { id: "membros", label: "Gestão de Usuários" },
      { id: "agenda", label: "Agenda" },
    ];
    if (band && !band.billing_exempt) {
      base.push({ id: "plano", label: "Alterar Plano" });
    }
    return base;
  }, [band]);

  if (loading) {
    return <p className="text-slate-400">Carregando...</p>;
  }

  if (!band) {
    return (
      <section className="space-y-4">
        <h1 className="sm-page-title">Banda não encontrada</h1>
        <Link to="/bandas" className={linkClass}>
          Voltar para bandas
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">
            <Link to="/bandas" className={linkClass}>
              Bandas
            </Link>{" "}
            / Gerenciar
          </p>
          <h1 className="sm-page-title">{band.name}</h1>
          <p className="sm-page-subtitle">
            {band.plan_code} · {band.member_count}/{band.member_limit} membros
          </p>
        </div>
      </div>

      <nav
        className="flex gap-1 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-1"
        aria-label="Seções da banda"
      >
        {tabs.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSearchParams({ tab: item.id })}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${
                active
                  ? "bg-green-500/20 font-medium text-green-200"
                  : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {tab === "funcoes" ? <RolesTab bandId={band.id} canManage={Boolean(band.can_manage_members || band.is_owner)} /> : null}
      {tab === "membros" ? (
        <MembersTab bandId={band.id} canManage={Boolean(band.can_manage_members || band.is_owner)} />
      ) : null}
      {tab === "agenda" ? (
        <AgendaTab bandId={band.id} canManage={Boolean(band.can_manage_members || band.is_owner)} />
      ) : null}
      {tab === "plano" && !band.billing_exempt ? (
        <PlanTab
          bandId={band.id}
          currentPlan={band.plan_code}
          isOwner={band.is_owner}
          onChanged={() => void refreshBands()}
        />
      ) : null}
    </section>
  );
}

function RolesTab({ bandId, canManage }: { bandId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const rolesQuery = useQuery({
    queryKey: ["band-roles", bandId],
    queryFn: () => fetchBandRoles(bandId),
  });

  const createMutation = useMutation({
    mutationFn: () => createBandRole(bandId, name),
    onSuccess: async () => {
      setName("");
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["band-roles", bandId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Erro"),
  });

  const updateMutation = useMutation({
    mutationFn: () => updateBandRole(bandId, editingId!, editName),
    onSuccess: async () => {
      setEditingId(null);
      await queryClient.invalidateQueries({ queryKey: ["band-roles", bandId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Erro"),
  });

  const deleteMutation = useMutation({
    mutationFn: (roleId: string) => deleteBandRole(bandId, roleId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["band-roles", bandId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Erro"),
  });

  return (
    <div className="space-y-4">
      {canManage ? (
        <form
          className={`${panelClass} flex flex-col gap-3 sm:flex-row sm:items-end`}
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
        >
          <label className={`${labelClass} flex-1`}>
            <span>Nova função</span>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Violão"
              required
            />
          </label>
          <button type="submit" className={`${btnPrimary} disabled:opacity-60`} disabled={createMutation.isPending}>
            Adicionar
          </button>
        </form>
      ) : (
        <p className="text-sm text-slate-400">Somente gestores podem editar funções.</p>
      )}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="space-y-2">
        {(rolesQuery.data ?? []).map((role) => (
          <div key={role.id} className={`${panelClass} flex flex-wrap items-center justify-between gap-3 p-3`}>
            {editingId === role.id ? (
              <input
                className={`${inputClass} max-w-xs`}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            ) : (
              <div>
                <p className="font-medium text-slate-100">{role.name}</p>
                {role.is_default ? <p className="text-xs text-slate-500">Padrão</p> : null}
              </div>
            )}
            {canManage ? (
              <div className="flex gap-2">
                {editingId === role.id ? (
                  <>
                    <button
                      type="button"
                      className={btnPrimary}
                      onClick={() => updateMutation.mutate()}
                      disabled={updateMutation.isPending}
                    >
                      Salvar
                    </button>
                    <button type="button" className={btnGhost} onClick={() => setEditingId(null)}>
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className={btnGhost}
                      onClick={() => {
                        setEditingId(role.id);
                        setEditName(role.name);
                      }}
                    >
                      Renomear
                    </button>
                    <button
                      type="button"
                      className={btnGhost}
                      onClick={() => {
                        if (confirm(`Excluir função "${role.name}"?`)) {
                          deleteMutation.mutate(role.id);
                        }
                      }}
                    >
                      Excluir
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function MembersTab({ bandId, canManage }: { bandId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BandMemberDetail | null>(null);

  const membersQuery = useQuery({
    queryKey: ["band-members", bandId],
    queryFn: () => fetchBandMembers(bandId),
  });
  const rolesQuery = useQuery({
    queryKey: ["band-roles", bandId],
    queryFn: () => fetchBandRoles(bandId),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: {
      memberId: string;
      role_ids: string[];
      can_analyze_songs: boolean;
      can_invite_members: boolean;
      can_manage_members: boolean;
      can_delete_songs: boolean;
    }) =>
      updateBandMember(bandId, payload.memberId, {
        role_ids: payload.role_ids,
        can_analyze_songs: payload.can_analyze_songs,
        can_invite_members: payload.can_invite_members,
        can_manage_members: payload.can_manage_members,
        can_delete_songs: payload.can_delete_songs,
      }),
    onSuccess: async () => {
      setEditing(null);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["band-members", bandId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Erro"),
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: string) => removeBandMember(bandId, memberId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["band-members", bandId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Erro"),
  });

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-white/[0.04] text-slate-400">
            <tr>
              <th className="px-3 py-2 font-medium">Integrante</th>
              <th className="px-3 py-2 font-medium">Funções</th>
              <th className="px-3 py-2 font-medium">Ingresso</th>
              <th className="px-3 py-2 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {(membersQuery.data ?? []).map((member) => (
              <tr key={member.id} className="border-t border-white/5">
                <td className="px-3 py-3">
                  <p className="font-medium text-slate-100">{member.full_name}</p>
                  <p className="text-xs text-slate-500">
                    {member.email}
                    {member.is_owner ? " · responsável" : ""}
                  </p>
                </td>
                <td className="px-3 py-3 text-slate-300">
                  {member.roles.length > 0
                    ? member.roles.map((r) => r.name).join(", ")
                    : "—"}
                </td>
                <td className="px-3 py-3 text-slate-400">
                  {member.joined_at
                    ? new Date(member.joined_at).toLocaleDateString("pt-BR")
                    : "—"}
                </td>
                <td className="px-3 py-3">
                  {canManage ? (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={btnGhost} onClick={() => setEditing(member)}>
                        Atribuir / Gestão
                      </button>
                      {!member.is_owner ? (
                        <button
                          type="button"
                          className={btnGhost}
                          onClick={() => {
                            if (confirm(`Remover ${member.full_name} da banda?`)) {
                              removeMutation.mutate(member.id);
                            }
                          }}
                        >
                          Remover
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing ? (
        <MemberEditModal
          member={editing}
          roles={rolesQuery.data ?? []}
          busy={saveMutation.isPending}
          onClose={() => setEditing(null)}
          onSave={(payload) => saveMutation.mutate({ memberId: editing.id, ...payload })}
        />
      ) : null}
    </div>
  );
}

function MemberEditModal({
  member,
  roles,
  busy,
  onClose,
  onSave,
}: {
  member: BandMemberDetail;
  roles: Array<{ id: string; name: string }>;
  busy: boolean;
  onClose: () => void;
  onSave: (payload: {
    role_ids: string[];
    can_analyze_songs: boolean;
    can_invite_members: boolean;
    can_manage_members: boolean;
    can_delete_songs: boolean;
  }) => void;
}) {
  const [roleIds, setRoleIds] = useState(() => new Set(member.roles.map((r) => r.id)));
  const [canAnalyze, setCanAnalyze] = useState(member.can_analyze_songs);
  const [canInvite, setCanInvite] = useState(member.can_invite_members);
  const [canManage, setCanManage] = useState(member.can_manage_members);
  const [canDelete, setCanDelete] = useState(Boolean(member.can_delete_songs));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center">
      <div className={`${panelClass} w-full max-w-lg space-y-4 p-5`}>
        <h2 className="text-lg font-semibold">{member.full_name}</h2>
        <fieldset className="space-y-2">
          <legend className="text-sm text-slate-300">Funções</legend>
          <div className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
            {roles.map((role) => {
              const checked = roleIds.has(role.id);
              return (
                <label key={role.id} className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      setRoleIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(role.id)) next.delete(role.id);
                        else next.add(role.id);
                        return next;
                      });
                    }}
                  />
                  {role.name}
                </label>
              );
            })}
          </div>
        </fieldset>

        {!member.is_owner ? (
          <fieldset className="space-y-2">
            <legend className="text-sm text-slate-300">Gestão da banda</legend>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={canAnalyze} onChange={(e) => setCanAnalyze(e.target.checked)} />
              Pode enviar/analisar músicas
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={canInvite} onChange={(e) => setCanInvite(e.target.checked)} />
              Pode convidar membros
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={canManage} onChange={(e) => setCanManage(e.target.checked)} />
              Pode gerenciar funções, membros e agenda
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={canDelete} onChange={(e) => setCanDelete(e.target.checked)} />
              Pode excluir músicas da biblioteca
            </label>
          </fieldset>
        ) : (
          <p className="text-sm text-slate-400">O responsável mantém todas as permissões de gestão.</p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className={`${btnPrimary} disabled:opacity-60`}
            disabled={busy}
            onClick={() =>
              onSave({
                role_ids: [...roleIds],
                can_analyze_songs: canAnalyze,
                can_invite_members: canInvite,
                can_manage_members: canManage,
                can_delete_songs: canDelete,
              })
            }
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

function AgendaTab({ bandId, canManage }: { bandId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [eventStart, setEventStart] = useState("");
  const [eventEnd, setEventEnd] = useState("");
  const [rehStart, setRehStart] = useState("");
  const [rehEnd, setRehEnd] = useState("");
  const [eventPlace, setEventPlace] = useState<PlaceSelection | null>(null);
  const [rehPlace, setRehPlace] = useState<PlaceSelection | null>(null);
  const [sameAddress, setSameAddress] = useState(true);
  const [savedEventId, setSavedEventId] = useState("");
  const [saveAddress, setSaveAddress] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());

  const schedulesQuery = useQuery({
    queryKey: ["band-schedules", bandId],
    queryFn: () => fetchBandSchedules(bandId),
  });
  const membersQuery = useQuery({
    queryKey: ["band-members", bandId],
    queryFn: () => fetchBandMembers(bandId),
  });
  const addressesQuery = useQuery({
    queryKey: ["band-addresses", bandId],
    queryFn: () => fetchBandAddresses(bandId),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const saved = addressesQuery.data?.find((a) => a.id === savedEventId);
      const eventBlock = saved
        ? {
            starts_at: new Date(eventStart).toISOString(),
            ends_at: new Date(eventEnd).toISOString(),
            saved_address_id: saved.id,
          }
        : {
            starts_at: new Date(eventStart).toISOString(),
            ends_at: new Date(eventEnd).toISOString(),
            formatted_address: eventPlace!.formatted_address,
            lat: eventPlace!.lat,
            lng: eventPlace!.lng,
            place_id: eventPlace!.place_id,
          };

      const rehearsalBlock = sameAddress
        ? {
            starts_at: new Date(rehStart).toISOString(),
            ends_at: new Date(rehEnd).toISOString(),
          }
        : rehPlace
          ? {
              starts_at: new Date(rehStart).toISOString(),
              ends_at: new Date(rehEnd).toISOString(),
              formatted_address: rehPlace.formatted_address,
              lat: rehPlace.lat,
              lng: rehPlace.lng,
              place_id: rehPlace.place_id,
            }
          : null;

      if (!rehearsalBlock) {
        throw new Error("Informe o endereço do ensaio");
      }
      if (!saved && !eventPlace) {
        throw new Error("Informe o endereço do evento");
      }

      return createBandSchedule(bandId, {
        title: title.trim() || null,
        member_ids: [...selectedMembers],
        event: eventBlock,
        rehearsal: rehearsalBlock,
        rehearsal_same_as_event_address: sameAddress,
        save_event_address: saveAddress && !saved,
        save_event_address_label: saveLabel.trim() || null,
      });
    },
    onSuccess: async () => {
      setError(null);
      setTitle("");
      setSelectedMembers(new Set());
      await queryClient.invalidateQueries({ queryKey: ["band-schedules", bandId] });
      await queryClient.invalidateQueries({ queryKey: ["band-addresses", bandId] });
      await queryClient.invalidateQueries({ queryKey: ["schedule-upcoming"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Erro"),
  });

  return (
    <div className="space-y-6">
      {canManage ? (
        <form
          className={`${panelClass} space-y-4 p-4`}
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
        >
          <h2 className="font-medium">Nova escala</h2>
          <label className={labelClass}>
            <span>Título (opcional)</span>
            <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
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
            <label className={labelClass}>
              <span>Início do ensaio</span>
              <input
                type="datetime-local"
                required
                className={inputClass}
                value={rehStart}
                onChange={(e) => setRehStart(e.target.value)}
              />
            </label>
            <label className={labelClass}>
              <span>Fim do ensaio</span>
              <input
                type="datetime-local"
                required
                className={inputClass}
                value={rehEnd}
                onChange={(e) => setRehEnd(e.target.value)}
              />
            </label>
          </div>

          <label className={labelClass}>
            <span>Endereço salvo (evento)</span>
            <select
              className={inputClass}
              value={savedEventId}
              onChange={(e) => {
                setSavedEventId(e.target.value);
                if (e.target.value) setEventPlace(null);
              }}
            >
              <option value="">Usar busca do Google</option>
              {(addressesQuery.data ?? []).map((addr) => (
                <option key={addr.id} value={addr.id}>
                  {addr.label} — {addr.formatted_address}
                </option>
              ))}
            </select>
          </label>

          {!savedEventId ? (
            <PlacesAddressInput label="Endereço do evento" value={eventPlace} onChange={setEventPlace} />
          ) : null}

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={sameAddress}
              onChange={(e) => setSameAddress(e.target.checked)}
            />
            Ensaio no mesmo endereço do evento
          </label>

          {!sameAddress ? (
            <PlacesAddressInput label="Endereço do ensaio" value={rehPlace} onChange={setRehPlace} />
          ) : null}

          {!savedEventId ? (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={saveAddress}
                  onChange={(e) => setSaveAddress(e.target.checked)}
                />
                Salvar endereço do evento para reutilizar
              </label>
              {saveAddress ? (
                <input
                  className={inputClass}
                  placeholder="Nome do local (ex.: Igreja Central)"
                  value={saveLabel}
                  onChange={(e) => setSaveLabel(e.target.value)}
                  required={saveAddress}
                />
              ) : null}
            </div>
          ) : null}

          <fieldset className="space-y-2">
            <legend className="text-sm text-slate-300">Integrantes</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(membersQuery.data ?? []).map((member) => {
                const checked = selectedMembers.has(member.id);
                return (
                  <label key={member.id} className="flex items-center gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
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
                    {member.full_name}
                  </label>
                );
              })}
            </div>
          </fieldset>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <button
            type="submit"
            className={`${btnPrimary} disabled:opacity-60`}
            disabled={createMutation.isPending || selectedMembers.size === 0}
          >
            {createMutation.isPending ? "Salvando..." : "Criar escala (evento + ensaio)"}
          </button>
        </form>
      ) : (
        <p className="text-sm text-slate-400">Somente gestores podem criar escalas.</p>
      )}

      <div className="space-y-3">
        <h2 className="font-medium">Escalas recentes</h2>
        {(schedulesQuery.data ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma escala cadastrada.</p>
        ) : null}
        {(schedulesQuery.data ?? []).map((schedule) => (
          <article key={schedule.id} className={`${panelClass} space-y-2 p-4`}>
            <p className="font-medium">{schedule.title || "Escala sem título"}</p>
            <p className="text-sm text-slate-400">
              Integrantes: {schedule.members.map((m) => m.full_name).join(", ") || "—"}
            </p>
            <ul className="space-y-2 text-sm text-slate-300">
              {schedule.occurrences.map((occ) => (
                <li key={occ.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                  <p className="font-medium capitalize">
                    {occ.kind === "event" ? "Evento" : "Ensaio"}
                  </p>
                  <p>
                    {new Date(occ.starts_at).toLocaleString("pt-BR")} —{" "}
                    {new Date(occ.ends_at).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                  <p className="text-slate-400">{occ.formatted_address}</p>
                  <a
                    href={occ.maps_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${linkClass} text-sm`}
                  >
                    Abrir localização
                  </a>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}

function PlanTab({
  bandId,
  currentPlan,
  isOwner,
  onChanged,
}: {
  bandId: string;
  currentPlan: string;
  isOwner: boolean;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (planCode: string) => changeBandPlan(bandId, planCode),
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Erro"),
  });

  if (!isOwner) {
    return <p className="text-sm text-slate-400">Apenas o responsável pode alterar o plano.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        A alteração atualiza o limite de membros no SoftMusic. A cobrança será integrada depois.
      </p>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        {Object.values(PLANS).map((plan) => {
          const active = currentPlan === plan.code;
          return (
            <button
              key={plan.code}
              type="button"
              disabled={active || mutation.isPending}
              onClick={() => {
                if (confirm(`Alterar para o plano ${plan.name}?`)) {
                  mutation.mutate(plan.code);
                }
              }}
              className={`${panelClass} p-4 text-left transition hover:border-green-500/30 disabled:opacity-70 ${
                active ? "border-green-500/45 bg-green-500/10" : ""
              }`}
            >
              <p className="font-medium">{plan.name}</p>
              <p className="mt-1 text-sm text-slate-400">
                {formatBrl(plan.basePriceCents)}/mês · até {plan.memberLimit} membros
              </p>
              {active ? <p className="mt-2 text-xs text-green-300">Plano atual</p> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
