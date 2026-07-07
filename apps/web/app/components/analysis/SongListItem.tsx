import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";

import { formatDateTime } from "@softmusic/shared/datetime";

import {
  cancelSongAnalysis,
  deleteSong,
  fetchSongJob,
  isActiveSong,
  isJobFinished,
  type SongSummary,
} from "../../lib/api";
import { labelSongStatus } from "../../lib/status-labels";
import { btnGhost, btnPrimary, panelClass } from "../../lib/ui-classes";
import { JobProgressDetails, ProgressBar, StatusBadge } from "./StatusBadge";

export function SongListItem({ song }: { song: SongSummary }) {
  const queryClient = useQueryClient();
  const isActive = isActiveSong(song.status);

  const jobQuery = useQuery({
    queryKey: ["song-job", song.id],
    queryFn: () => fetchSongJob(song.id),
    enabled: isActive || song.status === "failed",
    refetchInterval: (query) =>
      query.state.data && isJobFinished(query.state.data.status) ? false : 2500,
  });

  const invalidateLibrary = () => {
    queryClient.invalidateQueries({ queryKey: ["songs"] });
    queryClient.invalidateQueries({ queryKey: ["song", song.id] });
    queryClient.invalidateQueries({ queryKey: ["song-job", song.id] });
  };

  const deleteMutation = useMutation({
    mutationFn: () => deleteSong(song.id),
    onSuccess: invalidateLibrary,
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelSongAnalysis(song.id),
    onSuccess: invalidateLibrary,
  });

  const title = song.title ?? "Sem título";
  const subtitle = [
    song.artist,
    song.source_type === "youtube" ? "YouTube" : song.source_type === "upload" ? "Upload" : null,
    formatDateTime(song.created_at),
  ]
    .filter(Boolean)
    .join(" · ");

  const job = jobQuery.data;
  const displayStatus =
    job?.status === "cancelled" || job?.status === "failed" ? "failed" : song.status;
  const showProgress = isActive && job && !isJobFinished(job.status);
  const isBusy = deleteMutation.isPending || cancelMutation.isPending;

  return (
    <article className={panelClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-medium">{title}</h2>
            <StatusBadge status={displayStatus} kind="song" />
          </div>
          <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
          <p className="mt-1 text-xs text-slate-500">{labelSongStatus(displayStatus)}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {isActive ? (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                if (window.confirm("Cancelar a análise desta música?")) {
                  cancelMutation.mutate();
                }
              }}
              className={`${btnGhost} border-amber-500/30 text-amber-200 hover:border-amber-400 disabled:opacity-50`}
            >
              {cancelMutation.isPending ? "Cancelando..." : "Cancelar"}
            </button>
          ) : null}

          {song.status === "completed" ? (
            <>
              <Link to={`/songs/${song.id}/cifra`} className={`${btnPrimary} px-3 py-1.5 text-sm`}>
                Cifra
              </Link>
              <Link to={`/songs/${song.id}`} className={`${btnGhost} px-3 py-1.5 text-sm`}>
                Detalhes
              </Link>
            </>
          ) : !isActive ? (
            <Link to={`/songs/${song.id}`} className={`${btnGhost} px-3 py-1.5 text-sm`}>
              Ver detalhes
            </Link>
          ) : (
            <Link to={`/songs/${song.id}`} className={`${btnGhost} border-green-500/30 px-3 py-1.5 text-sm text-green-200`}>
              Acompanhar
            </Link>
          )}

          <button
            type="button"
            disabled={isBusy}
            onClick={() => {
              if (window.confirm("Excluir esta música da biblioteca?")) {
                deleteMutation.mutate();
              }
            }}
            className={`${btnGhost} border-red-500/30 px-3 py-1.5 text-sm text-red-300 hover:border-red-400 disabled:opacity-50`}
          >
            {deleteMutation.isPending ? "Excluindo..." : "Excluir"}
          </button>
        </div>
      </div>

      {deleteMutation.isError ? (
        <p className="mt-3 text-sm text-red-400">{deleteMutation.error.message}</p>
      ) : null}
      {cancelMutation.isError ? (
        <p className="mt-3 text-sm text-red-400">{cancelMutation.error.message}</p>
      ) : null}

      {showProgress ? (
        <div className="mt-4 border-t border-white/10 pt-4">
          <JobProgressDetails
            status={job.status}
            stage={job.stage}
            progress={job.progress}
            error={job.error}
          />
        </div>
      ) : job?.error && displayStatus === "failed" ? (
        <div className="mt-4 border-t border-white/10 pt-4">
          <p className="text-sm text-red-300">{job.error}</p>
        </div>
      ) : isActive ? (
        <div className="mt-4 border-t border-white/10 pt-4">
          <ProgressBar value={song.status === "processing" ? 30 : 5} />
          <p className="mt-2 text-xs text-slate-500">Atualizando status...</p>
        </div>
      ) : null}
    </article>
  );
}
