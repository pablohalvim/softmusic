import { formatAppFooter } from "@softmusic/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { Link, Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation } from "react-router";

import { AuthGuard } from "./components/AuthGuard";
import { BandSelector } from "./components/BandSelector";
import { BlockedBandsGate } from "./components/BlockedBandsGate";
import { InstallButton } from "./components/InstallButton";
import { PwaUpdateToast } from "./components/PwaUpdateToast";
import { AuthProvider, useAuth } from "./lib/auth-context";
import { BandProvider, useBand } from "./lib/band-context";
import { ConfirmProvider } from "./lib/confirm";
import { ToastProvider } from "./lib/toast";
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

function NavLink({
  to,
  children,
  onNavigate,
}: {
  to: string;
  children: React.ReactNode;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const active = pathname === to || (to !== "/" && pathname.startsWith(to));
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={active ? "nav-link-active font-medium" : "nav-link"}
    >
      {children}
    </Link>
  );
}

function AppHeader() {
  const { user, logout } = useAuth();
  const { bands } = useBand();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const showBilling = bands.some((band) => band.is_owner);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="sticky top-0 z-40 -mx-4 mb-6 border-b border-white/[0.06] bg-[#020806]/90 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 backdrop-blur-xl sm:mb-8 sm:pt-[calc(1rem+env(safe-area-inset-top))] sm:pb-4">
      <div className="flex items-center justify-between gap-3">
        <Link to="/" className="group flex min-w-0 items-center gap-2" onClick={closeMenu}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-green-400 to-green-600 text-sm font-bold text-green-950 shadow-lg shadow-green-500/20">
            S
          </span>
          <span className="truncate text-lg font-semibold tracking-tight text-slate-50 transition group-hover:text-green-300">
            SoftMusic
          </span>
        </Link>

        {/* Desktop */}
        <nav className="hidden items-center gap-3 text-sm md:flex md:gap-4">
          {user ? (
            <>
              <BandSelector />
              <NavLink to="/dashboard">Dashboard</NavLink>
              <NavLink to="/agenda">Agenda</NavLink>
              <NavLink to="/library">Biblioteca</NavLink>
              <NavLink to="/bandas">Bandas</NavLink>
              {showBilling ? <NavLink to="/faturas">Faturas</NavLink> : null}
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
        </nav>

        {/* Mobile controls */}
        <div className="flex items-center gap-2 md:hidden">
          {user ? <BandSelector /> : null}
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-200"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="sr-only">Menu</span>
            {menuOpen ? (
              <span aria-hidden className="text-lg leading-none">
                ×
              </span>
            ) : (
              <span className="flex flex-col gap-1.5" aria-hidden>
                <span className="block h-0.5 w-5 bg-current" />
                <span className="block h-0.5 w-5 bg-current" />
                <span className="block h-0.5 w-5 bg-current" />
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Mobile panel */}
      {menuOpen ? (
        <nav
          id={menuId}
          className="mt-3 flex flex-col gap-1 border-t border-white/[0.06] pt-3 text-sm md:hidden"
        >
          {user ? (
            <>
              <NavLink to="/dashboard" onNavigate={closeMenu}>
                Dashboard
              </NavLink>
              <NavLink to="/agenda" onNavigate={closeMenu}>
                Agenda
              </NavLink>
              <NavLink to="/library" onNavigate={closeMenu}>
                Biblioteca
              </NavLink>
              <NavLink to="/bandas" onNavigate={closeMenu}>
                Bandas
              </NavLink>
              {showBilling ? (
                <NavLink to="/faturas" onNavigate={closeMenu}>
                  Faturas
                </NavLink>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  closeMenu();
                  void logout();
                }}
                className="nav-link py-2 text-left"
              >
                Sair
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login" onNavigate={closeMenu}>
                Entrar
              </NavLink>
              <Link
                to="/cadastro"
                onClick={closeMenu}
                className="sm-btn-primary mt-1 px-3 py-2 text-center text-xs"
              >
                Cadastro
              </Link>
            </>
          )}
          <div className="pt-2">
            <InstallButton className="sm-btn-ghost w-full px-3 py-2 text-xs" />
          </div>
        </nav>
      ) : null}
    </header>
  );
}

function AppFooter() {
  return (
    <footer className="mt-8 border-t border-white/[0.06] pt-4 text-center text-xs text-slate-500">
      {formatAppFooter()}
    </footer>
  );
}

function AppShell() {
  return (
    <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-4 pt-0 sm:pb-6">
      <div
        className="pointer-events-none fixed inset-0 -z-10 opacity-40"
        aria-hidden
        style={{
          background:
            "radial-gradient(circle at 20% 30%, rgba(34,197,94,0.08) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(239,68,68,0.05) 0%, transparent 40%)",
        }}
      />
      <AppHeader />
      <main className="min-w-0 flex-1 overflow-x-hidden pb-[env(safe-area-inset-bottom)]">
        <AuthGuard>
          <BlockedBandsGate />
          <Outlet />
        </AuthGuard>
      </main>
      <AppFooter />
    </div>
  );
}

export default function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: true,
            refetchOnMount: "always",
            staleTime: 0,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <BandProvider>
              <AppShell />
            </BandProvider>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
