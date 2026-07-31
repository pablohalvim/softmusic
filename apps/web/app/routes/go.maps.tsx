import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router";

import { linkClass } from "../lib/ui-classes";

function parseCoord(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return value;
}

export default function GoMapsRedirectPage() {
  const [searchParams] = useSearchParams();
  const lat = parseCoord(searchParams.get("lat"));
  const lng = parseCoord(searchParams.get("lng"));

  const mapsUrl = useMemo(() => {
    if (lat == null || lng == null) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }, [lat, lng]);

  useEffect(() => {
    if (!mapsUrl) return;
    window.location.replace(mapsUrl);
  }, [mapsUrl]);

  if (!mapsUrl) {
    return (
      <section className="space-y-3">
        <h1 className="sm-page-title">Link de rota inválido</h1>
        <p className="sm-page-subtitle">Não foi possível abrir o mapa com os parâmetros informados.</p>
        <Link to="/" className={linkClass}>
          Voltar ao SoftMusic
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h1 className="sm-page-title">Abrindo rota…</h1>
      <p className="sm-page-subtitle">
        Se o redirecionamento não acontecer,{" "}
        <a href={mapsUrl} className={linkClass}>
          clique aqui
        </a>
        .
      </p>
    </section>
  );
}
