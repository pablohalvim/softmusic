import { useQuery, useQueryClient } from "@tanstack/react-query";

import { BillingCheckout } from "../components/BillingCheckout";
import { authFetch } from "../lib/api";
import { useBand } from "../lib/band-context";

interface InvoiceLine {
  band_id: string;
  description: string;
  amount_cents: number;
}

interface Invoice {
  id: string;
  total_amount_cents: number;
  status: string;
  due_date: string;
  paid_at: string | null;
  payment_method: string | null;
  invoice_url: string | null;
  pix?: { qr_image_base64: string | null; copy_paste: string | null } | null;
  line_items: InvoiceLine[];
}

interface BillingStatus {
  status: string;
  monthly_total_cents: number;
  grace_period_ends_at: string | null;
  bands: Array<{
    id: string;
    name: string;
    plan_code: string;
    status: string;
    monthly_amount_cents: number;
  }>;
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function FaturasPage() {
  const { activeBand } = useBand();
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ["billing-status"],
    queryFn: async () => {
      const response = await authFetch("/billing/status");
      if (!response.ok) {
        throw new Error("Não foi possível carregar status da assinatura");
      }
      return response.json() as Promise<BillingStatus>;
    },
  });

  const invoicesQuery = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => {
      const response = await authFetch("/billing/invoices");
      if (!response.ok) {
        throw new Error("Não foi possível carregar faturas");
      }
      const payload = await response.json();
      return (payload.items ?? []) as Invoice[];
    },
  });

  const status = statusQuery.data;
  const invoices = invoicesQuery.data ?? [];
  const showCheckout =
    status &&
    status.monthly_total_cents > 0 &&
    ["pending", "past_due", "trial"].includes(status.status);

  function refreshBilling() {
    void queryClient.invalidateQueries({ queryKey: ["billing-status"] });
    void queryClient.invalidateQueries({ queryKey: ["invoices"] });
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Faturas e assinatura</h1>
        <p className="text-slate-400">
          Assinatura consolidada do responsável pela conta
          {activeBand ? ` (banda ativa: ${activeBand.name})` : ""}.
        </p>
      </div>

      {statusQuery.isLoading ? <p className="text-slate-400">Carregando status...</p> : null}

      {status ? (
        <div className="rounded-xl border border-slate-800 p-4 text-sm text-slate-300">
          <p>
            Status da conta: <span className="text-slate-100">{status.status}</span> · Mensal:{" "}
            {formatBrl(status.monthly_total_cents)}
          </p>
          {status.grace_period_ends_at ? (
            <p className="mt-1 text-amber-300">
              Tolerância até{" "}
              {new Date(status.grace_period_ends_at).toLocaleDateString("pt-BR")} — regularize o pagamento.
            </p>
          ) : null}
          <ul className="mt-3 space-y-1 text-slate-400">
            {status.bands.map((band) => (
              <li key={band.id}>
                {band.name} ({band.plan_code}) — {formatBrl(band.monthly_amount_cents)} · {band.status}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showCheckout ? (
        <BillingCheckout monthlyTotalCents={status!.monthly_total_cents} onSuccess={refreshBilling} />
      ) : null}

      <div>
        <h2 className="text-lg font-medium">Histórico</h2>
        {invoicesQuery.isLoading ? <p className="mt-2 text-slate-400">Carregando...</p> : null}
        {invoicesQuery.isError ? <p className="mt-2 text-red-400">Erro ao carregar faturas.</p> : null}

        {invoices.length === 0 && !invoicesQuery.isLoading ? (
          <p className="mt-2 text-slate-400">Nenhuma fatura registrada ainda.</p>
        ) : (
          <div className="mt-4 space-y-4">
            {invoices.map((invoice) => (
              <article key={invoice.id} className="rounded-xl border border-slate-800 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{formatBrl(invoice.total_amount_cents)}</p>
                    <p className="text-sm text-slate-400">
                      Vencimento: {new Date(invoice.due_date).toLocaleDateString("pt-BR")} · {invoice.status}
                    </p>
                  </div>
                  {invoice.invoice_url ? (
                    <a
                      href={invoice.invoice_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-green-300 hover:text-green-200"
                    >
                      Ver no Asaas
                    </a>
                  ) : null}
                </div>
                {invoice.pix?.copy_paste ? (
                  <p className="mt-2 text-xs text-slate-500">PIX disponível nesta fatura</p>
                ) : null}
                <ul className="mt-3 space-y-1 text-sm text-slate-400">
                  {invoice.line_items.map((line, index) => (
                    <li key={`${invoice.id}-${index}`}>
                      {line.description} — {formatBrl(line.amount_cents)}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
