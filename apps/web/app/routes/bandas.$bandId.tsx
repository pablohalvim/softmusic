import { PLANS, formatBrl } from "@softmusic/shared";
import { formatDateTime } from "@softmusic/shared/datetime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import {
  cancelScheduleOccurrence,
  changeBandPlan,
  createBandRole,
  deleteBandRole,
  fetchBandMembers,
  fetchBandRoles,
  fetchBandSchedules,
  formatScheduleMemberLabel,
  removeBandMember,
  updateBandMember,
  updateBandRole,
  type BandMemberDetail,
  type ScheduleGridRow,
  type ScheduleMember,
} from "../lib/api";
import { useBand } from "../lib/band-context";
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
  const { bands, loading, refreshBands, patchBand } = useBand();
  const band = bands.find((item) => item.id === bandId) ?? null;

  const tabParam = searchParams.get("tab") as TabId | null;
  const tab: TabId =
    tabParam && ["funcoes", "membros", "agenda", "plano"].includes(tabParam)
      ? tabParam
      : "funcoes";

  const membersQuery = useQuery({
    queryKey: ["band-members", bandId],
    queryFn: () => fetchBandMembers(bandId),
    enabled: Boolean(bandId),
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!bandId || !membersQuery.data) return;
    const count = membersQuery.data.length;
    if (band && band.member_count !== count) {
      patchBand(bandId, { member_count: count });
    }
  }, [band, bandId, membersQuery.data, patchBand]);

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

  if (loading && !band) {
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

  const memberCount = membersQuery.data?.length ?? band.member_count;

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
            {band.plan_code} · {memberCount}/{band.member_limit} membros
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
          onChanged={() => void refreshBands({ silent: true })}
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
          <label htmlFor="role-name" className={`${labelClass} flex-1`}>
            <span>Nova função</span>
            <input
              id="role-name"
              name="role-name"
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
                id={`role-name-edit-${role.id}`}
                name={`role-name-edit-${role.id}`}
                aria-label="Editar nome da função"
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
  const { refreshBands, patchBand } = useBand();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BandMemberDetail | null>(null);

  const membersQuery = useQuery({
    queryKey: ["band-members", bandId],
    queryFn: () => fetchBandMembers(bandId),
    refetchOnWindowFocus: true,
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
      const nextCount = Math.max(0, (membersQuery.data?.length ?? 1) - 1);
      patchBand(bandId, { member_count: nextCount });
      await refreshBands({ silent: true });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Erro"),
  });

  const members = membersQuery.data ?? [];

  const roleLabel = (member: BandMemberDetail) =>
    member.roles.length > 0 ? member.roles.map((r) => r.name).join(", ") : "—";

  const joinedLabel = (member: BandMemberDetail) =>
    member.joined_at ? new Date(member.joined_at).toLocaleDateString("pt-BR") : "—";

  const memberActions = (member: BandMemberDetail, stacked = false) =>
    canManage ? (
      <div className={stacked ? "flex flex-col gap-2" : "flex flex-wrap gap-2"}>
        <button
          type="button"
          className={`${btnGhost} ${stacked ? "w-full justify-center" : ""}`}
          onClick={() => setEditing(member)}
        >
          Gerenciar
        </button>
        {!member.is_owner ? (
          <button
            type="button"
            className={`${btnGhost} ${stacked ? "w-full justify-center" : ""}`}
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
    );

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {membersQuery.isLoading ? (
        <p className="text-sm text-slate-400">Carregando integrantes...</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum integrante encontrado.</p>
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {members.map((member) => (
              <article key={member.id} className={`${panelClass} space-y-3 p-4`}>
                <div className="min-w-0">
                  <p className="break-words font-medium text-slate-100">{member.full_name}</p>
                  <p className="break-all text-xs text-slate-500">
                    {member.email}
                    {member.is_owner ? " · responsável" : ""}
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div className="min-w-0">
                    <dt className="text-xs text-slate-500">Funções</dt>
                    <dd className="break-words text-slate-300">{roleLabel(member)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Ingresso</dt>
                    <dd className="text-slate-300">{joinedLabel(member)}</dd>
                  </div>
                </dl>
                {memberActions(member, true)}
              </article>
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-xl border border-white/10 md:block">
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
                {members.map((member) => (
                  <tr key={member.id} className="border-t border-white/5">
                    <td className="px-3 py-3">
                      <p className="font-medium text-slate-100">{member.full_name}</p>
                      <p className="text-xs text-slate-500">
                        {member.email}
                        {member.is_owner ? " · responsável" : ""}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-slate-300">{roleLabel(member)}</td>
                    <td className="px-3 py-3 text-slate-400">{joinedLabel(member)}</td>
                    <td className="px-3 py-3">{memberActions(member)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

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
                <label
                  key={role.id}
                  htmlFor={`member-role-${role.id}`}
                  className="flex items-center gap-2 text-sm text-slate-300"
                >
                  <input
                    id={`member-role-${role.id}`}
                    name={`member-role-${role.id}`}
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
            <label htmlFor="member-can-analyze" className="flex items-center gap-2 text-sm text-slate-300">
              <input
                id="member-can-analyze"
                name="member-can-analyze"
                type="checkbox"
                checked={canAnalyze}
                onChange={(e) => setCanAnalyze(e.target.checked)}
              />
              Pode enviar/analisar músicas
            </label>
            <label htmlFor="member-can-invite" className="flex items-center gap-2 text-sm text-slate-300">
              <input
                id="member-can-invite"
                name="member-can-invite"
                type="checkbox"
                checked={canInvite}
                onChange={(e) => setCanInvite(e.target.checked)}
              />
              Pode convidar membros
            </label>
            <label htmlFor="member-can-manage" className="flex items-center gap-2 text-sm text-slate-300">
              <input
                id="member-can-manage"
                name="member-can-manage"
                type="checkbox"
                checked={canManage}
                onChange={(e) => setCanManage(e.target.checked)}
              />
              Pode gerenciar funções, membros e agenda
            </label>
            <label htmlFor="member-can-delete" className="flex items-center gap-2 text-sm text-slate-300">
              <input
                id="member-can-delete"
                name="member-can-delete"
                type="checkbox"
                checked={canDelete}
                onChange={(e) => setCanDelete(e.target.checked)}
              />
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
  const [rosterRow, setRosterRow] = useState<ScheduleGridRow | null>(null);
  const [cancelRow, setCancelRow] = useState<ScheduleGridRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const schedulesQuery = useQuery({
    queryKey: ["band-schedules", bandId],
    queryFn: () => fetchBandSchedules(bandId),
  });

  const cancelMutation = useMutation({
    mutationFn: (occurrenceId: string) => cancelScheduleOccurrence(bandId, occurrenceId),
    onSuccess: async () => {
      setCancelRow(null);
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ["band-schedules", bandId] });
      await queryClient.invalidateQueries({ queryKey: ["schedule-upcoming"] });
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : "Erro ao cancelar"),
  });

  const rows = schedulesQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Agenda</h2>
          <p className="text-sm text-slate-500">Eventos e ensaios da banda</p>
        </div>
        {canManage ? (
          <Link to={`/bandas/${bandId}/agenda/nova`} className={`${btnPrimary} px-4 py-2 text-sm`}>
            Nova escala
          </Link>
        ) : null}
      </div>

      {actionError ? <p className="text-sm text-red-400">{actionError}</p> : null}
      {schedulesQuery.isLoading ? <p className="text-sm text-slate-400">Carregando...</p> : null}
      {!schedulesQuery.isLoading && rows.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhuma escala cadastrada.</p>
      ) : null}

      {rows.length > 0 ? (
        <div className={`${panelClass} overflow-x-auto`}>
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3 font-medium">Título</th>
                <th className="px-3 py-3 font-medium">Data</th>
                <th className="px-3 py-3 font-medium">Tipo</th>
                <th className="px-3 py-3 font-medium">Integrantes</th>
                <th className="px-3 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.occurrence_id} className="border-b border-white/5 last:border-0">
                  <td className="px-3 py-3 text-slate-200">{row.title || "—"}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-slate-300">
                    {formatDateTime(row.starts_at)}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        row.kind === "event"
                          ? "bg-green-500/15 text-green-300"
                          : "bg-amber-500/15 text-amber-300"
                      }`}
                    >
                      {row.kind === "event" ? "Evento" : "Ensaio"}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      className={linkClass}
                      onClick={() => setRosterRow(row)}
                    >
                      {row.member_count}
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Link
                        to={`/agenda/${bandId}/${row.schedule_id}`}
                        className={`${btnGhost} px-2.5 py-1 text-xs`}
                      >
                        Ver
                      </Link>
                      {canManage ? (
                        <>
                          <Link
                            to={`/bandas/${bandId}/agenda/${row.schedule_id}/editar?occurrenceId=${row.occurrence_id}`}
                            className={`${btnGhost} px-2.5 py-1 text-xs`}
                          >
                            Editar
                          </Link>
                          <button
                            type="button"
                            className="rounded-lg border border-red-500/30 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/10"
                            onClick={() => setCancelRow(row)}
                          >
                            Cancelar
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {rosterRow ? (
        <MembersModal members={rosterRow.members} onClose={() => setRosterRow(null)} />
      ) : null}

      {cancelRow ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center">
          <div className={`${panelClass} w-full max-w-md space-y-4 p-5`}>
            <h3 className="text-lg font-semibold">Cancelar escala</h3>
            <p className="text-sm text-slate-300">
              Cancelar <strong>{cancelRow.title}</strong> (
              {cancelRow.kind === "event" ? "Evento" : "Ensaio"})? Os integrantes receberão e-mail
              com cancelamento no Google Agenda.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className={btnGhost} onClick={() => setCancelRow(null)}>
                Voltar
              </button>
              <button
                type="button"
                className="rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate(cancelRow.occurrence_id)}
              >
                {cancelMutation.isPending ? "Cancelando..." : "Confirmar cancelamento"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MembersModal({
  members,
  onClose,
}: {
  members: ScheduleMember[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center">
      <div className={`${panelClass} w-full max-w-md space-y-4 p-5`}>
        <h3 className="text-lg font-semibold">Integrantes escalados</h3>
        {members.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhum integrante.</p>
        ) : (
          <ul className="space-y-2 text-sm text-slate-300">
            {members.map((member) => (
              <li key={member.member_id}>{formatScheduleMemberLabel(member)}</li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <button type="button" className={btnGhost} onClick={onClose}>
            Fechar
          </button>
        </div>
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
