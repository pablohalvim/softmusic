import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { useAuth } from "../lib/auth-context";
import { btnPrimary, inputClass, labelClass, linkClass } from "../lib/ui-classes";

function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/";
  }
  return raw;
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loginValue, setLoginValue] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(loginValue.trim(), password);
      // Home por padrão; ?next= só para fluxos específicos (ex.: convite).
      navigate(safeNextPath(searchParams.get("next")));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="sm-page-title">Entrar</h1>
        <p className="sm-page-subtitle">Use e-mail ou CPF e sua senha.</p>
      </div>
      <form onSubmit={handleSubmit} className="glass-panel space-y-4">
        <label className={labelClass}>
          <span>E-mail ou CPF</span>
          <input
            required
            value={loginValue}
            onChange={(e) => setLoginValue(e.target.value)}
            className={inputClass}
            autoComplete="username"
          />
        </label>
        <label className={labelClass}>
          <span>Senha</span>
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            autoComplete="current-password"
          />
        </label>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <button type="submit" disabled={submitting} className={`${btnPrimary} w-full`}>
          {submitting ? "Entrando..." : "Entrar"}
        </button>
      </form>
      <p className="text-sm text-slate-400">
        Não tem conta?{" "}
        <Link to="/cadastro" className={linkClass}>
          Cadastre-se
        </Link>
      </p>
    </section>
  );
}
