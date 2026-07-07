import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { authFetch } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { btnPrimary, panelClass } from "../lib/ui-classes";

export default function ConvitePage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") ?? "";
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function acceptInvite() {
    if (!token) {
      setError("Link de convite inválido");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await authFetch("/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.detail ?? "Não foi possível aceitar o convite");
      }
      navigate("/bandas");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao aceitar convite");
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) {
    return (
      <section className={`${panelClass} mx-auto max-w-md space-y-4 text-center`}>
        <h1 className="sm-page-title">Convite para banda</h1>
        <p className="sm-page-subtitle">Faça login ou crie uma conta para aceitar o convite.</p>
        <Link
          to={`/login?next=/convite?token=${encodeURIComponent(token)}`}
          className={`${btnPrimary} inline-flex`}
        >
          Ir para login
        </Link>
      </section>
    );
  }

  return (
    <section className={`${panelClass} mx-auto max-w-md space-y-4`}>
      <h1 className="sm-page-title">Aceitar convite</h1>
      <p className="sm-page-subtitle">Você foi convidado para participar de uma banda no SoftMusic.</p>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <button
        type="button"
        onClick={() => void acceptInvite()}
        disabled={submitting || !token}
        className={`${btnPrimary} disabled:opacity-60`}
      >
        {submitting ? "Aceitando..." : "Aceitar convite"}
      </button>
    </section>
  );
}
