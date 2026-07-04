import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

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
        <meta name="theme-color" content="#0f172a" />
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
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        {children}
        <PwaUpdateToast />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function AppHeader() {
  const { user, logout } = useAuth();

  return (
    <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
      <Link to="/" className="text-xl font-semibold tracking-tight">
        SoftMusic
      </Link>
      <div className="flex flex-wrap items-center gap-4 text-sm text-slate-300">
        {user ? (
          <>
            <BandSelector />
            <Link to="/dashboard" className="hover:text-white">
              Dashboard
            </Link>
            <Link to="/library" className="hover:text-white">
              Biblioteca
            </Link>
            <Link to="/analyze" className="hover:text-white">
              Analisar
            </Link>
            <Link to="/bandas" className="hover:text-white">
              Bandas
            </Link>
            <Link to="/faturas" className="hover:text-white">
              Faturas
            </Link>
            <button type="button" onClick={() => void logout()} className="hover:text-white">
              Sair
            </button>
          </>
        ) : (
          <>
            <Link to="/login" className="hover:text-white">
              Entrar
            </Link>
            <Link to="/cadastro" className="hover:text-white">
              Cadastro
            </Link>
          </>
        )}
        <InstallButton className="inline-flex items-center gap-2 rounded-lg border border-indigo-500/50 bg-indigo-500/10 px-3 py-1.5 text-sm font-medium text-indigo-100 transition-colors hover:border-indigo-400 hover:bg-indigo-500/20 hover:text-white" />
      </div>
    </header>
  );
}

function AppShell() {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6">
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
