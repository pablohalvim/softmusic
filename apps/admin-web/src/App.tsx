import { useEffect, useState } from "react";

import {
  adminLogin,
  clearAdminToken,
  fetchAdminBands,
  fetchAdminUsers,
  getAdminToken,
  sendMarketing,
  setBandExempt,
  suspendBand,
  suspendOverdueAccounts,
} from "./lib/api";
import { AdminDashboard } from "./components/AdminDashboard";

type Tab = "dashboard" | "users" | "bands" | "marketing";

export function App() {
  const [token, setToken] = useState(getAdminToken);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [users, setUsers] = useState<Array<Record<string, unknown>>>([]);
  const [bands, setBands] = useState<Array<Record<string, unknown>>>([]);
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

  return (
    <main className="page">
      <header className="header">
        <h1>SoftMusic Admin</h1>
        <div className="header-actions">
          <button type="button" onClick={() => void suspendOverdueAccounts().then((r) => setStatus(`Suspensas: ${r.suspended}`))}>
            Suspender inadimplentes
          </button>
          <button type="button" onClick={logout}>
            Sair
          </button>
        </div>
      </header>

      <nav className="tabs">
        {(["dashboard", "bands", "users", "marketing"] as Tab[]).map((item) => (
          <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
            {item === "dashboard"
              ? "Dashboard"
              : item === "bands"
                ? "Bandas"
                : item === "users"
                  ? "Usuários"
                  : "Marketing"}
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
