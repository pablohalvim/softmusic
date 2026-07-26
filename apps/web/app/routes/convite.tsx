import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { authFetch } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { btnGhost, btnPrimary, panelClass } from "../lib/ui-classes";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

export default function ConvitePage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") ?? "";
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [bandName, setBandName] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(
          `${apiUrl}/invites/preview?token=${encodeURIComponent(token)}`,
        );
        if (!response.ok) return;
        const payload = (await response.json()) as { band_name: string };
        if (!cancelled) setBandName(payload.band_name);
      } catch {
        // preview opcional
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

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
      navigate("/");
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
        <p className="sm-page-subtitle">
          {bandName
            ? `A banda "${bandName}" convidou você para o SoftMusic.`
            : "Faça login ou crie uma conta para aceitar o convite."}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link to={`/cadastro?token=${encodeURIComponent(token)}`} className={`${btnPrimary} inline-flex justify-center`}>
            Criar conta e aceitar
          </Link>
          <Link
            to={`/login?next=${encodeURIComponent(`/convite?token=${token}`)}`}
            className={`${btnGhost} inline-flex justify-center`}
          >
            Já tenho conta
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className={`${panelClass} mx-auto max-w-md space-y-4`}>
      <h1 className="sm-page-title">Aceitar convite</h1>
      <p className="sm-page-subtitle">
        {bandName
          ? `Você foi convidado para a banda "${bandName}".`
          : "Você foi convidado para participar de uma banda no SoftMusic."}
      </p>
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
