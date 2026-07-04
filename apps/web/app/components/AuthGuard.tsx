import { Navigate, useLocation } from "react-router";

import { useAuth } from "../lib/auth-context";
import { useBand } from "../lib/band-context";

const PUBLIC_PATHS = new Set(["/login", "/cadastro", "/convite"]);

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { bands, loading: bandLoading } = useBand();
  const location = useLocation();

  if (authLoading || (user && bandLoading)) {
    return <p className="text-slate-400">Carregando...</p>;
  }

  if (!user && !PUBLIC_PATHS.has(location.pathname)) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (
    user &&
    !bandLoading &&
    !PUBLIC_PATHS.has(location.pathname) &&
    location.pathname !== "/bandas" &&
    location.pathname !== "/faturas" &&
    bands.length === 0
  ) {
    return <Navigate to="/bandas" replace />;
  }

  if (user && PUBLIC_PATHS.has(location.pathname)) {
    return <Navigate to="/library" replace />;
  }

  return <>{children}</>;
}
