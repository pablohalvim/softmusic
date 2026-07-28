import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link } from "react-router";

import { fetchBandMembers } from "../lib/api";
import { useBand } from "../lib/band-context";
import { linkClass } from "../lib/ui-classes";

type TabId = "funcoes" | "membros" | "agenda" | "plano";

export function BandManageChrome({
  bandId,
  activeTab,
  children,
}: {
  bandId: string;
  activeTab: TabId;
  children: React.ReactNode;
}) {
  const { bands, loading, patchBand } = useBand();
  const band = bands.find((item) => item.id === bandId) ?? null;
  const membersQuery = useQuery({
    queryKey: ["band-members", bandId],
    queryFn: () => fetchBandMembers(bandId),
    enabled: Boolean(bandId),
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!bandId || !membersQuery.data) return;
    const count = membersQuery.data.length;
    if (band && band.member_count !== count) {
      patchBand(bandId, { member_count: count });
    }
  }, [band, bandId, membersQuery.data, patchBand]);

  if (loading && !band) {
    return <p className="text-slate-400">Carregando...</p>;
  }
  if (!band) {
    return (
      <section className="space-y-4">
        <h1 className="sm-page-title">Banda não encontrada</h1>
        <Link to="/bandas" className={linkClass}>
          Voltar para bandas
        </Link>
      </section>
    );
  }

  const memberCount = membersQuery.data?.length ?? band.member_count;

  const tabs: Array<{ id: TabId; label: string; to: string }> = [
    { id: "funcoes", label: "Funções", to: `/bandas/${bandId}?tab=funcoes` },
    { id: "membros", label: "Gestão de Usuários", to: `/bandas/${bandId}?tab=membros` },
    { id: "agenda", label: "Agenda", to: `/bandas/${bandId}?tab=agenda` },
  ];
  if (!band.billing_exempt) {
    tabs.push({ id: "plano", label: "Alterar Plano", to: `/bandas/${bandId}?tab=plano` });
  }

  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm text-slate-400">
          <Link to="/bandas" className={linkClass}>
            Bandas
          </Link>{" "}
          / Gerenciar
        </p>
        <h1 className="sm-page-title">{band.name}</h1>
        <p className="sm-page-subtitle">
          {band.plan_code} · {memberCount}/{band.member_limit} membros
        </p>
      </div>

      <nav
        className="flex gap-1 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-1"
        aria-label="Seções da banda"
      >
        {tabs.map((item) => {
          const active = activeTab === item.id;
          return (
            <Link
              key={item.id}
              to={item.to}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${
                active
                  ? "bg-green-500/20 font-medium text-green-200"
                  : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </section>
  );
}

export function useCanManageBand(bandId: string): boolean {
  const { bands } = useBand();
  const band = bands.find((item) => item.id === bandId);
  return Boolean(band?.can_manage_members || band?.is_owner);
}
