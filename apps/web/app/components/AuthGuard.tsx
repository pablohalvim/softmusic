import { Navigate, useLocation } from "react-router";

import { useAuth } from "../lib/auth-context";
import { useBand } from "../lib/band-context";

/** Rotas acessíveis sem login */
const PUBLIC_PATHS = new Set(["/login", "/cadastro", "/convite"]);
/** Rotas só para visitante — logado é redirecionado para a Home */
const GUEST_ONLY_PATHS = new Set(["/login", "/cadastro"]);

function isAllowedWithoutBand(path: string): boolean {
  return (
    path === "/" ||
    path === "/dashboard" ||
    path === "/bandas" ||
    path === "/convite" ||
    path === "/faturas" ||
    path.startsWith("/bandas/") ||
    path.startsWith("/login") ||
    path.startsWith("/cadastro")
  );
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { bands, loading: bandLoading } = useBand();
  const location = useLocation();
  const path = location.pathname;

  if (authLoading || (user && bandLoading)) {
    return <p className="text-slate-400">Carregando...</p>;
  }

  if (!user && !PUBLIC_PATHS.has(path)) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  // Logado em /login|/cadastro → Home SEMPRE (antes de qualquer checagem de banda).
  // Antes, com bands=[] no meio do refresh, caía em /bandas e “comia” o destino Home.
  if (user && GUEST_ONLY_PATHS.has(path)) {
    const params = new URLSearchParams(location.search);
    const next = params.get("next");
    const target =
      next && next.startsWith("/") && !next.startsWith("//") && next !== "/bandas"
        ? next
        : "/";
    return <Navigate to={target} replace />;
  }

  // Sem banda: só bloqueia rotas que realmente precisam de banda ativa.
  const ownsBand = bands.some((band) => band.is_owner);
  if (user && !bandLoading && bands.length === 0 && !isAllowedWithoutBand(path)) {
    return <Navigate to="/bandas" replace />;
  }

  // Faturas só para quem é dono de pelo menos uma banda.
  if (user && !bandLoading && path === "/faturas" && !ownsBand) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
