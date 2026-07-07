import { Link, useParams, useSearchParams } from "react-router";

import { JobStatusTracker } from "../components/analysis/JobStatusTracker";
import { linkClass, panelClass } from "../lib/ui-classes";

export default function JobDetail() {
  const { jobId } = useParams();
  const [searchParams] = useSearchParams();
  const songId = searchParams.get("songId");

  if (!jobId || !songId) {
    return (
      <section className={`${panelClass} space-y-4`}>
        <h1 className="sm-page-title">Status da análise</h1>
        <p className="text-red-400">Job inválido. Volte para a biblioteca ou envie uma nova análise.</p>
        <Link to="/library" className={linkClass}>
          Ir para biblioteca
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="sm-page-title">Status da análise</h1>
        <p className="sm-page-subtitle">Acompanhamento em tempo real do processamento.</p>
      </div>
      <JobStatusTracker jobId={jobId} songId={songId} />
    </section>
  );
}
