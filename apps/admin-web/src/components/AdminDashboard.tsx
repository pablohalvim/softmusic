import { formatRelativeTime } from "@softmusic/shared/datetime";
import { useEffect, useState } from "react";

import { fetchAdminDashboardStats, getAdminToken, type AdminDashboardStats } from "../lib/api";

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

function formatPercent(value: number | null): string {
  if (value == null) return "—";
  return `${value.toFixed(1)}%`;
}

function statusLabel(status: string): string {
  if (status === "completed") return "Concluída";
  if (status === "processing") return "Processando";
  if (status === "pending") return "Aguardando";
  if (status === "failed") return "Falhou";
  if (status === "queued") return "Na fila";
  return status;
}

export function AdminDashboard({ onUnauthorized }: { onUnauthorized?: () => void }) {
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const payload = await fetchAdminDashboardStats();
        if (active) {
          setStats(payload);
          setError(null);
        }
      } catch (err) {
        if (active) {
          if (!getAdminToken()) {
            onUnauthorized?.();
          }
          setError(err instanceof Error ? err.message : "Erro ao carregar dashboard");
          setStats(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  if (loading && !stats) {
    return <p className="muted">Carregando métricas operacionais...</p>;
  }

  if (error && !stats) {
    return <p className="error">{error}</p>;
  }

  if (!stats) {
    return null;
  }

  const cards = [
    {
      label: "Análises concluídas",
      value: String(stats.songs.completed),
      hint: `${stats.songs.total} músicas na plataforma`,
    },
    {
      label: "Jobs em fila",
      value: String(stats.jobs.queued),
      hint:
        stats.jobs.processing > 0
          ? `${stats.jobs.processing} processando agora`
          : "Nenhum job em execução",
    },
    {
      label: "Tempo médio",
      value: formatDuration(stats.pipeline.average_duration_seconds),
      hint: "Pipeline completo · últimas 24h",
    },
    {
      label: "Taxa de sucesso",
      value: formatPercent(stats.pipeline.success_rate_24h),
      hint: `${stats.pipeline.completed_24h} ok · ${stats.pipeline.failed_24h} falhas (24h)`,
    },
  ];

  return (
    <section className="dashboard">
      <div className="dashboard-header">
        <div>
          <h2>Operação</h2>
          <p className="muted">Visão global da plataforma SoftMusic.</p>
        </div>
        <p className="muted small">
          Atualizado {formatRelativeTime(stats.generated_at)} · refresh a cada 10s
        </p>
      </div>

      <div className="stats-grid">
        {cards.map((card) => (
          <article key={card.label} className="stat-card">
            <p className="muted">{card.label}</p>
            <p className="stat-value">{card.value}</p>
            <p className="muted small">{card.hint}</p>
          </article>
        ))}
      </div>

      <div className="dashboard-columns">
        <article className="card">
          <h3>Em processamento</h3>
          {stats.active_jobs.length === 0 ? (
            <p className="muted">Nenhuma análise ativa no momento.</p>
          ) : (
            <ul className="job-list">
              {stats.active_jobs.map((job) => (
                <li key={job.job_id}>
                  <div className="job-row">
                    <span>{job.title ?? "Música sem título"}</span>
                    <span className="badge">{statusLabel(job.status)}</span>
                  </div>
                  <div className="progress-row">
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${job.progress}%` }} />
                    </div>
                    <span className="muted small">{job.progress}%</span>
                  </div>
                  {job.stage ? <p className="muted small">Etapa: {job.stage}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="card">
          <h3>Atividade recente</h3>
          {stats.recent_songs.length === 0 ? (
            <p className="muted">Nenhuma música analisada ainda.</p>
          ) : (
            <ul className="job-list">
              {stats.recent_songs.map((song) => (
                <li key={song.id}>
                  <div className="job-row">
                    <div>
                      <p>{song.title ?? "Música sem título"}</p>
                      <p className="muted small">
                        {song.artist ?? "Artista desconhecido"} · {formatRelativeTime(song.updated_at)}
                      </p>
                    </div>
                    <span className="badge">{statusLabel(song.status)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      <div className="stats-grid compact">
        <div className="mini-stat">
          <span className="muted">Pendentes</span>
          <strong>{stats.songs.pending}</strong>
        </div>
        <div className="mini-stat">
          <span className="muted">Falhas</span>
          <strong className="danger">{stats.songs.failed}</strong>
        </div>
        <div className="mini-stat">
          <span className="muted">Processando</span>
          <strong className="accent">{stats.songs.processing}</strong>
        </div>
      </div>
    </section>
  );
}
