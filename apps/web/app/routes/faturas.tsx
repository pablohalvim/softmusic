import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { authFetch } from "../lib/api";
import { useBand } from "../lib/band-context";
import { useToast } from "../lib/toast";
import { btnGhost, btnPrimary, linkClass, panelClass } from "../lib/ui-classes";

interface InvoiceLine {
  id?: string;
  band_id: string;
  description: string;
  amount_cents: number;
  plan_code?: string | null;
  item_kind?: string;
  quantity?: number;
  unit_amount_cents?: number;
  band_name?: string | null;
  plan_label?: string | null;
}

interface Invoice {
  id: string;
  invoice_number?: number | null;
  invoice_kind?: "first" | "recurrence";
  total_amount_cents: number;
  status: string;
  due_date: string;
  paid_at: string | null;
  payment_method: string | null;
  invoice_url: string | null;
  can_pay?: boolean;
  can_refresh?: boolean;
  has_asaas_link?: boolean;
  line_items: InvoiceLine[];
}

const STATUS_LABEL: Record<string, string> = {
  awaiting_payment: "Aguardando Pagamento",
  pending: "Aguardando Pagamento",
  paid: "Pago",
  overdue: "Atrasado",
  cancelled: "Cancelada",
  refunded: "Estornada",
};

const STATUS_CLASS: Record<string, string> = {
  awaiting_payment: "bg-amber-500/15 text-amber-200 border-amber-400/30",
  pending: "bg-amber-500/15 text-amber-200 border-amber-400/30",
  paid: "bg-green-500/15 text-green-200 border-green-400/30",
  overdue: "bg-red-500/15 text-red-200 border-red-400/30",
  cancelled: "bg-slate-500/15 text-slate-300 border-slate-400/30",
  refunded: "bg-violet-500/15 text-violet-200 border-violet-400/30",
};

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDue(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export default function FaturasPage() {
  const { activeBand } = useBand();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [details, setDetails] = useState<Invoice | null>(null);

  const invoicesQuery = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => {
      const response = await authFetch("/billing/invoices");
      if (!response.ok) throw new Error("Não foi possível carregar faturas");
      const payload = await response.json();
      return (payload.items ?? []) as Invoice[];
    },
  });

  const payMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const response = await authFetch(`/billing/invoices/${invoiceId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        const text = await response.text();
        let message = "Não foi possível iniciar o pagamento";
        try {
          const payload = JSON.parse(text) as { detail?: string; error?: { message?: string } };
          message = payload.error?.message ?? payload.detail ?? message;
        } catch {
          if (text) message = text;
        }
        throw new Error(message);
      }
      return response.json() as Promise<{ invoice_url?: string | null }>;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      if (data.invoice_url) {
        window.location.href = data.invoice_url;
        return;
      }
      toast.error("Link de pagamento indisponível");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao pagar"),
  });

  const refreshMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const response = await authFetch(`/billing/invoices/${invoiceId}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        const text = await response.text();
        let message = "Não foi possível atualizar a fatura";
        try {
          const payload = JSON.parse(text) as { detail?: string; error?: { message?: string } };
          message = payload.error?.message ?? payload.detail ?? message;
        } catch {
          if (text) message = text;
        }
        throw new Error(message);
      }
      return response.json();
    },
    onSuccess: () => {
      toast.success("Fatura atualizada");
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao atualizar"),
  });

  const invoices = invoicesQuery.data ?? [];
  const groups = useMemo(() => {
    const open = invoices.filter((i) =>
      ["awaiting_payment", "pending", "overdue"].includes(i.status),
    );
    const paid = invoices.filter((i) => ["paid", "refunded"].includes(i.status));
    const cancelled = invoices.filter((i) => i.status === "cancelled");
    return { open, paid, cancelled };
  }, [invoices]);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="sm-page-title">Faturas</h1>
        <p className="sm-page-subtitle">
          Cobranças da sua conta
          {activeBand ? ` · banda ativa: ${activeBand.name}` : ""}.
        </p>
      </div>

      {invoicesQuery.isLoading ? <p className="text-slate-400">Carregando faturas...</p> : null}
      {invoicesQuery.isError ? <p className="text-red-400">Erro ao carregar faturas.</p> : null}

      {!invoicesQuery.isLoading && invoices.length === 0 ? (
        <p className="text-slate-400">Nenhuma fatura registrada ainda.</p>
      ) : null}

      <InvoiceSection
        title="Em aberto"
        invoices={groups.open}
        onPay={(id) => payMutation.mutate(id)}
        onRefresh={(id) => refreshMutation.mutate(id)}
        onDetails={setDetails}
        payingId={payMutation.isPending ? payMutation.variables : null}
        refreshingId={refreshMutation.isPending ? refreshMutation.variables : null}
      />
      <InvoiceSection title="Pagas" invoices={groups.paid} onDetails={setDetails} />
      <InvoiceSection title="Canceladas" invoices={groups.cancelled} onDetails={setDetails} />

      {details ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center">
          <div className={`${panelClass} w-full max-w-lg space-y-4 p-5`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-50">Detalhes da fatura</h2>
                <p className="text-sm text-slate-400">
                  #{details.invoice_number ?? "—"} ·{" "}
                  {details.invoice_kind === "recurrence" ? "Recorrência" : "1ª fatura"}
                </p>
              </div>
              <button type="button" className={btnGhost} onClick={() => setDetails(null)}>
                Fechar
              </button>
            </div>
            <p className="text-2xl font-bold text-green-300">{formatBrl(details.total_amount_cents)}</p>
            <ul className="space-y-3 text-sm">
              {details.line_items.map((line, index) => (
                <li key={line.id ?? `${details.id}-${index}`} className="rounded-xl border border-white/10 p-3">
                  <p className="font-medium text-slate-100">{line.description}</p>
                  {line.item_kind === "extra_member" ? (
                    <p className="mt-1 text-slate-400">
                      {line.quantity ?? 0} usuário(s) × {formatBrl(line.unit_amount_cents ?? 0)} ={" "}
                      {formatBrl(line.amount_cents)}
                    </p>
                  ) : (
                    <p className="mt-1 text-slate-400">
                      Plano {line.plan_label ?? line.plan_code ?? "—"} · {formatBrl(line.amount_cents)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function InvoiceSection({
  title,
  invoices,
  onPay,
  onRefresh,
  onDetails,
  payingId,
  refreshingId,
}: {
  title: string;
  invoices: Invoice[];
  onPay?: (id: string) => void;
  onRefresh?: (id: string) => void;
  onDetails: (invoice: Invoice) => void;
  payingId?: string | null;
  refreshingId?: string | null;
}) {
  if (invoices.length === 0) return null;
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-medium text-slate-100">{title}</h2>
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-white/[0.04] text-slate-400">
            <tr>
              <th className="px-3 py-3 font-medium">#</th>
              <th className="px-3 py-3 font-medium">Valor</th>
              <th className="px-3 py-3 font-medium">Vencimento</th>
              <th className="px-3 py-3 font-medium">Tipo</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id} className="border-t border-white/5">
                <td className="px-3 py-3 font-medium text-slate-100">
                  #{invoice.invoice_number ?? "—"}
                </td>
                <td className="px-3 py-3 text-base font-bold text-green-300">
                  {formatBrl(invoice.total_amount_cents)}
                </td>
                <td className="px-3 py-3 capitalize text-slate-300">{formatDue(invoice.due_date)}</td>
                <td className="px-3 py-3 text-slate-400">
                  {invoice.invoice_kind === "recurrence" ? "Recorrência" : "1ª fatura"}
                </td>
                <td className="px-3 py-3">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs ${STATUS_CLASS[invoice.status] ?? "border-white/10 text-slate-300"}`}
                  >
                    {STATUS_LABEL[invoice.status] ?? invoice.status}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap justify-end gap-2">
                    <button type="button" className={`${btnGhost} px-3 py-1.5 text-xs`} onClick={() => onDetails(invoice)}>
                      Detalhes
                    </button>
                    {invoice.can_refresh && onRefresh ? (
                      <button
                        type="button"
                        className={`${btnGhost} border-amber-400/30 px-3 py-1.5 text-xs text-amber-200`}
                        disabled={refreshingId === invoice.id}
                        onClick={() => onRefresh(invoice.id)}
                      >
                        {refreshingId === invoice.id ? "Atualizando..." : "Atualizar fatura"}
                      </button>
                    ) : null}
                    {invoice.can_pay && onPay ? (
                      <button
                        type="button"
                        className={`${btnPrimary} px-3 py-1.5 text-xs`}
                        disabled={payingId === invoice.id}
                        onClick={() => onPay(invoice.id)}
                      >
                        {payingId === invoice.id ? "Abrindo..." : "Pagar"}
                      </button>
                    ) : null}
                    {invoice.invoice_url && !invoice.can_pay ? (
                      <a href={invoice.invoice_url} target="_blank" rel="noreferrer" className={`text-xs ${linkClass}`}>
                        Ver no Asaas
                      </a>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
