import { Navigate, useLocation } from "react-router";

import { useAuth } from "../lib/auth-context";
import { useBand } from "../lib/band-context";

/** Rotas acessíveis sem login */
const PUBLIC_PATHS = new Set(["/login", "/cadastro", "/convite"]);
/** Rotas só para visitante — logado é redirecionado */
const GUEST_ONLY_PATHS = new Set(["/login", "/cadastro"]);

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { bands, loading: bandLoading } = useBand();
  const location = useLocation();

  if (authLoading || (user && bandLoading)) {
    return <p className="text-slate-400">Carregando...</p>;
  }

  if (!user && !PUBLIC_PATHS.has(location.pathname)) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  // Sem banda ainda: permite home/dashboard (convites) e gestão de conta.
  const path = location.pathname;
  const ownsBand = bands.some((band) => band.is_owner);
  const allowedWithoutBand =
    path === "/" ||
    path === "/dashboard" ||
    path === "/bandas" ||
    path === "/convite" ||
    path.startsWith("/bandas/");
  if (user && !bandLoading && bands.length === 0 && !allowedWithoutBand) {
    return <Navigate to="/bandas" replace />;
  }

  // Faturas só para quem é dono de pelo menos uma banda.
  if (user && !bandLoading && path === "/faturas" && !ownsBand) {
    return <Navigate to="/bandas" replace />;
  }

  if (user && GUEST_ONLY_PATHS.has(location.pathname)) {
    const params = new URLSearchParams(location.search);
    const next = params.get("next");
    const fromState = (location.state as { from?: string } | null)?.from;
    const target = next || fromState || "/";
    return <Navigate to={target} replace />;
  }

  return <>{children}</>;
}
