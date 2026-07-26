import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { PLANS, formatBrl } from "@softmusic/shared";
import type { BandSummary } from "@softmusic/types";

import { PendingInvitesCard } from "../components/PendingInvitesCard";
import { inviteBandMember } from "../lib/api";
import { useBand } from "../lib/band-context";
import { useToast } from "../lib/toast";
import {
  btnGhost,
  btnPrimary,
  inputClass,
  labelClass,
  panelClass,
  panelHoverClass,
} from "../lib/ui-classes";

const PLANS_LIST = Object.values(PLANS).map((plan) => ({
  code: plan.code,
  label: `${plan.name} — ${formatBrl(plan.basePriceCents)}/mês`,
}));

export default function BandasPage() {
  const { bands, activeBand, setActiveBandId, createBand, loading } = useBand();
  const navigate = useNavigate();
  const toast = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [planCode, setPlanCode] = useState("individual");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [inviteBandId, setInviteBandId] = useState<string | null>(null);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createBand(name.trim(), planCode);
      toast.success("Banda criada. Confira a fatura gerada.");
      setName("");
      setModalOpen(false);
      navigate("/faturas");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar banda");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="sm-page-title">Minhas bandas</h1>
          <p className="sm-page-subtitle">Escolha a banda ativa, convide membros ou crie uma nova.</p>
        </div>
        <button type="button" className={btnPrimary} onClick={() => setModalOpen(true)}>
          + Nova banda
        </button>
      </div>

      <PendingInvitesCard />

      {loading ? <p className="text-slate-400">Carregando...</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {bands.map((band) => (
          <BandCard
            key={band.id}
            band={band}
            active={activeBand?.id === band.id}
            inviting={inviteBandId === band.id}
            onSelect={() => setActiveBandId(band.id)}
            onToggleInvite={() =>
              setInviteBandId((current) => (current === band.id ? null : band.id))
            }
          />
        ))}
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center">
          <form
            onSubmit={(e) => void handleCreate(e)}
            className={`${panelClass} w-full max-w-md space-y-4 border-green-500/20 p-5`}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold">Nova banda</h2>
              <button
                type="button"
                className={btnGhost}
                onClick={() => {
                  setModalOpen(false);
                  setError(null);
                }}
              >
                Fechar
              </button>
            </div>
            <label className={labelClass}>
              <span>Nome</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                placeholder="Ex.: Ministério de Louvor"
              />
            </label>
            <fieldset className="space-y-2">
              <legend className="text-sm text-slate-300">Plano</legend>
              <div className="grid gap-2" role="radiogroup" aria-label="Plano">
                {PLANS_LIST.map((plan) => {
                  const active = planCode === plan.code;
                  return (
                    <button
                      key={plan.code}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setPlanCode(plan.code)}
                      className={`sm-plan-option ${active ? "sm-plan-option-active" : ""}`}
                    >
                      {plan.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
            <button type="submit" disabled={submitting} className={`${btnPrimary} w-full disabled:opacity-60`}>
              {submitting ? "Criando..." : "Criar banda"}
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function BandCard({
  band,
  active,
  inviting,
  onSelect,
  onToggleInvite,
}: {
  band: BandSummary;
  active: boolean;
  inviting: boolean;
  onSelect: () => void;
  onToggleInvite: () => void;
}) {
  const [email, setEmail] = useState("");
  const [canAnalyze, setCanAnalyze] = useState(false);
  const [canInvite, setCanInvite] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteOk, setInviteOk] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    setSending(true);
    setInviteError(null);
    setInviteOk(null);
    try {
      await inviteBandMember(band.id, email.trim(), {
        can_analyze_songs: canAnalyze,
        can_invite_members: canInvite,
        can_manage_members: canManage,
        can_delete_songs: canDelete,
      });
      setInviteOk(`Convite enviado para ${email.trim()}`);
      setEmail("");
      setCanAnalyze(false);
      setCanInvite(false);
      setCanManage(false);
      setCanDelete(false);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Erro ao convidar");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className={`${panelHoverClass} p-4 ${
        active ? "border-green-500/50 bg-green-500/10 shadow-[0_0_24px_rgba(34,197,94,0.12)]" : ""
      }`}
    >
      <button type="button" onClick={onSelect} className="w-full text-left">
        <p className="font-medium">{band.name}</p>
        <p className="text-sm text-slate-400">
          {band.plan_code} · {band.status} · {band.member_count}/{band.member_limit} membros
          {band.is_owner ? " · dono" : ""}
        </p>
        {band.status === "trial" ? (
          <p className="mt-2 text-xs text-amber-300">Trial: visualização de cifras sem análise</p>
        ) : null}
        {band.is_blocked ? (
          <p className="mt-2 text-xs text-red-300">Bloqueada por falta de pagamento</p>
        ) : null}
      </button>

      <div className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-3 sm:flex-row sm:flex-wrap">
        <Link
          to="/library"
          className={`${btnPrimary} px-3 py-2 text-center text-sm`}
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
        >
          Biblioteca
        </Link>
        <Link
          to={`/bandas/${band.id}`}
          className={`${btnGhost} px-3 py-2 text-center text-sm`}
          onClick={(e) => e.stopPropagation()}
        >
          Gerenciar Banda
        </Link>
        {band.is_owner || band.can_invite_members ? (
          <button type="button" onClick={onToggleInvite} className={`${btnGhost} px-3 py-2 text-sm`}>
            {inviting ? "Fechar convite" : "Convidar por e-mail"}
          </button>
        ) : null}
      </div>

      {inviting && (band.is_owner || band.can_invite_members) ? (
        <form onSubmit={(e) => void handleInvite(e)} className="mt-3 space-y-3">
          <label className={labelClass}>
            <span>E-mail do convidado</span>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm text-slate-300">Permissões do convidado</legend>
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
          {inviteError ? <p className="text-sm text-red-400">{inviteError}</p> : null}
          {inviteOk ? <p className="text-sm text-green-300">{inviteOk}</p> : null}
          <button type="submit" disabled={sending} className={`${btnPrimary} disabled:opacity-60`}>
            {sending ? "Enviando..." : "Enviar convite"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
