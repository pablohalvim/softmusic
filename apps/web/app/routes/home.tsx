import { Link } from "react-router";

import { PendingInvitesCard } from "../components/PendingInvitesCard";
import { UpcomingScheduleCards } from "../components/UpcomingScheduleCards";
import { useAuth } from "../lib/auth-context";
import { btnAccent, btnGhost, btnPrimary } from "../lib/ui-classes";

export default function Home() {
  const { user } = useAuth();

  return (
    <section className="space-y-6">
      {user ? <PendingInvitesCard /> : null}
      {user ? <UpcomingScheduleCards /> : null}

      <div className="glass-panel relative overflow-hidden p-6 sm:p-8 md:p-10">
        <div
          className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-green-500/10 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-red-500/10 blur-3xl"
          aria-hidden
        />
        <p className="text-sm uppercase tracking-[0.25em] text-green-400">Music Intelligence Platform</p>
        <h1 className="mt-3 max-w-2xl text-3xl font-bold leading-tight text-slate-50 sm:text-4xl md:text-5xl">
          Análise musical profissional com IA
        </h1>
        <p className="mt-4 max-w-2xl text-sm text-slate-300 sm:text-base">
          Harmonia, ritmo, estrutura, instrumentação e explicações educacionais — tudo em JSON
          versionado, pronto para produção.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {user ? (
            <>
              <Link to="/analyze" className={`${btnAccent} text-center`}>
                Analisar música
              </Link>
              <Link to="/dashboard" className={`${btnGhost} text-center`}>
                Ver meu resumo
              </Link>
              <Link to="/bandas" className={`${btnPrimary} text-center`}>
                Minhas bandas
              </Link>
            </>
          ) : (
            <>
              <Link to="/analyze" className={`${btnAccent} text-center`}>
                Analisar música
              </Link>
              <Link to="/dashboard" className={`${btnGhost} text-center`}>
                Ver meu resumo
              </Link>
              <Link to="/cadastro" className={`${btnPrimary} text-center`}>
                Criar conta
              </Link>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
