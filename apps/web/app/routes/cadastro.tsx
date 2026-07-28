import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { useAuth } from "../lib/auth-context";
import {
  cleanDigits,
  formatCep,
  formatCnpj,
  formatCpf,
  formatPhone,
  isValidCnpj,
  isValidCpf,
  isValidPhone,
} from "../lib/br-format";
import { btnPrimary, inputClass, labelClass, linkClass, panelClass } from "../lib/ui-classes";
import { useViaCep } from "../lib/use-viacep";

const PLANS = [
  { code: "individual", label: "Individual — R$ 29,90/mês" },
  { code: "band_10", label: "Banda até 10 — R$ 129,90/mês" },
  { code: "band_20", label: "Banda até 20 — R$ 199,90/mês" },
] as const;

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

export default function CadastroPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get("token")?.trim() || null;

  const [error, setError] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(Boolean(inviteToken));
  const [inviteBandName, setInviteBandName] = useState<string | null>(null);
  const [form, setForm] = useState({
    is_company: false,
    full_name: "",
    cpf: "",
    birth_date: "",
    email: "",
    phone: "",
    address_street: "",
    address_number: "",
    address_complement: "",
    address_neighborhood: "",
    address_city: "",
    address_state: "",
    address_zip: "",
    password: "",
    band_name: "",
    plan_code: "individual",
  });

  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    async function loadInvite() {
      setInviteLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `${apiUrl}/invites/preview?token=${encodeURIComponent(inviteToken!)}`,
        );
        if (!response.ok) {
          throw new Error("Convite inválido ou expirado");
        }
        const payload = (await response.json()) as { email: string; band_name: string };
        if (cancelled) return;
        setInviteBandName(payload.band_name);
        setForm((prev) => ({ ...prev, email: payload.email, band_name: "" }));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Convite inválido");
          setInviteBandName(null);
        }
      } finally {
        if (!cancelled) setInviteLoading(false);
      }
    }
    void loadInvite();
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  const { loading: cepLoading, error: cepError } = useViaCep(form.address_zip, (address) => {
    setForm((prev) => ({
      ...prev,
      address_street: address.street || prev.address_street,
      address_neighborhood: address.neighborhood || prev.address_neighborhood,
      address_city: address.city || prev.address_city,
      address_state: address.state || prev.address_state,
      address_complement: address.complement || prev.address_complement,
    }));
  });

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleCompanyToggle(checked: boolean) {
    setForm((prev) => ({
      ...prev,
      is_company: checked,
      cpf: "",
    }));
    setDocError(null);
  }

  function handleDocChange(value: string) {
    const max = form.is_company ? 14 : 11;
    const digits = cleanDigits(value).slice(0, max);
    updateField("cpf", digits);
    if (!docError) return;
    const ok = form.is_company
      ? digits.length < 14 || isValidCnpj(digits)
      : digits.length < 11 || isValidCpf(digits);
    if (ok) setDocError(null);
  }

  function validateDocument(): boolean {
    if (form.is_company) {
      if (!isValidCnpj(form.cpf)) {
        setDocError("CNPJ inválido");
        return false;
      }
    } else if (!isValidCpf(form.cpf)) {
      setDocError("CPF inválido");
      return false;
    }
    setDocError(null);
    return true;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (inviteToken && !inviteBandName) {
      setError("Convite inválido ou expirado");
      return;
    }
    if (!validateDocument()) {
      return;
    }
    if (!isValidPhone(form.phone)) {
      setError("Telefone inválido");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { band_name, plan_code, ...userPayload } = form;
      const cpfDigits = cleanDigits(userPayload.cpf);
      const zipDigits = cleanDigits(userPayload.address_zip);
      await register({
        ...userPayload,
        is_company: Boolean(userPayload.is_company),
        cpf: cpfDigits,
        address_zip: zipDigits,
        address_complement: userPayload.address_complement || undefined,
        ...(inviteToken ? { invite_token: inviteToken } : {}),
      });
      if (!inviteToken && band_name.trim()) {
        const { authFetch } = await import("../lib/api");
        await authFetch("/bands", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: band_name.trim(), plan_code }),
        });
      }
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no cadastro");
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass = inputClass;
  const isInviteFlow = Boolean(inviteToken);

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="sm-page-title">Criar conta</h1>
        <p className="sm-page-subtitle">
          {isInviteFlow
            ? inviteBandName
              ? `Convite da banda "${inviteBandName}". Complete o cadastro para entrar automaticamente.`
              : "Validando convite..."
            : "Trial de 2 dias para visualizar cifras (sem análise)."}
        </p>
      </div>

      {isInviteFlow && inviteBandName ? (
        <div className={`${panelClass} border-green-500/30 text-sm text-slate-300`}>
          Você foi convidado para <span className="font-medium text-green-300">{inviteBandName}</span>.
          Após criar a conta, o vínculo com a banda será feito automaticamente.
        </div>
      ) : null}

      {inviteLoading ? <p className="text-slate-400">Carregando convite...</p> : null}

      <form onSubmit={(e) => void handleSubmit(e)} className="glass-panel grid gap-4 sm:grid-cols-2">
        <label
          htmlFor="is_company"
          className="sm:col-span-2 flex cursor-pointer items-center gap-3 text-sm text-slate-200"
        >
          <input
            id="is_company"
            name="is_company"
            type="checkbox"
            className="size-4 rounded border-slate-600 bg-slate-950 text-green-500 focus:ring-green-500/40"
            checked={form.is_company}
            onChange={(e) => handleCompanyToggle(e.target.checked)}
          />
          <span>Pessoa Jurídica</span>
        </label>
        <label htmlFor="full_name" className={`${labelClass} sm:col-span-2`}>
          <span>{form.is_company ? "Razão Social" : "Nome completo"}</span>
          <input
            id="full_name"
            name="full_name"
            required
            className={fieldClass}
            value={form.full_name}
            onChange={(e) => updateField("full_name", e.target.value)}
          />
        </label>
        <label htmlFor="cpf" className={labelClass}>
          <span>{form.is_company ? "CNPJ" : "CPF"}</span>
          <input
            id="cpf"
            name="cpf"
            required
            inputMode="numeric"
            placeholder={form.is_company ? "00.000.000/0000-00" : "000.000.000-00"}
            className={`${fieldClass} ${docError ? "border-red-500/60 ring-red-500/20" : ""}`}
            value={form.is_company ? formatCnpj(form.cpf) : formatCpf(form.cpf)}
            onChange={(e) => handleDocChange(e.target.value)}
            onBlur={() => {
              if (form.cpf) validateDocument();
            }}
          />
          {docError ? <span className="text-xs text-red-400">{docError}</span> : null}
        </label>
        <label htmlFor="birth_date" className={labelClass}>
          <span>{form.is_company ? "Data de abertura" : "Data de nascimento"}</span>
          <input
            id="birth_date"
            name="birth_date"
            required
            type="date"
            className={fieldClass}
            value={form.birth_date}
            onChange={(e) => updateField("birth_date", e.target.value)}
          />
        </label>
        <label htmlFor="email" className={labelClass}>
          <span>E-mail</span>
          <input
            id="email"
            name="email"
            required
            type="email"
            className={fieldClass}
            value={form.email}
            readOnly={isInviteFlow}
            onChange={(e) => {
              if (!isInviteFlow) updateField("email", e.target.value);
            }}
          />
          {isInviteFlow ? (
            <span className="text-xs text-slate-500">E-mail do convite (não pode ser alterado).</span>
          ) : null}
        </label>
        <label htmlFor="phone" className={labelClass}>
          <span>Telefone</span>
          <input
            id="phone"
            name="phone"
            required
            type="tel"
            inputMode="numeric"
            placeholder="(11) 99999-9999"
            className={fieldClass}
            value={formatPhone(form.phone)}
            onChange={(e) => updateField("phone", cleanDigits(e.target.value).slice(0, 11))}
          />
        </label>
        <label htmlFor="address_zip" className={`${labelClass} sm:col-span-2`}>
          <span className="flex items-center gap-2">
            CEP
            {cepLoading ? <span className="text-xs text-slate-400">buscando…</span> : null}
          </span>
          <input
            id="address_zip"
            name="address_zip"
            required
            inputMode="numeric"
            placeholder="00000-000"
            maxLength={9}
            className={`${inputClass} ${cepError ? "border-red-500" : ""}`}
            value={formatCep(form.address_zip)}
            onChange={(e) => updateField("address_zip", cleanDigits(e.target.value).slice(0, 8))}
          />
          {cepError ? (
            <span className="text-xs text-red-400">{cepError}</span>
          ) : (
            <span className="text-xs text-slate-500">
              Preencha o CEP para completar o endereço automaticamente.
            </span>
          )}
        </label>
        <label htmlFor="address_street" className={`${labelClass} sm:col-span-2`}>
          <span>Rua</span>
          <input
            id="address_street"
            name="address_street"
            required
            className={fieldClass}
            value={form.address_street}
            onChange={(e) => updateField("address_street", e.target.value)}
          />
        </label>
        <label htmlFor="address_number" className={labelClass}>
          <span>Número</span>
          <input
            id="address_number"
            name="address_number"
            required
            className={fieldClass}
            value={form.address_number}
            onChange={(e) => updateField("address_number", e.target.value)}
          />
        </label>
        <label htmlFor="address_complement" className={labelClass}>
          <span>Complemento</span>
          <input
            id="address_complement"
            name="address_complement"
            className={fieldClass}
            value={form.address_complement}
            onChange={(e) => updateField("address_complement", e.target.value)}
          />
        </label>
        <label htmlFor="address_neighborhood" className={labelClass}>
          <span>Bairro</span>
          <input
            id="address_neighborhood"
            name="address_neighborhood"
            required
            className={fieldClass}
            value={form.address_neighborhood}
            onChange={(e) => updateField("address_neighborhood", e.target.value)}
          />
        </label>
        <label htmlFor="address_city" className={labelClass}>
          <span>Cidade</span>
          <input
            id="address_city"
            name="address_city"
            required
            className={fieldClass}
            value={form.address_city}
            onChange={(e) => updateField("address_city", e.target.value)}
          />
        </label>
        <label htmlFor="address_state" className={labelClass}>
          <span>UF</span>
          <input
            id="address_state"
            name="address_state"
            required
            maxLength={2}
            className={fieldClass}
            value={form.address_state}
            onChange={(e) => updateField("address_state", e.target.value.toUpperCase())}
          />
        </label>
        <label htmlFor="password" className={`${labelClass} sm:col-span-2`}>
          <span>Senha</span>
          <input
            id="password"
            name="password"
            required
            type="password"
            minLength={8}
            className={fieldClass}
            value={form.password}
            onChange={(e) => updateField("password", e.target.value)}
          />
        </label>

        {!isInviteFlow ? (
          <div className="sm:col-span-2 space-y-3 rounded-xl border border-slate-800 p-4">
            <h2 className="font-medium">Primeira banda (opcional)</h2>
            <label htmlFor="band_name" className={labelClass}>
              <span>Nome da banda</span>
              <input
                id="band_name"
                name="band_name"
                className={fieldClass}
                value={form.band_name}
                onChange={(e) => updateField("band_name", e.target.value)}
              />
            </label>
            <fieldset className="space-y-2">
              <legend className="text-sm text-slate-300">Plano</legend>
              <div className="grid gap-2" role="radiogroup" aria-label="Plano">
                {PLANS.map((plan) => {
                  const active = form.plan_code === plan.code;
                  return (
                    <button
                      key={plan.code}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => updateField("plan_code", plan.code)}
                      className={`sm-plan-option ${active ? "sm-plan-option-active" : ""}`}
                    >
                      {plan.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-400 sm:col-span-2">{error}</p> : null}
        <button
          type="submit"
          disabled={submitting || inviteLoading || (Boolean(inviteToken) && !inviteBandName)}
          className={`${btnPrimary} sm:col-span-2 disabled:opacity-60`}
        >
          {submitting
            ? "Criando conta..."
            : isInviteFlow
              ? "Criar conta e entrar na banda"
              : "Criar conta"}
        </button>
      </form>
      <p className="text-sm text-slate-400">
        Já tem conta?{" "}
        <Link
          to={
            inviteToken
              ? `/login?next=${encodeURIComponent(`/convite?token=${inviteToken}`)}`
              : "/login"
          }
          className={linkClass}
        >
          Entrar
        </Link>
      </p>
    </section>
  );
}
