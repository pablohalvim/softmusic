import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { Link } from "react-router";

import { formatDateTime } from "@softmusic/shared/datetime";

import {
  cancelSongAnalysis,
  deleteSong,
  fetchSongJob,
  isActiveSong,
  isJobFinished,
  reanalyzeSongAudio,
  shareSongToGlobal,
  unshareSongFromGlobal,
  type SongSummary,
} from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useBand } from "../../lib/band-context";
import { useConfirm } from "../../lib/confirm";
import { labelSongStatus } from "../../lib/status-labels";
import { useToast } from "../../lib/toast";
import { btnGhost, btnPrimary, panelClass } from "../../lib/ui-classes";
import { JobProgressDetails, ProgressBar, StatusBadge } from "./StatusBadge";

export function SongListItem({ song }: { song: SongSummary }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { activeBand } = useBand();
  const { confirm } = useConfirm();
  const toast = useToast();
  const reanalyzeInputRef = useRef<HTMLInputElement>(null);
  const isActive = isActiveSong(song.status);
  const blocked = Boolean(activeBand?.is_blocked);
  const canDelete = Boolean(activeBand?.is_owner || activeBand?.can_delete_songs);
  const canManageShare =
    song.status === "completed" &&
    (!song.created_by_user_id || song.created_by_user_id === user?.id);
  const canReanalyze = Boolean(song.can_reanalyze) && !blocked && !isActive;
  const reanalyzeLabel = song.has_audio ? "Nova análise" : "Analisar áudio";

  const jobQuery = useQuery({
    queryKey: ["song-job", song.id],
    queryFn: () => fetchSongJob(song.id),
    enabled: isActive || song.status === "failed",
    refetchInterval: (query) =>
      query.state.data && isJobFinished(query.state.data.status) ? false : 5000,
  });

  const invalidateLibrary = () => {
    queryClient.invalidateQueries({ queryKey: ["songs"] });
    queryClient.invalidateQueries({ queryKey: ["songs-global"] });
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

  const shareMutation = useMutation({
    mutationFn: () =>
      song.is_global ? unshareSongFromGlobal(song.id) : shareSongToGlobal(song.id),
    onSuccess: invalidateLibrary,
  });

  const reanalyzeMutation = useMutation({
    mutationFn: (file: File) =>
      reanalyzeSongAudio(song.id, file, { replace: Boolean(song.has_audio) }),
    onSuccess: () => {
      invalidateLibrary();
      toast.success(
        song.has_audio
          ? "Nova análise iniciada com o áudio enviado."
          : "Análise de áudio iniciada.",
      );
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const title = song.title ?? "Sem título";
  const subtitle = [
    song.artist,
    song.source_type === "youtube"
      ? "YouTube"
      : song.source_type === "upload"
        ? "Upload"
        : song.source_type === "manual" || song.source_type === "cifra_club"
          ? "Cifra"
          : null,
    song.link_source === "imported_global" ? "Importada" : null,
    formatDateTime(song.created_at),
  ]
    .filter(Boolean)
    .join(" · ");

  const job = jobQuery.data;
  const displayStatus =
    job?.status === "cancelled" || job?.status === "failed" ? "failed" : song.status;
  const showProgress = isActive && job && !isJobFinished(job.status);
  const isBusy =
    deleteMutation.isPending ||
    cancelMutation.isPending ||
    shareMutation.isPending ||
    reanalyzeMutation.isPending;

  return (
    <article className={panelClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-medium">{title}</h2>
            <StatusBadge status={displayStatus} kind="song" />
            {song.status === "completed" && song.is_global ? (
              <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[11px] text-green-200">
                Global
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
          <p className="mt-1 text-xs text-slate-500">{labelSongStatus(displayStatus)}</p>
        </div>

        {!blocked ? (
          <div className="flex flex-wrap gap-2">
            {canReanalyze ? (
              <>
                <input
                  ref={reanalyzeInputRef}
                  id={`reanalyze-audio-${song.id}`}
                  name={`reanalyze-audio-${song.id}`}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(event) => {
                    const selected = event.target.files?.[0] ?? null;
                    event.target.value = "";
                    if (!selected) return;
                    void (async () => {
                      const ok = await confirm({
                        title: song.has_audio ? "Nova análise" : "Analisar áudio",
                        message: song.has_audio
                          ? "Enviar um novo áudio substitui o atual e inicia outra análise. Continuar?"
                          : "Enviar áudio para analisar esta música (stems, tom, etc.)?",
                        confirmLabel: song.has_audio ? "Substituir e analisar" : "Analisar",
                      });
                      if (ok) reanalyzeMutation.mutate(selected);
                    })();
                  }}
                />
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => reanalyzeInputRef.current?.click()}
                  className={`${btnGhost} border-green-500/30 px-3 py-1.5 text-sm text-green-200 hover:border-green-400 disabled:opacity-50`}
                  title={
                    song.has_audio
                      ? "Envia um novo áudio e reanalisa (somente músicas criadas nesta banda)"
                      : "Anexa áudio e inicia a primeira análise"
                  }
                >
                  {reanalyzeMutation.isPending ? "Enviando..." : reanalyzeLabel}
                </button>
              </>
            ) : null}

            {isActive ? (
              <button
                type="button"
                disabled={isBusy}
                onClick={async () => {
                  const ok = await confirm({
                    title: "Cancelar análise",
                    message: "Cancelar a análise desta música?",
                    confirmLabel: "Cancelar análise",
                    danger: true,
                  });
                  if (ok) cancelMutation.mutate();
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
                {canManageShare ? (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => shareMutation.mutate()}
                    className={`${btnGhost} px-3 py-1.5 text-sm disabled:opacity-50`}
                    title={
                      song.is_global
                        ? "Remove da Biblioteca global (continua nesta banda)"
                        : "Disponibiliza na Biblioteca global ao excluir desta banda"
                    }
                  >
                    {shareMutation.isPending
                      ? "Salvando..."
                      : song.is_global
                        ? "Remover da global"
                        : "Compartilhar na global"}
                  </button>
                ) : null}
              </>
            ) : !isActive ? (
              <Link to={`/songs/${song.id}`} className={`${btnGhost} px-3 py-1.5 text-sm`}>
                Ver detalhes
              </Link>
            ) : (
              <Link
                to={`/songs/${song.id}`}
                className={`${btnGhost} border-green-500/30 px-3 py-1.5 text-sm text-green-200`}
              >
                Acompanhar
              </Link>
            )}

            {canDelete ? (
              <button
                type="button"
                disabled={isBusy}
                onClick={async () => {
                  const ok = await confirm({
                    title: "Excluir música",
                    message: song.is_global
                      ? "Remover esta música desta banda? Ela continuará na Biblioteca global."
                      : "Excluir esta música da banda? Se não estiver na Biblioteca global, não poderá readicionar depois.",
                    confirmLabel: "Excluir",
                    danger: true,
                  });
                  if (ok) deleteMutation.mutate();
                }}
                className={`${btnGhost} border-red-500/30 px-3 py-1.5 text-sm text-red-300 hover:border-red-400 disabled:opacity-50`}
              >
                {deleteMutation.isPending ? "Excluindo..." : "Excluir"}
              </button>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-amber-300">Conteúdo bloqueado — regularize o pagamento</p>
        )}
      </div>

      {deleteMutation.isError ? (
        <p className="mt-3 text-sm text-red-400">{deleteMutation.error.message}</p>
      ) : null}
      {cancelMutation.isError ? (
        <p className="mt-3 text-sm text-red-400">{cancelMutation.error.message}</p>
      ) : null}
      {shareMutation.isError ? (
        <p className="mt-3 text-sm text-red-400">{shareMutation.error.message}</p>
      ) : null}
      {reanalyzeMutation.isError ? (
        <p className="mt-3 text-sm text-red-400">{reanalyzeMutation.error.message}</p>
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
