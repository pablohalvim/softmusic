import { Link, useParams, useSearchParams } from "react-router";

import { JobStatusTracker } from "../components/analysis/JobStatusTracker";

export default function JobDetail() {
  const { jobId } = useParams();
  const [searchParams] = useSearchParams();
  const songId = searchParams.get("songId");

  if (!jobId || !songId) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Status da análise</h1>
        <p className="text-red-400">Job inválido. Volte para a biblioteca ou envie uma nova análise.</p>
        <Link to="/library" className="text-green-300 underline">
          Ir para biblioteca
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Status da análise</h1>
        <p className="text-slate-400">Acompanhamento em tempo real do processamento.</p>
      </div>
      <JobStatusTracker jobId={jobId} songId={songId} />
    </section>
  );
}
