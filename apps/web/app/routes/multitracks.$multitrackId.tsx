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
  updateMultitrack,
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

const ROLE_OPTIONS = [
  { value: "drums", label: "drums (Bateria)" },
  { value: "bass", label: "bass (Baixo)" },
  { value: "guitar", label: "guitar (Guitarra)" },
  { value: "keys", label: "keys (Teclado)" },
  { value: "vocals", label: "vocals (Vocal)" },
  { value: "bv", label: "bv (Backing vocal)" },
  { value: "pads", label: "pads (Pads)" },
  { value: "click", label: "click (Click)" },
  { value: "guide", label: "guide (Guia)" },
  { value: "other", label: "other (Outro)" },
] as const;

const PRESET_ROLE_VALUES: Set<string> = new Set(ROLE_OPTIONS.map((item) => item.value));

const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const MAX_BYTES = 200 * 1024 * 1024;

function resolveUploadRole(role: string, customRole: string): string {
  if (role !== "other") return role;
  const custom = customRole.trim();
  if (!custom) throw new Error("Informe o papel da faixa");
  return custom;
}

function isClickLikeRole(role: string): boolean {
  const normalized = role.trim().toLowerCase();
  return (
    normalized === "click" ||
    normalized === "metronome" ||
    normalized === "count" ||
    normalized === "cue" ||
    normalized.includes("click") ||
    normalized.includes("metrônomo") ||
    normalized.includes("metronomo")
  );
}

function roleSelectValue(role: string): string {
  return PRESET_ROLE_VALUES.has(role) ? role : "other";
}

function roleLabel(role: string): string {
  const preset = ROLE_OPTIONS.find((item) => item.value === role);
  return preset?.label ?? role;
}

