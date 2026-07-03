import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { authFetch } from "../lib/api";
import { useAuth } from "../lib/auth-context";

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
      <section className="mx-auto max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Convite para banda</h1>
        <p className="text-slate-400">Faça login ou crie uma conta para aceitar o convite.</p>
        <a href={`/login?next=/convite?token=${encodeURIComponent(token)}`} className="inline-block rounded-lg bg-indigo-500 px-4 py-2 text-white">
          Ir para login
        </a>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-semibold">Aceitar convite</h1>
      <p className="text-slate-400">Você foi convidado para participar de uma banda no SoftMusic.</p>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <button
        type="button"
        onClick={() => void acceptInvite()}
        disabled={submitting || !token}
        className="rounded-lg bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400 disabled:opacity-60"
      >
        {submitting ? "Aceitando..." : "Aceitar convite"}
      </button>
    </section>
  );
}
