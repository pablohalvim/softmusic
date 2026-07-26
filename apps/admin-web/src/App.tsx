import { useEffect, useMemo, useState } from "react";

import { formatAppFooter } from "@softmusic/shared";

import {
  adminLogin,
  clearAdminToken,
  createAdmin,
  fetchAdminBands,
  fetchAdminInvoices,
  fetchAdminMe,
  fetchAdminUsers,
  fetchAdmins,
  fetchAsaasSettings,
  generateInvoicePaymentLink,
  getAdminToken,
  getStoredAdmin,
  isFullAdmin,
  registerSale,
  resetAdminPassword,
  sendMarketing,
  setBandExempt,
  suspendBand,
  suspendOverdueAccounts,
  updateAdmin,
  updateAsaasSettings,
  type AdminProfile,
  type AdminRole,
  type AsaasSettings,
} from "./lib/api";
import { AdminDashboard } from "./components/AdminDashboard";

function AppFooter() {
  return <footer className="app-footer">{formatAppFooter()}</footer>;
}

type Tab =
  | "dashboard"
  | "sales"
  | "users"
  | "bands"
  | "invoices"
  | "admins"
  | "settings"
  | "marketing";

const STATUS_LABEL: Record<string, string> = {
  awaiting_payment: "Aguardando Pagamento",
  paid: "Pago",
  overdue: "Atrasado",
  cancelled: "Cancelada",
  refunded: "Estornada",
  pending: "Aguardando Pagamento",
};

const PLAN_OPTIONS = [
  { value: "individual", label: "Individual" },
  { value: "band_10", label: "Banda 10" },
  { value: "band_20", label: "Banda 20" },
];

