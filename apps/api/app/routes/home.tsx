import { Link } from "react-router";

export default function Home() {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <h1 className="text-2xl font-semibold">SoftMusic API</h1>
      <p className="mt-2 text-slate-300">BFF REST · React Router v7 Framework Mode</p>
      <ul className="mt-4 space-y-2 text-sm text-slate-400">
        <li>
          <Link to="/health" className="text-indigo-300 hover:underline">
            GET /health
          </Link>
        </li>
        <li>POST /songs/analyze</li>
        <li>POST /songs/upload</li>
        <li>GET /songs/:id/analysis</li>
      </ul>
    </section>
  );
}
