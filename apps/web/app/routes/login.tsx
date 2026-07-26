import { useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";

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
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [loginValue, setLoginValue] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordResetOk = Boolean(
    (location.state as { passwordReset?: boolean } | null)?.passwordReset,
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(loginValue.trim(), password);
      // Home (/) por padrão. Nunca usa location.state.from (costumava mandar para /bandas).
      // ?next= só para fluxos explícitos (ex.: convite) — e nunca /bandas.
      const next = safeNextPath(searchParams.get("next"));
      navigate(next === "/bandas" ? "/" : next, { replace: true });
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
      {passwordResetOk ? (
        <p className="text-sm text-emerald-400">Senha redefinida. Faça login com a nova senha.</p>
      ) : null}
      <form onSubmit={handleSubmit} className="glass-panel space-y-4">
        <label htmlFor="login" className={labelClass}>
          <span>E-mail ou CPF</span>
          <input
            id="login"
            name="login"
            required
            value={loginValue}
            onChange={(e) => setLoginValue(e.target.value)}
            className={inputClass}
            autoComplete="username"
          />
        </label>
        <label htmlFor="password" className={labelClass}>
          <span>Senha</span>
          <input
            id="password"
            name="password"
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            autoComplete="current-password"
          />
        </label>
        <div className="flex justify-end">
          <Link to="/esqueci-senha" className={`${linkClass} text-sm`}>
            Esqueci minha senha
          </Link>
        </div>
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