const EMPTY_SALE = {
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
};

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function roleLabel(role: string): string {
  if (role === "salesperson") return "Vendedor";
  return "Admin completo";
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function App() {
  const [token, setToken] = useState(getAdminToken);
  const [admin, setAdmin] = useState<AdminProfile | null>(getStoredAdmin);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [users, setUsers] = useState<Array<Record<string, unknown>>>([]);
  const [bands, setBands] = useState<Array<Record<string, unknown>>>([]);
  const [invoices, setInvoices] = useState<Array<Record<string, unknown>>>([]);
  const [admins, setAdmins] = useState<Array<Record<string, unknown>>>([]);
  const [settings, setSettings] = useState<AsaasSettings | null>(null);
  const [asaasKey, setAsaasKey] = useState("");
  const [asaasEnv, setAsaasEnv] = useState<"sandbox" | "production">("sandbox");
  const [asaasWebhook, setAsaasWebhook] = useState("");
  const [marketingSubject, setMarketingSubject] = useState("");
  const [marketingBody, setMarketingBody] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [saleForm, setSaleForm] = useState(EMPTY_SALE);
  const [saleBusy, setSaleBusy] = useState(false);
  const [adminForm, setAdminForm] = useState({
    email: "",
    full_name: "",
    password: "",
    role: "salesperson" as AdminRole,
  });
  const [paymentBusyId, setPaymentBusyId] = useState<string | null>(null);

  const fullAdmin = isFullAdmin(admin);

  const tabs = useMemo(() => {
    const items: Array<{ id: Tab; label: string }> = [
      { id: "dashboard", label: "Dashboard" },
      { id: "sales", label: "Vendas" },
      { id: "users", label: "Usuários" },
      { id: "bands", label: "Bandas" },
      { id: "invoices", label: "Faturas" },
    ];
    if (fullAdmin) {
      items.push(
        { id: "admins", label: "Admins" },
        { id: "settings", label: "Parametrização" },
        { id: "marketing", label: "Marketing" },
      );
    }
    return items;
  }, [fullAdmin]);

  useEffect(() => {
    if (!token) return;
    void fetchAdminMe()
      .then((profile) => setAdmin(profile))
      .catch(() => {
        if (!getAdminToken()) {
          setToken(null);
          setAdmin(null);
        }
      });
  }, [token]);

  useEffect(() => {
    if (!token) return;
    if (!fullAdmin && (tab === "admins" || tab === "settings" || tab === "marketing")) {
      setTab("dashboard");
    }
  }, [token, fullAdmin, tab]);

  useEffect(() => {
    if (!token) return;
    if (tab === "dashboard" || tab === "marketing" || tab === "sales") return;
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
        const [invoicePayload, bandPayload] = await Promise.all([
          fetchAdminInvoices(),
          fetchAdminBands(),
        ]);
        setInvoices(invoicePayload.items ?? []);
        setBands(bandPayload.items ?? []);
      } else if (tab === "admins") {
        const payload = await fetchAdmins();
        setAdmins(payload.items ?? []);
      } else if (tab === "settings") {
        const payload = await fetchAsaasSettings();
        setSettings(payload);
        setAsaasEnv((payload.asaas_environment as "sandbox" | "production") || "sandbox");
      }
    } catch (err) {
      if (!getAdminToken()) {
        setToken(null);
        setAdmin(null);
      }
      setError(err instanceof Error ? err.message : "Erro ao carregar dados");
    }
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const profile = await adminLogin(email, password);
      setAdmin(profile);
      setToken(getAdminToken());
      setTab("dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login");
    }
  }

  function logout() {
    clearAdminToken();
    setToken(null);
    setAdmin(null);
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

  async function handleSaleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaleBusy(true);
    try {
      const payload: Record<string, unknown> = { ...saleForm };
      if (!String(payload.password || "").trim()) {
        delete payload.password;
      }
      if (!String(payload.address_complement || "").trim()) {
        payload.address_complement = null;
      }
      const result = await registerSale(payload);
      const temp = result.temporary_password ? ` Senha temporária: ${result.temporary_password}` : "";
      setStatus(`Venda cadastrada: ${result.user?.email} · banda ${result.band?.name}.${temp}`);
      setSaleForm(EMPTY_SALE);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao cadastrar venda");
    } finally {
      setSaleBusy(false);
    }
  }

  async function handleCreateAdmin(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await createAdmin(adminForm);
      setStatus(`Admin ${adminForm.email} criado`);
      setAdminForm({ email: "", full_name: "", password: "", role: "salesperson" });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar admin");
    }
  }

  async function handlePaymentLink(invoiceId: string) {
    setError(null);
    setPaymentBusyId(invoiceId);
    try {
      const result = await generateInvoicePaymentLink(invoiceId);
      const url = result.invoice_url;
      if (!url) {
        setStatus("Link gerado, mas URL não retornada");
        return;
      }
      const copied = await copyText(url);
      setStatus(copied ? "Link de pagamento copiado" : `Link: ${url}`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao gerar link");
    } finally {
      setPaymentBusyId(null);
    }
  }

  if (!token) {
    return (
      <main className="page">
        <h1>SoftMusic Admin</h1>
        <form onSubmit={handleLogin} className="card">
          <label htmlFor="admin-email">
            E-mail
            <input
              id="admin-email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
            />
          </label>
          <label htmlFor="admin-password">
            Senha
            <input
              id="admin-password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit">Entrar</button>
        </form>
        <AppFooter />
      </main>
    );
  }

  return (
    <main className="page">
      <header className="header">
        <div>
          <h1>SoftMusic Admin</h1>
          {admin ? (
            <p className="muted small">
              {admin.full_name} · {roleLabel(admin.role)}
            </p>
          ) : null}
        </div>
        <div className="header-actions">
          {fullAdmin ? (
            <button
              type="button"
              onClick={() =>
                void suspendOverdueAccounts().then((r) => setStatus(`Robô: ${JSON.stringify(r)}`))
              }
            >
              Rodar robô billing
            </button>
          ) : null}
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

      {tab === "sales" ? (
        <section className="card">
          <h2>Nova venda</h2>
          <p className="muted">Cadastra usuário do app + banda com ownership do vendedor.</p>
          <form onSubmit={(e) => void handleSaleSubmit(e)} className="stack sale-form">
            <div className="form-grid">
              <label>
                Nome completo
                <input
                  required
                  value={saleForm.full_name}
                  onChange={(e) => setSaleForm({ ...saleForm, full_name: e.target.value })}
                />
              </label>
              <label>
                CPF
                <input
                  required
                  value={saleForm.cpf}
                  onChange={(e) => setSaleForm({ ...saleForm, cpf: e.target.value })}
                />
              </label>
              <label>
                Data de nascimento
                <input
                  required
                  type="date"
                  value={saleForm.birth_date}
                  onChange={(e) => setSaleForm({ ...saleForm, birth_date: e.target.value })}
                />
              </label>
              <label>
                E-mail
                <input
                  required
                  type="email"
                  value={saleForm.email}
                  onChange={(e) => setSaleForm({ ...saleForm, email: e.target.value })}
                />
              </label>
              <label>
                Telefone
                <input
                  required
                  value={saleForm.phone}
                  onChange={(e) => setSaleForm({ ...saleForm, phone: e.target.value })}
                />
              </label>
              <label>
                Senha temporária (opcional)
                <input
                  type="password"
                  minLength={8}
                  value={saleForm.password}
                  onChange={(e) => setSaleForm({ ...saleForm, password: e.target.value })}
                  placeholder="Gerada automaticamente se vazia"
                />
              </label>
              <label>
                Nome da banda
                <input
                  required
                  value={saleForm.band_name}
                  onChange={(e) => setSaleForm({ ...saleForm, band_name: e.target.value })}
                />
              </label>
              <label>
                Plano
                <select
                  value={saleForm.plan_code}
                  onChange={(e) => setSaleForm({ ...saleForm, plan_code: e.target.value })}
                >
                  {PLAN_OPTIONS.map((plan) => (
                    <option key={plan.value} value={plan.value}>
                      {plan.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                CEP
                <input
                  required
                  value={saleForm.address_zip}
                  onChange={(e) => setSaleForm({ ...saleForm, address_zip: e.target.value })}
                />
              </label>
              <label>
                Rua
                <input
                  required
                  value={saleForm.address_street}
                  onChange={(e) => setSaleForm({ ...saleForm, address_street: e.target.value })}
                />
              </label>
              <label>
                Número
                <input
                  required
                  value={saleForm.address_number}
                  onChange={(e) => setSaleForm({ ...saleForm, address_number: e.target.value })}
                />
              </label>
              <label>
                Complemento
                <input
                  value={saleForm.address_complement}
                  onChange={(e) => setSaleForm({ ...saleForm, address_complement: e.target.value })}
                />
              </label>
              <label>
                Bairro
                <input
                  required
                  value={saleForm.address_neighborhood}
                  onChange={(e) => setSaleForm({ ...saleForm, address_neighborhood: e.target.value })}
                />
              </label>
              <label>
                Cidade
                <input
                  required
                  value={saleForm.address_city}
                  onChange={(e) => setSaleForm({ ...saleForm, address_city: e.target.value })}
                />
              </label>
              <label>
                UF
                <input
                  required
                  maxLength={2}
                  value={saleForm.address_state}
                  onChange={(e) => setSaleForm({ ...saleForm, address_state: e.target.value })}
                />
              </label>
            </div>
            <button type="submit" disabled={saleBusy}>
              {saleBusy ? "Cadastrando..." : "Cadastrar venda"}
            </button>
          </form>
        </section>
      ) : null}

      {tab === "users" ? (
        <section className="card">
          <h2>{fullAdmin ? "Usuários" : "Meus clientes"}</h2>
          <ul className="band-list">
            {users.map((user) => (
              <li key={String(user.id)}>
                <div>
                  <strong>{String(user.full_name)}</strong>
                  <span>
                    {String(user.email)} · {String(user.status)}
                    {user.is_delinquent ? " · inadimplente" : ""}
                  </span>
                </div>
                {user.is_delinquent ? <span className="badge danger">Inadimplente</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "bands" ? (
        <section className="card">
          <h2>{fullAdmin ? "Bandas" : "Minhas bandas"}</h2>
          <ul className="band-list">
            {bands.map((band) => (
              <li key={String(band.id)}>
                <div>
                  <strong>{String(band.name)}</strong>
                  <span>
                    {String(band.plan_code)} · {String(band.status)}
                    {band.billing_exempt ? " · isenta" : ""}
                    {band.is_delinquent ? " · inadimplente" : ""}
                  </span>
                </div>
                <div className="actions">
                  {band.is_delinquent ? <span className="badge danger">Inadimplente</span> : null}
                  {fullAdmin ? (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          void setBandExempt(String(band.id), !band.billing_exempt, "Ajuste manual").then(
                            loadData,
                          )
                        }
                      >
                        {band.billing_exempt ? "Remover isenção" : "Isentar"}
                      </button>
                      <button type="button" onClick={() => void suspendBand(String(band.id)).then(loadData)}>
                        Suspender
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "invoices" ? (
        <section className="card">
          <h2>{fullAdmin ? "Faturas (todas as bandas)" : "Minhas faturas"}</h2>
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
                  <th>Pagamento</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => {
                  const invoiceId = String(invoice.id);
                  const isOverdue = String(invoice.status) === "overdue";
                  return (
                    <tr key={invoiceId}>
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
                      <td>
                        {STATUS_LABEL[String(invoice.status)] ?? String(invoice.status)}
                        {isOverdue || invoice.is_delinquent ? (
                          <span className="badge danger">Inadimplente</span>
                        ) : null}
                      </td>
                      <td>
                        <ul className="compact-list">
                          {((invoice.line_items as Array<Record<string, unknown>>) ?? []).map((line, idx) => (
                            <li key={`${invoiceId}-${idx}`}>
                              {String(line.description)} — {formatBrl(Number(line.amount_cents ?? 0))}
                              {fullAdmin &&
                              !bands.find((b) => b.id === line.band_id && b.billing_exempt) ? (
                                <button
                                  type="button"
                                  className="linkish"
                                  onClick={() =>
                                    void setBandExempt(
                                      String(line.band_id),
                                      true,
                                      "Isenção via faturas",
                                    ).then(loadData)
                                  }
                                >
                                  Isentar banda
                                </button>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td>
                        <button
                          type="button"
                          disabled={paymentBusyId === invoiceId}
                          onClick={() => void handlePaymentLink(invoiceId)}
                        >
                          {paymentBusyId === invoiceId
                            ? "Gerando..."
                            : invoice.has_asaas_link
                              ? "Copiar link"
                              : "Gerar link"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === "admins" && fullAdmin ? (
        <section className="card">
          <h2>Admins</h2>
          <form onSubmit={(e) => void handleCreateAdmin(e)} className="stack form-grid">
            <label>
              Nome
              <input
                required
                value={adminForm.full_name}
                onChange={(e) => setAdminForm({ ...adminForm, full_name: e.target.value })}
              />
            </label>
            <label>
              E-mail
              <input
                required
                type="email"
                value={adminForm.email}
                onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })}
              />
            </label>
            <label>
              Senha
              <input
                required
                type="password"
                minLength={8}
                value={adminForm.password}
                onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
              />
            </label>
            <label>
              Role
              <select
                value={adminForm.role}
                onChange={(e) => setAdminForm({ ...adminForm, role: e.target.value as AdminRole })}
              >
                <option value="full_admin">Admin completo</option>
                <option value="salesperson">Vendedor</option>
              </select>
            </label>
            <button type="submit">Criar admin</button>
          </form>

          <ul className="band-list" style={{ marginTop: "1.5rem" }}>
            {admins.map((item) => {
              const id = String(item.id);
              const active = String(item.status) === "active";
              return (
                <li key={id}>
                  <div>
                    <strong>{String(item.full_name)}</strong>
                    <span>
                      {String(item.email)} · {roleLabel(String(item.role))} · {String(item.status)}
                    </span>
                  </div>
                  <div className="actions">
                    <button
                      type="button"
                      onClick={() =>
                        void updateAdmin(id, { status: active ? "inactive" : "active" })
                          .then(() => {
                            setStatus(active ? "Admin desativado" : "Admin ativado");
                            return loadData();
                          })
                          .catch((err) => setError(err instanceof Error ? err.message : "Falha"))
                      }
                    >
                      {active ? "Desativar" : "Ativar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = window.prompt("Nova senha (mín. 8 caracteres)");
                        if (!next || next.length < 8) return;
                        void resetAdminPassword(id, next)
                          .then(() => setStatus("Senha redefinida"))
                          .catch((err) => setError(err instanceof Error ? err.message : "Falha"));
                      }}
                    >
                      Reset senha
                    </button>
                    <select
                      value={String(item.role)}
                      onChange={(e) =>
                        void updateAdmin(id, { role: e.target.value as AdminRole })
                          .then(() => {
                            setStatus("Role atualizada");
                            return loadData();
                          })
                          .catch((err) => setError(err instanceof Error ? err.message : "Falha"))
                      }
                    >
                      <option value="full_admin">Admin completo</option>
                      <option value="salesperson">Vendedor</option>
                    </select>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {tab === "settings" && fullAdmin ? (
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
          {settings?.asaas_webhook_url ? (
            <div className="webhook-url-box">
              <div className="webhook-url-label">URL do webhook (cadastrar na Asaas)</div>
              <div className="webhook-url-row">
                <code className="webhook-url">{settings.asaas_webhook_url}</code>
                <button
                  type="button"
                  className="webhook-copy-btn"
                  onClick={() => {
                    void copyText(settings.asaas_webhook_url).then((ok) =>
                      setStatus(ok ? "URL do webhook copiada" : "Não foi possível copiar a URL"),
                    );
                  }}
                >
                  Copiar
                </button>
              </div>
              <p className="muted small">
                Em Integrações → Webhooks na Asaas, use esta URL e o mesmo token do campo abaixo no header{" "}
                <code>asaas-access-token</code>.
              </p>
            </div>
          ) : null}
          <form onSubmit={(e) => void saveSettings(e)} className="stack">
            <label htmlFor="asaas-api-key">
              Token Asaas (API key)
              <input
                id="asaas-api-key"
                name="asaas_api_key"
                value={asaasKey}
                onChange={(e) => setAsaasKey(e.target.value)}
                placeholder="Cole o novo token para substituir"
                autoComplete="off"
              />
            </label>
            <label htmlFor="asaas-env">
              Ambiente
              <select
                id="asaas-env"
                name="asaas_env"
                value={asaasEnv}
                onChange={(e) => setAsaasEnv(e.target.value as "sandbox" | "production")}
              >
                <option value="sandbox">Sandbox</option>
                <option value="production">Produção</option>
              </select>
            </label>
            <label htmlFor="asaas-webhook-token">
              Token do webhook (asaas-access-token)
              <input
                id="asaas-webhook-token"
                name="asaas_webhook_token"
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

      {tab === "marketing" && fullAdmin ? (
        <section className="card">
          <h2>Campanha de e-mail</h2>
          <label htmlFor="marketing-subject">
            Assunto
            <input
              id="marketing-subject"
              name="marketing_subject"
              value={marketingSubject}
              onChange={(e) => setMarketingSubject(e.target.value)}
            />
          </label>
          <label htmlFor="marketing-body">
            Corpo
            <textarea
              id="marketing-body"
              name="marketing_body"
              rows={8}
              value={marketingBody}
              onChange={(e) => setMarketingBody(e.target.value)}
            />
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

      <AppFooter />
    </main>
  );
}
