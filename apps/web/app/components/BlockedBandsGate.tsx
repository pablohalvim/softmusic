import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";

import { authFetch } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useBand } from "../lib/band-context";
import { btnPrimary, panelClass } from "../lib/ui-classes";

interface BillingStatus {
  blocked_bands: Array<{ id: string; name: string }>;
}

const SEEN_KEY = "softmusic:blocked-bands-seen";

export function BlockedBandsGate() {
  const { user } = useAuth();
  const { bands } = useBand();
  const ownsBand = bands.some((b) => b.is_owner);
  const [open, setOpen] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["billing-status"],
    enabled: Boolean(user && ownsBand),
    queryFn: async () => {
      const response = await authFetch("/billing/status");
      if (!response.ok) throw new Error("status");
      return response.json() as Promise<BillingStatus>;
    },
  });

  const blocked = statusQuery.data?.blocked_bands ?? [];

  useEffect(() => {
    if (!ownsBand || blocked.length === 0) return;
    const signature = blocked.map((b) => b.id).sort().join(",");
    const seen = sessionStorage.getItem(SEEN_KEY);
    if (seen !== signature) {
      setOpen(true);
      sessionStorage.setItem(SEEN_KEY, signature);
    }
  }, [ownsBand, blocked]);

  if (!open || blocked.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 p-4 backdrop-blur-sm sm:items-center">
      <div className={`${panelClass} w-full max-w-lg space-y-4 border-amber-400/30 p-5`}>
        <h2 className="text-lg font-semibold text-amber-100">Bandas bloqueadas</h2>
        <p className="text-sm text-slate-300">
          Enquanto o pagamento não for efetuado, ninguém associado às bandas abaixo conseguirá ver
          músicas e cifras.
        </p>
        <ul className="space-y-1 text-sm text-slate-200">
          {blocked.map((band) => (
            <li key={band.id}>• {band.name}</li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="sm-btn-ghost" onClick={() => setOpen(false)}>
            Fechar
          </button>
          <Link to="/faturas" className={btnPrimary} onClick={() => setOpen(false)}>
            Ir para faturas
          </Link>
        </div>
      </div>
    </div>
  );
}
