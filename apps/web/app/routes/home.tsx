import { Link } from "react-router";

export default function Home() {
  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-indigo-950/50 to-slate-900 p-8">
        <p className="text-sm uppercase tracking-[0.2em] text-indigo-300">Music Intelligence Platform</p>
        <h1 className="mt-3 text-4xl font-bold">Análise musical profissional com IA</h1>
        <p className="mt-4 max-w-2xl text-slate-300">
          Harmonia, ritmo, estrutura, instrumentação e explicações educacionais — tudo em JSON
          versionado, pronto para produção.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to="/analyze"
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
          >
            Analisar música
          </Link>
          <Link
            to="/dashboard"
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium hover:border-slate-500"
          >
            Ver dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}
