import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation } from "react-router";

import { AuthGuard } from "./components/AuthGuard";
import { BandSelector } from "./components/BandSelector";
import { InstallButton } from "./components/InstallButton";
import { PwaUpdateToast } from "./components/PwaUpdateToast";
import { AuthProvider, useAuth } from "./lib/auth-context";
import { BandProvider } from "./lib/band-context";
import "./app.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#020806" />
        <meta name="color-scheme" content="dark" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" type="image/svg+xml" href="/icon.svg" />
        <link rel="apple-touch-icon" href="/icon.svg" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="SoftMusic" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <PwaUpdateToast />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const { pathname } = useLocation();
  const active = pathname === to || (to !== "/" && pathname.startsWith(to));
  return (
    <Link to={to} className={active ? "nav-link-active font-medium" : "nav-link"}>
      {children}
    </Link>
  );
}

function AppHeader() {
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-40 -mx-4 mb-8 border-b border-white/[0.06] bg-[#020806]/80 px-4 py-4 backdrop-blur-xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link to="/" className="group flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-green-400 to-green-600 text-sm font-bold text-green-950 shadow-lg shadow-green-500/20">
            S
          </span>
          <span className="text-lg font-semibold tracking-tight text-slate-50 transition group-hover:text-green-300">
            SoftMusic
          </span>
        </Link>
        <div className="flex flex-wrap items-center gap-3 text-sm md:gap-4">
          {user ? (
            <>
              <BandSelector />
              <NavLink to="/dashboard">Dashboard</NavLink>
              <NavLink to="/library">Biblioteca</NavLink>
              <NavLink to="/analyze">Analisar</NavLink>
              <NavLink to="/bandas">Bandas</NavLink>
              <NavLink to="/faturas">Faturas</NavLink>
              <button type="button" onClick={() => void logout()} className="nav-link">
                Sair
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login">Entrar</NavLink>
              <Link to="/cadastro" className="sm-btn-primary px-3 py-1.5 text-xs">
                Cadastro
              </Link>
            </>
          )}
          <InstallButton className="sm-btn-ghost px-3 py-1.5 text-xs" />
        </div>
      </div>
    </header>
  );
}

function AppShell() {
  return (
    <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6">
      <div
        className="pointer-events-none fixed inset-0 -z-10 opacity-40"
        aria-hidden
        style={{
          background:
            "radial-gradient(circle at 20% 30%, rgba(34,197,94,0.08) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(239,68,68,0.05) 0%, transparent 40%)",
        }}
      />
      <AppHeader />
      <main className="min-w-0 flex-1 overflow-x-hidden">
        <AuthGuard>
          <Outlet />
        </AuthGuard>
      </main>
    </div>
  );
}

export default function App() {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BandProvider>
          <AppShell />
        </BandProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
