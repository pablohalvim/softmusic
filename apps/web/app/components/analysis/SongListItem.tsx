import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";

import { formatDateTime } from "@softmusic/shared/datetime";

import { ConvertKeyModal } from "../library/ConvertKeyModal";
import { EditSongModal } from "../library/EditSongModal";
import { ReanalyzeAudioModal } from "../library/ReanalyzeAudioModal";
import {
  cancelSongAnalysis,
  deleteSong,
  fetchJob,
  fetchSongJob,
  fetchSongKeys,
  isActiveSong,
  isJobFinished,
  shareSongToGlobal,
  unshareSongFromGlobal,
  type SongSummary,
} from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useBand } from "../../lib/band-context";
import { useConfirm } from "../../lib/confirm";
import { labelSongStatus } from "../../lib/status-labels";
import { useToast } from "../../lib/toast";
import { btnGhost, panelClass } from "../../lib/ui-classes";
import { JobProgressDetails, ProgressBar, StatusBadge } from "./StatusBadge";

export function SongListItem({ song }: { song: SongSummary }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const { activeBand } = useBand();
  const { confirm } = useConfirm();
  const [editOpen, setEditOpen] = useState(false);
  const [reanalyzeOpen, setReanalyzeOpen] = useState(false);
  const [convertKeyOpen, setConvertKeyOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const isActive = isActiveSong(song.status);
  const blocked = Boolean(activeBand?.is_blocked);
  const canDelete = Boolean(activeBand?.is_owner || activeBand?.can_delete_songs);
  const canManageShare =
    song.status === "completed" &&
    (!song.created_by_user_id || song.created_by_user_id === user?.id);
  const canReanalyze = Boolean(song.can_reanalyze) && !blocked && !isActive;
  const canConvertKey = song.status === "completed" && !blocked;
  const reanalyzeLabel = song.has_audio ? "Nova análise" : "Analisar áudio";

  const jobQuery = useQuery({
    queryKey: ["song-job", song.id],
    queryFn: () => fetchSongJob(song.id),
    enabled: isActive || song.status === "failed",
    refetchInterval: (query) =>
      query.state.data && isJobFinished(query.state.data.status) ? false : 5000,
  });

  const keysQuery = useQuery({
    queryKey: ["song-keys", song.id],
    queryFn: () => fetchSongKeys(song.id),
    enabled: song.status === "completed" && !blocked,
    refetchInterval: (query) => {
      const variants = query.state.data?.variants ?? [];
      const active = variants.some(
        (variant) => variant.status === "queued" || variant.status === "processing",
      );
      return active ? 4000 : false;
    },
  });

  const activeKeyVariant =
    keysQuery.data?.variants.find(
      (variant) => variant.status === "queued" || variant.status === "processing",
    ) ?? null;

  const keyJobQuery = useQuery({
    queryKey: ["job", activeKeyVariant?.job_id],
    queryFn: () => fetchJob(activeKeyVariant!.job_id!),
    enabled: Boolean(activeKeyVariant?.job_id),
    refetchInterval: (query) =>
      query.state.data && isJobFinished(query.state.data.status) ? false : 2500,
  });

  const prevKeyJobStatus = useRef<string | null>(null);
  useEffect(() => {
    const status = keyJobQuery.data?.status ?? null;
    const prev = prevKeyJobStatus.current;
    prevKeyJobStatus.current = status;
    if (!prev || !status || prev === status) return;
    if (!isJobFinished(status)) return;
    void queryClient.invalidateQueries({ queryKey: ["song-keys", song.id] });
    // Toast só na linha quando o modal não está aberto (evita duplicar).
    if (status === "completed" && activeKeyVariant && !convertKeyOpen) {
      toast.success(`Tom ${activeKeyVariant.target_key} convertido com sucesso.`);
    }
  }, [
    keyJobQuery.data?.status,
    activeKeyVariant,
    queryClient,
    song.id,
    toast,
    convertKeyOpen,
  ]);

  const invalidateLibrary = () => {
    queryClient.invalidateQueries({ queryKey: ["songs"] });
    queryClient.invalidateQueries({ queryKey: ["songs-global"] });
    queryClient.invalidateQueries({ queryKey: ["song", song.id] });
    queryClient.invalidateQueries({ queryKey: ["song-job", song.id] });
    queryClient.invalidateQueries({ queryKey: ["song-keys", song.id] });
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
  const keyJob = keyJobQuery.data;
  const displayStatus =
    job?.status === "cancelled" || job?.status === "failed" ? "failed" : song.status;
  const showProgress = isActive && job && !isJobFinished(job.status);
  const showKeyProgress =
    Boolean(activeKeyVariant) &&
    Boolean(keyJob) &&
    !isJobFinished(keyJob!.status);
  const isBusy =
    deleteMutation.isPending || cancelMutation.isPending || shareMutation.isPending;

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (menuButtonRef.current?.contains(target) || menuPanelRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  const menuItems: Array<
    | { kind: "link"; label: string; to: string; tone?: "primary" | "danger" | "default" }
    | {
        kind: "button";
        label: string;
        onClick: () => void;
        tone?: "primary" | "danger" | "default";
        disabled?: boolean;
      }
  > = [];

  if (!blocked) {
    menuItems.push({
      kind: "button",
      label: "Editar",
      onClick: () => {
        closeMenu();
        setEditOpen(true);
      },
      disabled: isBusy,
    });
    if (canReanalyze) {
      menuItems.push({
        kind: "button",
        label: reanalyzeLabel,
        onClick: () => {
          closeMenu();
          setReanalyzeOpen(true);
        },
        disabled: isBusy,
      });
    }
    if (isActive) {
      menuItems.push({
        kind: "button",
        label: cancelMutation.isPending ? "Cancelando..." : "Cancelar",
        tone: "danger",
        disabled: isBusy,
        onClick: async () => {
          closeMenu();
          const ok = await confirm({
            title: "Cancelar análise",
            message: "Cancelar a análise desta música?",
            confirmLabel: "Cancelar análise",
            danger: true,
          });
          if (ok) cancelMutation.mutate();
        },
      });
    }
    if (song.status === "completed") {
      menuItems.push({
        kind: "link",
        label: "Cifra",
        to: `/songs/${song.id}/cifra`,
        tone: "primary",
      });
      menuItems.push({
        kind: "link",
        label: "Detalhes",
        to: `/songs/${song.id}`,
      });
      if (canManageShare) {
        menuItems.push({
          kind: "button",
          label: shareMutation.isPending
            ? "Salvando..."
            : song.is_global
              ? "Remover da global"
              : "Compartilhar na global",
          disabled: isBusy,
          onClick: () => {
            closeMenu();
            shareMutation.mutate();
          },
        });
      }
      if (canConvertKey) {
        menuItems.push({
          kind: "button",
          label: "Converter tom",
          onClick: () => {
            closeMenu();
            setConvertKeyOpen(true);
          },
          disabled: isBusy,
        });
      }
    } else if (!isActive) {
      menuItems.push({
        kind: "link",
        label: "Ver detalhes",
        to: `/songs/${song.id}`,
      });
    } else {
      menuItems.push({
        kind: "link",
        label: "Acompanhar",
        to: `/songs/${song.id}`,
        tone: "primary",
      });
    }
    if (canDelete) {
      menuItems.push({
        kind: "button",
        label: deleteMutation.isPending ? "Excluindo..." : "Excluir",
        tone: "danger",
        disabled: isBusy,
        onClick: async () => {
          closeMenu();
          const ok = await confirm({
            title: "Excluir música",
            message: song.is_global
              ? "Remover esta música desta banda? Ela continuará na Biblioteca global."
              : "Excluir esta música da banda? Se não estiver na Biblioteca global, não poderá readicionar depois.",
            confirmLabel: "Excluir",
            danger: true,
          });
          if (ok) deleteMutation.mutate();
        },
      });
    }
  }

  const menuPanel =
    menuOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[70]"
            role="presentation"
            onClick={(event) => {
              if (event.target === event.currentTarget) setMenuOpen(false);
            }}
          >
            <div
              ref={menuPanelRef}
              id={menuId}
              role="menu"
              aria-label="Ações da música"
              className="absolute right-3 top-[max(4.5rem,env(safe-area-inset-top))] w-[min(calc(100vw-1.5rem),18rem)] overflow-hidden rounded-2xl border border-white/10 bg-[#07140f] shadow-2xl sm:right-6"
              style={menuAnchorStyle(menuButtonRef.current)}
            >
              <div className="border-b border-white/10 px-4 py-3">
                <p className="truncate text-sm font-medium text-slate-100">{title}</p>
                <p className="text-xs text-slate-500">Ações</p>
              </div>
              <ul className="max-h-[min(70vh,24rem)] overflow-y-auto py-1">
                {menuItems.map((item) => {
                  const toneClass =
                    item.tone === "danger"
                      ? "text-red-300"
                      : item.tone === "primary"
                        ? "text-green-200"
                        : "text-slate-100";
                  const className = `flex w-full items-center px-4 py-3 text-left text-sm ${toneClass} hover:bg-white/5 disabled:opacity-50`;
                  if (item.kind === "link") {
                    return (
                      <li key={item.label} role="none">
                        <Link
                          role="menuitem"
                          to={item.to}
                          className={className}
                          onClick={closeMenu}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  }
                  return (
                    <li key={item.label} role="none">
                      <button
                        type="button"
                        role="menuitem"
                        className={className}
                        disabled={item.disabled}
                        onClick={() => void item.onClick()}
                      >
                        {item.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>,
          document.body,
        )
      : null;

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
          <div className="relative">
            <button
              ref={menuButtonRef}
              type="button"
              disabled={isBusy && !menuOpen}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              onClick={() => setMenuOpen((value) => !value)}
              className={`${btnGhost} inline-flex items-center gap-1.5 px-3 py-1.5 text-sm disabled:opacity-50`}
            >
              Ações
              <span aria-hidden className="text-[10px] text-slate-400">
                {menuOpen ? "▲" : "▼"}
              </span>
            </button>
            {menuPanel}
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

      {showKeyProgress && activeKeyVariant && keyJob ? (
        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-200">
              Convertendo tom para{" "}
              <span className="font-medium text-green-300">{activeKeyVariant.target_key}</span>
            </p>
            <button
              type="button"
              className={`${btnGhost} px-3 py-1.5 text-xs`}
              onClick={() => setConvertKeyOpen(true)}
            >
              Acompanhar
            </button>
          </div>
          <JobProgressDetails
            status={keyJob.status}
            stage={keyJob.stage}
            progress={keyJob.progress}
            error={keyJob.error}
          />
        </div>
      ) : activeKeyVariant && !keyJob ? (
        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-200">
              Convertendo tom para{" "}
              <span className="font-medium text-green-300">{activeKeyVariant.target_key}</span>
            </p>
            <button
              type="button"
              className={`${btnGhost} px-3 py-1.5 text-xs`}
              onClick={() => setConvertKeyOpen(true)}
            >
              Acompanhar
            </button>
          </div>
          <ProgressBar value={activeKeyVariant.status === "processing" ? 30 : 8} />
          <p className="mt-2 text-xs text-slate-500">Atualizando progresso da conversão...</p>
        </div>
      ) : null}

      <EditSongModal open={editOpen} song={song} onClose={() => setEditOpen(false)} />
      <ReanalyzeAudioModal
        open={reanalyzeOpen}
        song={song}
        onClose={() => setReanalyzeOpen(false)}
        onStarted={invalidateLibrary}
      />
      <ConvertKeyModal
        open={convertKeyOpen}
        songId={song.id}
        songTitle={title}
        onClose={() => setConvertKeyOpen(false)}
      />
    </article>
  );
}

function menuAnchorStyle(button: HTMLButtonElement | null): CSSProperties {
  if (!button || typeof window === "undefined") {
    return { top: "4.5rem", right: "0.75rem" };
  }
  const rect = button.getBoundingClientRect();
  const top = Math.min(rect.bottom + 8, window.innerHeight - 80);
  const right = Math.max(12, window.innerWidth - rect.right);
  return { top, right, position: "fixed" };
}
