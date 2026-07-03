import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { useAuth } from "../lib/auth-context";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
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
      navigate("/library");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Entrar</h1>
        <p className="text-slate-400">Use e-mail ou CPF e sua senha.</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block space-y-1 text-sm">
          <span>E-mail ou CPF</span>
          <input
            required
            value={loginValue}
            onChange={(e) => setLoginValue(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Senha</span>
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
          />
        </label>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400 disabled:opacity-60"
        >
          {submitting ? "Entrando..." : "Entrar"}
        </button>
      </form>
      <p className="text-sm text-slate-400">
        Não tem conta?{" "}
        <Link to="/cadastro" className="text-indigo-300 hover:text-indigo-200">
          Cadastre-se
        </Link>
      </p>
    </section>
  );
}
