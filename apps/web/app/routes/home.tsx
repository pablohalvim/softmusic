import { Link } from "react-router";

import { btnAccent, btnGhost, btnPrimary } from "../lib/ui-classes";

export default function Home() {
  return (
    <section className="space-y-6">
      <div className="glass-panel relative overflow-hidden p-8 md:p-10">
        <div
          className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-green-500/10 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-red-500/10 blur-3xl"
          aria-hidden
        />
        <p className="text-sm uppercase tracking-[0.25em] text-green-400">Music Intelligence Platform</p>
        <h1 className="mt-3 max-w-2xl text-4xl font-bold leading-tight text-slate-50 md:text-5xl">
          Análise musical profissional com IA
        </h1>
        <p className="mt-4 max-w-2xl text-slate-300">
          Harmonia, ritmo, estrutura, instrumentação e explicações educacionais — tudo em JSON
          versionado, pronto para produção.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/analyze" className={btnAccent}>
            Analisar música
          </Link>
          <Link to="/dashboard" className={btnGhost}>
            Ver meu resumo
          </Link>
          <Link to="/cadastro" className={btnPrimary}>
            Criar conta
          </Link>
        </div>
      </div>
    </section>
  );
}
