import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { apiUrl } from "../lib/api";
import { btnPrimary, inputClass, labelClass, linkClass } from "../lib/ui-classes";

type Step = "email" | "code" | "password";

async function parseError(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  try {
    const payload = JSON.parse(text) as {
      error?: { message?: string };
      detail?: string;
    };
    return payload.error?.message ?? payload.detail ?? fallback;
  } catch {
    return text || fallback;
  }
}

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSendCode(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch(`${apiUrl}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Não foi possível enviar o código"));
      }
      const payload = (await response.json()) as { message?: string };
      setStatus(payload.message ?? "Se o e-mail estiver cadastrado, enviaremos um código.");
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar código");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyCode(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const digits = code.replace(/\D/g, "");
      if (digits.length !== 6) {
        throw new Error("Informe o código de 6 dígitos");
      }
      const response = await fetch(`${apiUrl}/auth/verify-reset-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: digits }),
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Código inválido ou expirado"));
      }
      setCode(digits);
      setStatus("Código confirmado. Escolha sua nova senha.");
      setStep("password");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Código inválido");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (password.length < 8) {
        throw new Error("A senha deve ter no mínimo 8 caracteres");
      }
      if (password !== passwordConfirm) {
        throw new Error("As senhas não coincidem");
      }
      const response = await fetch(`${apiUrl}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          code,
          password,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Não foi possível redefinir a senha"));
      }
      navigate("/login", { replace: true, state: { passwordReset: true } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao redefinir senha");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="sm-page-title">Esqueci minha senha</h1>
        <p className="sm-page-subtitle">
          {step === "email"
            ? "Informe o e-mail da sua conta para receber um código."
            : step === "code"
              ? "Digite o código de 6 dígitos enviado por e-mail."
              : "Defina uma nova senha para acessar o SoftMusic."}
        </p>
      </div>

      {status ? <p className="text-sm text-emerald-400">{status}</p> : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {step === "email" ? (
        <form onSubmit={(e) => void handleSendCode(e)} className="glass-panel space-y-4">
          <label htmlFor="reset-email" className={labelClass}>
            <span>E-mail</span>
            <input
              id="reset-email"
              name="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              autoComplete="email"
            />
          </label>
          <button type="submit" disabled={submitting} className={`${btnPrimary} w-full`}>
            {submitting ? "Enviando..." : "Enviar código"}
          </button>
        </form>
      ) : null}

      {step === "code" ? (
        <form onSubmit={(e) => void handleVerifyCode(e)} className="glass-panel space-y-4">
          <label htmlFor="reset-code" className={labelClass}>
            <span>Código de 6 dígitos</span>
            <input
              id="reset-code"
              name="code"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className={`${inputClass} tracking-[0.35em] text-center text-lg`}
              autoComplete="one-time-code"
            />
          </label>
          <button type="submit" disabled={submitting || code.length !== 6} className={`${btnPrimary} w-full`}>
            {submitting ? "Validando..." : "Continuar"}
          </button>
          <button
            type="button"
            className="w-full text-sm text-slate-400 underline-offset-2 hover:underline"
            disabled={submitting}
            onClick={() => {
              setStep("email");
              setCode("");
              setError(null);
              setStatus(null);
            }}
          >
            Usar outro e-mail
          </button>
        </form>
      ) : null}

      {step === "password" ? (
        <form onSubmit={(e) => void handleResetPassword(e)} className="glass-panel space-y-4">
          <label htmlFor="new-password" className={labelClass}>
            <span>Nova senha</span>
            <input
              id="new-password"
              name="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              autoComplete="new-password"
            />
          </label>
          <label htmlFor="new-password-confirm" className={labelClass}>
            <span>Confirmar nova senha</span>
            <input
              id="new-password-confirm"
              name="password_confirm"
              type="password"
              required
              minLength={8}
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              className={inputClass}
              autoComplete="new-password"
            />
          </label>
          <button type="submit" disabled={submitting} className={`${btnPrimary} w-full`}>
            {submitting ? "Salvando..." : "Redefinir senha"}
          </button>
        </form>
      ) : null}

      <p className="text-sm text-slate-400">
        Lembrou a senha?{" "}
        <Link to="/login" className={linkClass}>
          Voltar ao login
        </Link>
      </p>
    </section>
  );
}