function TrackRoleEditor({
  role,
  onChange,
}: {
  role: string;
  onChange: (nextRole: string) => void;
}) {
  const [selectValue, setSelectValue] = useState(() => roleSelectValue(role));
  const [custom, setCustom] = useState(() => (PRESET_ROLE_VALUES.has(role) ? "" : role));

  useEffect(() => {
    setSelectValue(roleSelectValue(role));
    setCustom(PRESET_ROLE_VALUES.has(role) ? "" : role);
  }, [role]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={cifraSelectClass}
        value={selectValue}
        onChange={(event) => {
          const next = event.target.value;
          setSelectValue(next);
          if (next !== "other") {
            setCustom("");
            onChange(next);
          }
        }}
      >
        {ROLE_OPTIONS.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      {selectValue === "other" ? (
        <input
          className={`${inputClass} w-36 px-2 py-1 text-sm`}
          type="text"
          maxLength={64}
          placeholder="Qual papel?"
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          onBlur={() => {
            const next = custom.trim();
            if (next && next !== role) onChange(next);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.currentTarget.blur();
          }}
        />
      ) : null}
    </div>
  );
}

export default function MultitrackDetailPage() {
  const { multitrackId = "" } = useParams();
  const { activeBand } = useBand();
  const toast = useToast();
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
  const canWrite = Boolean(activeBand?.is_owner || activeBand?.can_analyze_songs);

  const [role, setRole] = useState("other");
  const [customRole, setCustomRole] = useState("");
  const [importBpm, setImportBpm] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [tracksExpanded, setTracksExpanded] = useState(false);
  const [playbackKey, setPlaybackKey] = useState<string | null>(null);
  const [convertKey, setConvertKey] = useState("");
  const [editSourceKey, setEditSourceKey] = useState("C");
  const [editSourceMode, setEditSourceMode] = useState<"major" | "minor">("major");

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
  const sourceMode = mt?.source_mode === "minor" ? "minor" : "major";

  useEffect(() => {
    if (!mt) return;
    const root = mt.source_key.replace(/m$/i, "");
    setEditSourceKey(KEYS.includes(root) ? root : "C");
    setEditSourceMode(mt.source_mode === "minor" || /m$/i.test(mt.source_key) ? "minor" : "major");
    if (mt.bpm != null && Number.isFinite(mt.bpm)) {
      setImportBpm(String(Math.round(mt.bpm)));
    }
  }, [mt?.id, mt?.source_key, mt?.source_mode, mt?.bpm]);

  useEffect(() => {
    if (!playbackKey && sourceKey) setPlaybackKey(sourceKey);
  }, [sourceKey, playbackKey]);

  const readyKeys = useMemo(() => {
    const ready = (keysQuery.data?.variants ?? [])
      .filter((v) => v.status === "ready")
      .map((v) => v.target_key);
    return sourceKey ? [sourceKey, ...ready] : ready;
  }, [keysQuery.data?.variants, sourceKey]);

  const resolvedRolePreview = (() => {
    try {
      return resolveUploadRole(role, customRole);
    } catch {
      return role;
    }
  })();
  const importingClick = isClickLikeRole(resolvedRolePreview);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_BYTES) {
        throw new Error("Arquivo excede 200 MB");
      }
      const resolvedRole = resolveUploadRole(role, customRole);
      if (isClickLikeRole(resolvedRole)) {
        const bpmValue = Number(importBpm.replace(",", "."));
        if (!Number.isFinite(bpmValue) || bpmValue < 20 || bpmValue > 400) {
          throw new Error("Informe o BPM do click (20–400)");
        }
        await updateMultitrack(multitrackId, { bpm: bpmValue });
      }
      return uploadMultitrackTrack(multitrackId, file, { role: resolvedRole });
    },
    onSuccess: () => {
      toast.success("Faixa importada");
      setPendingFile(null);
      setFileInputKey((value) => value + 1);
      void queryClient.invalidateQueries({ queryKey: ["multitrack", multitrackId] });
      void queryClient.invalidateQueries({ queryKey: ["multitracks"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const canImportTrack =
    Boolean(pendingFile) &&
    !uploadMutation.isPending &&
    (role !== "other" || customRole.trim().length > 0) &&
    (!importingClick || Boolean(importBpm.trim()));

  const saveMetaMutation = useMutation({
    mutationFn: (input: { bpm?: number; time_signature?: string }) =>
      updateMultitrack(multitrackId, input),
    onSuccess: (_data, input) => {
      toast.success(input.time_signature ? "Compasso atualizado" : "BPM atualizado");
      void queryClient.invalidateQueries({ queryKey: ["multitrack", multitrackId] });
      void queryClient.invalidateQueries({ queryKey: ["multitracks"] });
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

  const sourceRoot = sourceKey.replace(/m$/i, "");
  const sourceKeyDirty =
    editSourceKey !== sourceRoot || editSourceMode !== sourceMode;

  const saveSourceKeyMutation = useMutation({
    mutationFn: () =>
      updateMultitrack(multitrackId, {
        source_key: editSourceMode === "minor" ? `${editSourceKey}m` : editSourceKey,
        source_mode: editSourceMode,
      }),
    onSuccess: () => {
      toast.success("Tom de origem atualizado");
      setPlaybackKey(null);
      void queryClient.invalidateQueries({ queryKey: ["multitrack", multitrackId] });
      void queryClient.invalidateQueries({ queryKey: ["multitrack-keys", multitrackId] });
      void queryClient.invalidateQueries({ queryKey: ["multitracks"] });
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
            {mt.bpm ? `${mt.bpm} BPM` : "Sem BPM"}
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

      <div className={`${panelClass} space-y-3`}>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-medium">Tom de origem</h2>
            <p className="text-sm text-slate-400">
              Informe o tom real das faixas importadas — pode ser diferente do tom da música
              vinculada.
            </p>
          </div>
        </div>
        {canWrite ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block text-sm text-slate-300">
              Tom
              <select
                className={`${cifraSelectClass} mt-1`}
                value={editSourceKey}
                onChange={(event) => setEditSourceKey(event.target.value)}
              >
                {KEYS.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              Modo
              <select
                className={`${cifraSelectClass} mt-1`}
                value={editSourceMode}
                onChange={(event) =>
                  setEditSourceMode(event.target.value as "major" | "minor")
                }
              >
                <option value="major">Maior</option>
                <option value="minor">Menor</option>
              </select>
            </label>
            <button
              type="button"
              className={btnPrimary}
              disabled={!sourceKeyDirty || saveSourceKeyMutation.isPending}
              onClick={async () => {
                const variants = keysQuery.data?.variants ?? [];
                const hasVariants = variants.length > 0;
                if (hasVariants) {
                  const ok = await confirm({
                    title: "Alterar tom de origem",
                    message:
                      "As conversões de tom já geradas serão removidas e precisarão ser feitas de novo.",
                    confirmLabel: "Alterar tom",
                    danger: true,
                  });
                  if (!ok) return;
                }
                saveSourceKeyMutation.mutate();
              }}
            >
              {saveSourceKeyMutation.isPending ? "Salvando..." : "Salvar tom"}
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-200">
            {mt.source_key}
            {mt.source_mode === "minor" ? "m" : ""}
          </p>
        )}
      </div>

      {canWrite ? (
        <div className={`${panelClass} space-y-3`}>
          <h2 className="font-medium">Enviar faixas</h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block flex-1 text-sm text-slate-300">
              Papel
              <select
                className={`${cifraSelectClass} mt-1`}
                value={role}
                onChange={(event) => setRole(event.target.value)}
              >
                {ROLE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            {role === "other" ? (
              <label className="block flex-1 text-sm text-slate-300">
                Qual papel?
                <input
                  className={`${inputClass} mt-1 w-full`}
                  type="text"
                  maxLength={64}
                  placeholder="Ex.: sax, trompete, perc..."
                  value={customRole}
                  onChange={(event) => setCustomRole(event.target.value)}
                />
              </label>
            ) : null}
            {importingClick ? (
              <label className="block w-full text-sm text-slate-300 sm:w-28">
                BPM do click
                <input
                  className={`${inputClass} mt-1 w-full`}
                  type="number"
                  min={20}
                  max={400}
                  step={1}
                  placeholder="134"
                  value={importBpm}
                  onChange={(event) => setImportBpm(event.target.value)}
                />
              </label>
            ) : null}
            <label className="block flex-1 text-sm text-slate-300">
              Arquivo (até 200 MB)
              <input
                key={fileInputKey}
                className={`${inputClass} mt-1 w-full`}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac,.aac,.opus,.aiff"
                disabled={uploadMutation.isPending}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  if (file && file.size > MAX_BYTES) {
                    toast.error("Arquivo excede 200 MB");
                    event.currentTarget.value = "";
                    setPendingFile(null);
                    return;
                  }
                  setPendingFile(file);
                }}
              />
            </label>
            <button
              type="button"
              className={btnPrimary}
              disabled={!canImportTrack}
              onClick={() => {
                if (!pendingFile) return;
                uploadMutation.mutate(pendingFile);
              }}
            >
              {uploadMutation.isPending ? "Importando..." : "Importar"}
            </button>
          </div>
          {pendingFile ? (
            <p className="text-xs text-slate-400">
              Pronto para importar: <span className="text-slate-200">{pendingFile.name}</span>
            </p>
          ) : null}
          <p className="text-xs text-slate-500">
            Escolha o papel e o arquivo, depois clique em Importar. Ao importar click, informe o BPM
            real das faixas. Click/guide nascem com “não converter tom”.
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
        <MultitrackMixer
          multitrackId={mt.id}
          tracks={tracks}
          playbackKey={playbackKey === sourceKey ? null : playbackKey}
          bpm={mt.bpm}
          timeSignature={mt.time_signature ?? "4/4"}
          onBpmChange={
            canWrite
              ? (nextBpm) => {
                  saveMetaMutation.mutate({ bpm: nextBpm });
                }
              : undefined
          }
          onTimeSignatureChange={
            canWrite
              ? (nextSignature) => {
                  saveMetaMutation.mutate({ time_signature: nextSignature });
                }
              : undefined
          }
          onTrackMuteChange={(trackId, muted) => {
            if (!canWrite) return;
            void updateMultitrackTrack(mt.id, trackId, { muted });
          }}
          onTrackGainChange={(trackId, gain) => {
            if (!canWrite) return;
            void updateMultitrackTrack(mt.id, trackId, { gain });
          }}
        />
        {tracks.length === 0 ? (
          <p className="text-sm text-slate-400">Envie faixas para começar a ouvir.</p>
        ) : null}
      </div>

      <div className={`${panelClass} space-y-3`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">Faixas</h2>
            {!tracksExpanded ? (
              <p className="mt-0.5 text-xs text-slate-500">
                {tracks.length} faixa{tracks.length === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className={`${btnGhost} px-3 py-1.5 text-xs`}
            aria-expanded={tracksExpanded}
            onClick={() => setTracksExpanded((value) => !value)}
          >
            {tracksExpanded ? "Minimizar" : "Maximizar"}
          </button>
        </div>
        {tracksExpanded ? (
          tracks.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhuma faixa ainda.</p>
          ) : (
            <ul className="space-y-2">
              {tracks.map((track) => (
                <li
                  key={track.id}
                  className="flex flex-col gap-2 rounded-xl border border-white/10 px-3 py-2 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-100">{track.name}</p>
                    <p className="text-xs text-slate-500">
                      {roleLabel(track.role)}
                      {track.duration_seconds ? ` · ${track.duration_seconds.toFixed(1)}s` : ""}
                    </p>
                  </div>
                  {canWrite ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <TrackRoleEditor
                        role={track.role}
                        onChange={(nextRole) => {
                          void updateMultitrackTrack(mt.id, track.id, { role: nextRole }).then(() =>
                            queryClient.invalidateQueries({
                              queryKey: ["multitrack", multitrackId],
                            }),
                          );
                        }}
                      />
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
          )
        ) : null}
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
