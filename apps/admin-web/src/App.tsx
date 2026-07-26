import { useEffect, useState } from "react";

import {
  adminLogin,
  clearAdminToken,
  fetchAdminBands,
  fetchAdminInvoices,
  fetchAdminUsers,
  fetchAsaasSettings,
  getAdminToken,
  sendMarketing,
  setBandExempt,
  suspendBand,
  suspendOverdueAccounts,
  updateAsaasSettings,
  type AsaasSettings,
} from "./lib/api";
import { AdminDashboard } from "./components/AdminDashboard";

type Tab = "dashboard" | "users" | "bands" | "invoices" | "settings" | "marketing";

const STATUS_LABEL: Record<string, string> = {
  awaiting_payment: "Aguardando Pagamento",
  paid: "Pago",
  overdue: "Atrasado",
  cancelled: "Cancelada",
  refunded: "Estornada",
  pending: "Aguardando Pagamento",
};

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function App() {
  const [token, setToken] = useState(getAdminToken);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [users, setUsers] = useState<Array<Record<string, unknown>>>([]);
  const [bands, setBands] = useState<Array<Record<string, unknown>>>([]);
  const [invoices, setInvoices] = useState<Array<Record<string, unknown>>>([]);
  const [settings, setSettings] = useState<AsaasSettings | null>(null);
  const [asaasKey, setAsaasKey] = useState("");
  const [asaasEnv, setAsaasEnv] = useState<"sandbox" | "production">("sandbox");
  const [asaasWebhook, setAsaasWebhook] = useState("");
  const [marketingSubject, setMarketingSubject] = useState("");
  const [marketingBody, setMarketingBody] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    if (tab === "dashboard" || tab === "marketing") return;
    void loadData();
  }, [token, tab]);

  async function loadData() {
    setError(null);
    try {
      if (tab === "users") {
        const payload = await fetchAdminUsers();
        setUsers(payload.items ?? []);
      } else if (tab === "bands") {
        const payload = await fetchAdminBands();
        setBands(payload.items ?? []);
      } else if (tab === "invoices") {
        const payload = await fetchAdminInvoices();
        setInvoices(payload.items ?? []);
      } else if (tab === "settings") {
        const payload = await fetchAsaasSettings();
        setSettings(payload);
        setAsaasEnv((payload.asaas_environment as "sandbox" | "production") || "sandbox");
      }
    } catch (err) {
      if (!getAdminToken()) {
        setToken(null);
      }
      setError(err instanceof Error ? err.message : "Erro ao carregar dados");
    }
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await adminLogin(email, password);
      setToken(getAdminToken());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login");
    }
  }

  function logout() {
    clearAdminToken();
    setToken(null);
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const payload: {
        asaas_api_key?: string;
        asaas_environment: "sandbox" | "production";
        asaas_webhook_token?: string;
      } = { asaas_environment: asaasEnv };
      if (asaasKey.trim()) payload.asaas_api_key = asaasKey.trim();
      if (asaasWebhook.trim()) payload.asaas_webhook_token = asaasWebhook.trim();
      const updated = await updateAsaasSettings(payload);
      setSettings(updated);
      setAsaasKey("");
      setAsaasWebhook("");
      setStatus("Parametrização Asaas salva");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    }
  }

  if (!token) {
    return (
      <main className="page">
        <h1>SoftMusic Admin</h1>
        <form onSubmit={handleLogin} className="card">
          <label>
            E-mail
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
          </label>
          <label>
            Senha
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit">Entrar</button>
        </form>
      </main>
    );
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "dashboard", label: "Dashboard" },
    { id: "bands", label: "Bandas" },
    { id: "invoices", label: "Faturas" },
    { id: "users", label: "Usuários" },
    { id: "settings", label: "Parametrização" },
    { id: "marketing", label: "Marketing" },
  ];

  return (
    <main className="page">
      <header className="header">
        <h1>SoftMusic Admin</h1>
        <div className="header-actions">
          <button
            type="button"
            onClick={() =>
              void suspendOverdueAccounts().then((r) => setStatus(`Robô: ${JSON.stringify(r)}`))
            }
          >
            Rodar robô billing
          </button>
          <button type="button" onClick={logout}>
            Sair
          </button>
        </div>
      </header>

      <nav className="tabs">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? "active" : ""}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {status ? <p className="status">{status}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {tab === "dashboard" ? <AdminDashboard onUnauthorized={() => setToken(null)} /> : null}

      {tab === "users" ? (
        <section className="card">
          <h2>Usuários</h2>
          <ul>
            {users.map((user) => (
              <li key={String(user.id)}>
                {String(user.full_name)} — {String(user.email)} ({String(user.status)})
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "bands" ? (
        <section className="card">
          <h2>Bandas</h2>
          <ul className="band-list">
            {bands.map((band) => (
              <li key={String(band.id)}>
                <div>
                  <strong>{String(band.name)}</strong>
                  <span>
                    {String(band.plan_code)} · {String(band.status)}
                    {band.billing_exempt ? " · isenta" : ""}
                  </span>
                </div>
                <div className="actions">
                  <button
                    type="button"
                    onClick={() =>
                      void setBandExempt(String(band.id), !band.billing_exempt, "Ajuste manual").then(loadData)
                    }
                  >
                    {band.billing_exempt ? "Remover isenção" : "Isentar"}
                  </button>
                  <button type="button" onClick={() => void suspendBand(String(band.id)).then(loadData)}>
                    Suspender
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "invoices" ? (
        <section className="card">
          <h2>Faturas (todas as bandas)</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Responsável</th>
                  <th>Tipo</th>
                  <th>Valor</th>
                  <th>Vencimento</th>
                  <th>Status</th>
                  <th>Itens</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={String(invoice.id)}>
                    <td>{String(invoice.invoice_number ?? "—")}</td>
                    <td>
                      {String(invoice.owner_name ?? "—")}
                      <br />
                      <small>{String(invoice.owner_email ?? "")}</small>
                    </td>
                    <td>{invoice.invoice_kind === "recurrence" ? "Recorrência" : "1ª fatura"}</td>
                    <td>{formatBrl(Number(invoice.total_amount_cents ?? 0))}</td>
                    <td>
                      {invoice.due_date
                        ? new Date(String(invoice.due_date)).toLocaleDateString("pt-BR")
                        : "—"}
                    </td>
                    <td>{STATUS_LABEL[String(invoice.status)] ?? String(invoice.status)}</td>
                    <td>
                      <ul className="compact-list">
                        {((invoice.line_items as Array<Record<string, unknown>>) ?? []).map((line, idx) => (
                          <li key={`${String(invoice.id)}-${idx}`}>
                            {String(line.description)} — {formatBrl(Number(line.amount_cents ?? 0))}
                            {!bands.find((b) => b.id === line.band_id && b.billing_exempt) ? (
                              <button
                                type="button"
                                className="linkish"
                                onClick={() =>
                                  void setBandExempt(String(line.band_id), true, "Isenção via faturas").then(
                                    loadData,
                                  )
                                }
                              >
                                Isentar banda
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td>{invoice.has_asaas_link ? "Asaas" : "Local"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === "settings" ? (
        <section className="card">
          <h2>Parametrização Asaas</h2>
          <p className="muted">
            Token e ambiente usados para gerar cobranças sob demanda quando o cliente clicar em Pagar.
            Documentação:{" "}
            <a href="https://docs.asaas.com/reference/comece-por-aqui" target="_blank" rel="noreferrer">
              docs.asaas.com
            </a>
          </p>
          {settings ? (
            <p className="muted">
              Token atual: {settings.asaas_api_key_configured ? settings.asaas_api_key_masked : "não configurado"} ·
              Webhook: {settings.asaas_webhook_token_configured ? "configurado" : "não configurado"}
            </p>
          ) : null}
          <form onSubmit={(e) => void saveSettings(e)} className="stack">
            <label>
              Token Asaas (API key)
              <input
                value={asaasKey}
                onChange={(e) => setAsaasKey(e.target.value)}
                placeholder="Cole o novo token para substituir"
                autoComplete="off"
              />
            </label>
            <label>
              Ambiente
              <select value={asaasEnv} onChange={(e) => setAsaasEnv(e.target.value as "sandbox" | "production")}>
                <option value="sandbox">Sandbox</option>
                <option value="production">Produção</option>
              </select>
            </label>
            <label>
              Token do webhook (asaas-access-token)
              <input
                value={asaasWebhook}
                onChange={(e) => setAsaasWebhook(e.target.value)}
                placeholder="Opcional — cole para atualizar"
                autoComplete="off"
              />
            </label>
            <button type="submit">Salvar</button>
          </form>
        </section>
      ) : null}

      {tab === "marketing" ? (
        <section className="card">
          <h2>Campanha de e-mail</h2>
          <label>
            Assunto
            <input value={marketingSubject} onChange={(e) => setMarketingSubject(e.target.value)} />
          </label>
          <label>
            Corpo
            <textarea rows={8} value={marketingBody} onChange={(e) => setMarketingBody(e.target.value)} />
          </label>
          <button
            type="button"
            onClick={() =>
              void sendMarketing(marketingSubject, marketingBody)
                .then((r) => setStatus(`Enviado para ${r.sent ?? 0} destinatários`))
                .catch((err) => setError(err.message))
            }
          >
            Enviar
          </button>
        </section>
      ) : null}
    </main>
  );
}
