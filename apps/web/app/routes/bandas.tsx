import { useState } from "react";
import { Link } from "react-router";
import { PLANS, formatBrl } from "@softmusic/shared";

import { btnPrimary, inputClass, labelClass, linkClass, panelClass, panelHoverClass } from "../lib/ui-classes";
import { useBand } from "../lib/band-context";

const PLANS_LIST = Object.values(PLANS).map((plan) => ({
  code: plan.code,
  label: `${plan.name} — ${formatBrl(plan.basePriceCents)}/mês`,
}));

export default function BandasPage() {
  const { bands, activeBand, setActiveBandId, createBand, loading } = useBand();
  const [name, setName] = useState("");
  const [planCode, setPlanCode] = useState("individual");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createBand(name.trim(), planCode);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar banda");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-8">
      <div>
        <h1 className="sm-page-title">Minhas bandas</h1>
        <p className="sm-page-subtitle">Escolha a banda ativa ou crie uma nova.</p>
      </div>

      {loading ? <p className="text-slate-400">Carregando...</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {bands.map((band) => (
          <button
            key={band.id}
            type="button"
            onClick={() => setActiveBandId(band.id)}
            className={`${panelHoverClass} p-4 text-left ${
              activeBand?.id === band.id
                ? "border-green-500/50 bg-green-500/10 shadow-[0_0_24px_rgba(34,197,94,0.12)]"
                : ""
            }`}
          >
            <p className="font-medium">{band.name}</p>
            <p className="text-sm text-slate-400">
              {band.plan_code} · {band.status} · {band.member_count}/{band.member_limit} membros
            </p>
            {band.status === "trial" ? (
              <p className="mt-2 text-xs text-amber-300">Trial: visualização de cifras sem análise</p>
            ) : null}
          </button>
        ))}
      </div>

      {bands.length > 0 ? (
        <Link to="/library" className={`text-sm ${linkClass}`}>
          Ir para biblioteca com &quot;{activeBand?.name}&quot;
        </Link>
      ) : null}

      <form onSubmit={handleCreate} className={`${panelClass} max-w-md space-y-4`}>
        <h2 className="font-medium">Nova banda</h2>
        <label className={labelClass}>
          <span>Nome</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>Plano</span>
          <select
            value={planCode}
            onChange={(e) => setPlanCode(e.target.value)}
            className={inputClass}
          >
            {PLANS_LIST.map((plan) => (
              <option key={plan.code} value={plan.code}>
                {plan.label}
              </option>
            ))}
          </select>
        </label>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <button type="submit" disabled={submitting} className={`${btnPrimary} disabled:opacity-60`}>
          {submitting ? "Criando..." : "Criar banda"}
        </button>
      </form>
    </section>
  );
}
