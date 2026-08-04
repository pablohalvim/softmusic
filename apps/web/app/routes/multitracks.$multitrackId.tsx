import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { useEffect, useMemo, useState } from "react";

import { MultitrackMixer } from "../components/multitracks/MultitrackMixer";
import {
  deleteMultitrack,
  deleteMultitrackTrack,
  fetchMultitrack,
  fetchMultitrackKeys,
  requestMultitrackKeyVariant,
  updateMultitrackTrack,
  uploadMultitrackTrack,
} from "../lib/api";
import { useBand } from "../lib/band-context";
import { useConfirm } from "../lib/confirm";
import { useToast } from "../lib/toast";
import {
  btnGhost,
  btnPrimary,
  cifraSelectClass,
  inputClass,
  panelClass,
} from "../lib/ui-classes";

const ROLES = [
  "drums",
  "bass",
  "guitar",
  "keys",
  "vocals",
  "bv",
  "pads",
  "click",
  "guide",
  "other",
];

const MAX_BYTES = 200 * 1024 * 1024;

export default function MultitrackDetailPage() {
  const { multitrackId = "" } = useParams();
  const { activeBand } = useBand();
  const toast = useToast();
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
  const canWrite = Boolean(activeBand?.is_owner || activeBand?.can_analyze_songs);

  const [role, setRole] = useState("other");
  const [playbackKey, setPlaybackKey] = useState<string | null>(null);
  const [convertKey, setConvertKey] = useState("");

  const detailQuery = useQuery({
    queryKey: ["multitrack", multitrackId],
    queryFn: () => fetchMultitrack(multitrackId),
    enabled: Boolean(multitrackId),
  });

  const keysQuery = useQuery({
    queryKey: ["multitrack-keys", multitrackId],
    queryFn: () => fetchMultitrackKeys(multitrackId),
    enabled: Boolean(multitrackId),
    refetchInterval: (query) => {
      const variants = query.state.data?.variants ?? [];
      return variants.some((v) => v.status === "queued" || v.status === "processing")
        ? 3000
        : false;
    },
  });

  const mt = detailQuery.data;
  const tracks = mt?.tracks ?? [];
  const sourceKey = mt?.source_key ?? "";

  useEffect(() => {
    if (!playbackKey && sourceKey) setPlaybackKey(sourceKey);
  }, [sourceKey, playbackKey]);

  const readyKeys = useMemo(() => {
    const ready = (keysQuery.data?.variants ?? [])
      .filter((v) => v.status === "ready")
      .map((v) => v.target_key);
    return sourceKey ? [sourceKey, ...ready] : ready;
  }, [keysQuery.data?.variants, sourceKey]);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_BYTES) {
        throw new Error("Arquivo excede 200 MB");
      }
      return uploadMultitrackTrack(multitrackId, file, { role });
    },
    onSuccess: () => {
      toast.success("Faixa enviada");
      void queryClient.invalidateQueries({ queryKey: ["multitrack", multitrackId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const convertMutation = useMutation({
    mutationFn: () => requestMultitrackKeyVariant(multitrackId, convertKey),
    onSuccess: (result) => {
      toast.success(result.message ?? `Conversão para ${result.target_key} iniciada`);
      void queryClient.invalidateQueries({ queryKey: ["multitrack-keys", multitrackId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMtMutation = useMutation({
    mutationFn: () => deleteMultitrack(multitrackId),
    onSuccess: () => {
      toast.success("Multitrack excluído");
      window.location.href = "/multitracks";
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (detailQuery.isLoading) {
    return <p className="text-sm text-slate-400">Carregando Multitrack...</p>;
  }
  if (detailQuery.isError || !mt) {
    return <p className="text-sm text-red-400">Multitrack não encontrado.</p>;
  }

  return (
    <section className="space-y-6 sm-animate-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs text-slate-500">
            <Link to="/multitracks" className="text-green-400 hover:text-green-300">
              Multitracks
            </Link>
            {" / "}
            {mt.title}
          </p>
          <h1 className="sm-page-title mt-1">{mt.title}</h1>
          <p className="sm-page-subtitle">
            Tom de origem: <span className="text-slate-200">{mt.source_key}{mt.source_mode === "minor" ? "m" : ""}</span>
            {" · "}
            bloqueado
            {mt.bpm ? ` · ${mt.bpm} BPM` : ""}
            {mt.song_id ? (
              <>
                {" · "}
                <Link to={`/songs/${mt.song_id}`} className="text-blue-300 hover:text-blue-200">
                  ver música
                </Link>
              </>
            ) : null}
          </p>
        </div>
        {canWrite ? (
          <button
            type="button"
            className={`${btnGhost} text-red-300`}
            onClick={async () => {
              const ok = await confirm({
                title: "Excluir Multitrack",
                message: "Todas as faixas e variantes de tom serão removidas.",
                confirmLabel: "Excluir",
                danger: true,
              });
              if (ok) deleteMtMutation.mutate();
            }}
          >
            Excluir
          </button>
        ) : null}
      </div>

      {canWrite ? (
        <div className={`${panelClass} space-y-3`}>
          <h2 className="font-medium">Enviar faixas</h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block flex-1 text-sm text-slate-300">
              Papel padrão
              <select
                className={`${cifraSelectClass} mt-1`}
                value={role}
                onChange={(event) => setRole(event.target.value)}
              >
                {ROLES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="block flex-1 text-sm text-slate-300">
              Arquivo (até 200 MB)
              <input
                className={`${inputClass} mt-1 w-full`}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac,.aac,.opus,.aiff"
                disabled={uploadMutation.isPending}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) uploadMutation.mutate(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          <p className="text-xs text-slate-500">
            Click/guide nascem com “não converter tom”. Você pode alterar por faixa.
          </p>
        </div>
      ) : null}

      <div className={`${panelClass} space-y-4`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-medium">Player</h2>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            Tom
            <select
              className={cifraSelectClass}
              value={playbackKey ?? sourceKey}
              onChange={(event) => setPlaybackKey(event.target.value)}
            >
              {readyKeys.map((key) => (
                <option key={key} value={key}>
                  {key}
                  {key === sourceKey ? " (original)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        {tracks.length === 0 ? (
          <p className="text-sm text-slate-400">Envie faixas para começar a ouvir.</p>
        ) : (
          <MultitrackMixer
            multitrackId={mt.id}
            tracks={tracks}
            playbackKey={playbackKey === sourceKey ? null : playbackKey}
            onTrackMuteChange={(trackId, muted) => {
              if (!canWrite) return;
              void updateMultitrackTrack(mt.id, trackId, { muted }).then(() =>
                queryClient.invalidateQueries({ queryKey: ["multitrack", multitrackId] }),
              );
            }}
            onTrackGainChange={(trackId, gain) => {
              if (!canWrite) return;
              void updateMultitrackTrack(mt.id, trackId, { gain });
            }}
          />
        )}
      </div>

      <div className={`${panelClass} space-y-3`}>
        <h2 className="font-medium">Faixas</h2>
        <ul className="space-y-2">
          {tracks.map((track) => (
            <li
              key={track.id}
              className="flex flex-col gap-2 rounded-xl border border-white/10 px-3 py-2 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-slate-100">{track.name}</p>
                <p className="text-xs text-slate-500">
                  {track.role}
                  {track.duration_seconds ? ` · ${track.duration_seconds.toFixed(1)}s` : ""}
                </p>
              </div>
              {canWrite ? (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className={cifraSelectClass}
                    value={track.role}
                    onChange={(event) => {
                      void updateMultitrackTrack(mt.id, track.id, {
                        role: event.target.value,
                      }).then(() =>
                        queryClient.invalidateQueries({ queryKey: ["multitrack", multitrackId] }),
                      );
                    }}
                  >
                    {ROLES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={track.pitch_shift}
                      onChange={(event) => {
                        void updateMultitrackTrack(mt.id, track.id, {
                          pitch_shift: event.target.checked,
                        }).then(() =>
                          queryClient.invalidateQueries({
                            queryKey: ["multitrack", multitrackId],
                          }),
                        );
                      }}
                    />
                    Converter tom
                  </label>
                  <button
                    type="button"
                    className={`${btnGhost} px-2 py-1 text-xs text-red-300`}
                    onClick={async () => {
                      const ok = await confirm({
                        title: "Remover faixa",
                        message: `Remover “${track.name}”?`,
                        confirmLabel: "Remover",
                        danger: true,
                      });
                      if (!ok) return;
                      await deleteMultitrackTrack(mt.id, track.id);
                      toast.success("Faixa removida");
                      void queryClient.invalidateQueries({
                        queryKey: ["multitrack", multitrackId],
                      });
                    }}
                  >
                    Remover
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {canWrite ? (
        <div className={`${panelClass} space-y-3`}>
          <h2 className="font-medium">Converter tom</h2>
          <p className="text-sm text-slate-400">
            Gera uma cópia pitch-shifted de todas as faixas marcadas. Click/guide não sobem de tom.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="block flex-1 text-sm text-slate-300">
              Tom alvo
              <select
                className={`${cifraSelectClass} mt-1`}
                value={convertKey}
                onChange={(event) => setConvertKey(event.target.value)}
              >
                <option value="">Selecione...</option>
                {(keysQuery.data?.available_targets ?? []).map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={btnPrimary}
              disabled={!convertKey || convertMutation.isPending || tracks.length === 0}
              onClick={() => convertMutation.mutate()}
            >
              {convertMutation.isPending ? "Enfileirando..." : "Converter"}
            </button>
          </div>
          <ul className="space-y-1 text-sm text-slate-400">
            {(keysQuery.data?.variants ?? []).map((variant) => (
              <li key={variant.id}>
                {variant.target_key}: {variant.status}
                {variant.status === "processing" || variant.status === "queued"
                  ? ` · ${variant.progress}%`
                  : ""}
                {variant.error ? ` · ${variant.error}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
