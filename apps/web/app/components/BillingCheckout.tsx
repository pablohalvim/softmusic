import { useState } from "react";

import { authFetch } from "../lib/api";

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
      <div className="rounded-xl border border-green-900/40 bg-green-950/20 p-4 space-y-4">
        <h2 className="font-medium">Pague com PIX — {formatBrl(result.total_amount_cents)}</h2>
        {result.pix.qr_image_base64 ? (
          <img
            src={`data:image/png;base64,${result.pix.qr_image_base64}`}
            alt="QR Code PIX"
            className="mx-auto h-48 w-48 rounded-lg bg-white p-2"
          />
        ) : null}
        {result.pix.copy_paste ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-400">Copia e cola:</p>
            <textarea
              readOnly
              value={result.pix.copy_paste}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs text-slate-200"
              rows={3}
            />
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(result.pix!.copy_paste!)}
              className="rounded-lg bg-green-500 px-3 py-1.5 text-sm text-white hover:bg-green-400"
            >
              Copiar código PIX
            </button>
          </div>
        ) : null}
        {result.invoice_url ? (
          <a
            href={result.invoice_url}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-sm text-green-300 hover:text-green-200"
          >
            Abrir fatura no Asaas
          </a>
        ) : null}
      </div>
    );
  }

  if (result?.payment_status === "CONFIRMED") {
    return (
      <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-4 text-emerald-200">
        Pagamento confirmado! Sua assinatura será ativada em instantes.
      </div>
    );
  }

  return (
    <form onSubmit={handleCheckout} className="rounded-xl border border-slate-800 p-4 space-y-4">
      <div>
        <h2 className="font-medium">Ativar assinatura</h2>
        <p className="text-sm text-slate-400">Total mensal: {formatBrl(monthlyTotalCents)}</p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMethod("pix")}
          className={`rounded-lg px-3 py-1.5 text-sm ${method === "pix" ? "bg-green-500 text-white" : "border border-slate-700 text-slate-300"}`}
        >
          PIX
        </button>
        <button
          type="button"
          onClick={() => setMethod("credit_card")}
          className={`rounded-lg px-3 py-1.5 text-sm ${method === "credit_card" ? "bg-green-500 text-white" : "border border-slate-700 text-slate-300"}`}
        >
          Cartão
        </button>
      </div>

      {method === "credit_card" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm sm:col-span-2">
            <span>Nome no cartão</span>
            <input
              required
              value={card.holder_name}
              onChange={(e) => setCard((c) => ({ ...c, holder_name: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            />
          </label>
          <label className="block space-y-1 text-sm sm:col-span-2">
            <span>Número</span>
            <input
              required
              inputMode="numeric"
              value={card.number}
              onChange={(e) => setCard((c) => ({ ...c, number: e.target.value.replace(/\D/g, "") }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Mês (MM)</span>
            <input
              required
              maxLength={2}
              value={card.expiry_month}
              onChange={(e) => setCard((c) => ({ ...c, expiry_month: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Ano (AAAA)</span>
            <input
              required
              maxLength={4}
              value={card.expiry_year}
              onChange={(e) => setCard((c) => ({ ...c, expiry_year: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>CVV</span>
            <input
              required
              maxLength={4}
              value={card.ccv}
              onChange={(e) => setCard((c) => ({ ...c, ccv: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            />
          </label>
        </div>
      ) : (
        <p className="text-sm text-slate-400">
          Ao confirmar, geramos um QR Code PIX válido por alguns dias.
        </p>
      )}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <button
        type="submit"
        disabled={loading || monthlyTotalCents <= 0}
        className="rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-white hover:bg-green-400 disabled:opacity-60"
      >
        {loading ? "Processando..." : method === "pix" ? "Gerar PIX" : "Pagar com cartão"}
      </button>
    </form>
  );
}
