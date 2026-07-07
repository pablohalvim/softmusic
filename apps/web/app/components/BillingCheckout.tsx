import { useState } from "react";

import { authFetch } from "../lib/api";
import {
  alertInfoClass,
  btnPrimary,
  inputClass,
  labelClass,
  linkClass,
  panelClass,
  segmentedActiveClass,
  segmentedIdleClass,
  segmentedWrapClass,
} from "../lib/ui-classes";

interface CheckoutResult {
  invoice_id: string;
  status: string;
  payment_method: string;
  total_amount_cents: number;
  invoice_url: string | null;
  pix: { qr_image_base64: string | null; copy_paste: string | null } | null;
  payment_status?: string;
}

interface BillingCheckoutProps {
  monthlyTotalCents: number;
  onSuccess?: () => void;
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function BillingCheckout({ monthlyTotalCents, onSuccess }: BillingCheckoutProps) {
  const [method, setMethod] = useState<"pix" | "credit_card">("pix");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [card, setCard] = useState({
    holder_name: "",
    number: "",
    expiry_month: "",
    expiry_year: "",
    ccv: "",
  });

  async function handleCheckout(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { payment_method: method };
      if (method === "credit_card") {
        body.credit_card = card;
      }
      const response = await authFetch("/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.detail ?? payload?.error?.message ?? "Falha no checkout");
      }
      const payload = (await response.json()) as CheckoutResult;
      setResult(payload);
      if (payload.payment_status === "CONFIRMED") {
        onSuccess?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro no pagamento");
    } finally {
      setLoading(false);
    }
  }

  if (result?.payment_method === "pix" && result.pix) {
    return (
      <div className={`${alertInfoClass} space-y-4`}>
        <h2 className="font-medium">Pague com PIX — {formatBrl(result.total_amount_cents)}</h2>
        {result.pix.qr_image_base64 ? (
          <img
            src={`data:image/png;base64,${result.pix.qr_image_base64}`}
            alt="QR Code PIX"
            className="mx-auto h-48 w-48 rounded-xl bg-white p-2 shadow-lg"
          />
        ) : null}
        {result.pix.copy_paste ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-400">Copia e cola:</p>
            <textarea readOnly value={result.pix.copy_paste} className={`${inputClass} text-xs`} rows={3} />
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(result.pix!.copy_paste!)}
              className={btnPrimary}
            >
              Copiar código PIX
            </button>
          </div>
        ) : null}
        {result.invoice_url ? (
          <a href={result.invoice_url} target="_blank" rel="noreferrer" className={`inline-block text-sm ${linkClass}`}>
            Abrir fatura no Asaas
          </a>
        ) : null}
      </div>
    );
  }

  if (result?.payment_status === "CONFIRMED") {
    return (
      <div className={`${alertInfoClass} text-emerald-200`}>
        Pagamento confirmado! Sua assinatura será ativada em instantes.
      </div>
    );
  }

  return (
    <form onSubmit={handleCheckout} className={`${panelClass} space-y-4`}>
      <div>
        <h2 className="font-medium text-slate-100">Ativar assinatura</h2>
        <p className="text-sm text-slate-400">Total mensal: {formatBrl(monthlyTotalCents)}</p>
      </div>

      <div className={segmentedWrapClass}>
        <button
          type="button"
          onClick={() => setMethod("pix")}
          className={method === "pix" ? segmentedActiveClass : segmentedIdleClass}
        >
          PIX
        </button>
        <button
          type="button"
          onClick={() => setMethod("credit_card")}
          className={method === "credit_card" ? segmentedActiveClass : segmentedIdleClass}
        >
          Cartão
        </button>
      </div>

      {method === "credit_card" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={`${labelClass} sm:col-span-2`}>
            <span>Nome no cartão</span>
            <input
              required
              value={card.holder_name}
              onChange={(e) => setCard((c) => ({ ...c, holder_name: e.target.value }))}
              className={inputClass}
            />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            <span>Número</span>
            <input
              required
              inputMode="numeric"
              value={card.number}
              onChange={(e) => setCard((c) => ({ ...c, number: e.target.value.replace(/\D/g, "") }))}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            <span>Mês (MM)</span>
            <input
              required
              maxLength={2}
              value={card.expiry_month}
              onChange={(e) => setCard((c) => ({ ...c, expiry_month: e.target.value }))}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            <span>Ano (AAAA)</span>
            <input
              required
              maxLength={4}
              value={card.expiry_year}
              onChange={(e) => setCard((c) => ({ ...c, expiry_year: e.target.value }))}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            <span>CVV</span>
            <input
              required
              maxLength={4}
              value={card.ccv}
              onChange={(e) => setCard((c) => ({ ...c, ccv: e.target.value }))}
              className={inputClass}
            />
          </label>
        </div>
      ) : (
        <p className="text-sm text-slate-400">
          Ao confirmar, geramos um QR Code PIX válido por alguns dias.
        </p>
      )}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <button type="submit" disabled={loading || monthlyTotalCents <= 0} className={`${btnPrimary} disabled:opacity-60`}>
        {loading ? "Processando..." : method === "pix" ? "Gerar PIX" : "Pagar com cartão"}
      </button>
    </form>
  );
}
