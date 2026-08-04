import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  fetchJob,
  fetchSongKeys,
  isJobFinished,
  requestSongKeyVariant,
} from "../../lib/api";
import { labelJobStage, labelQueuePosition } from "../../lib/status-labels";
import { useToast } from "../../lib/toast";
import { btnGhost, btnPrimary, cifraSelectClass, modalPanelClass } from "../../lib/ui-classes";

interface ConvertKeyModalProps {
  open: boolean;
  songId: string;
  songTitle: string;
  onClose: () => void;
}

export function ConvertKeyModal({ open, songId, songTitle, onClose }: ConvertKeyModalProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState("");
  const [convertingKey, setConvertingKey] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const keysQuery = useQuery({
    queryKey: ["song-keys", songId],
    queryFn: () => fetchSongKeys(songId),
    enabled: open,
  });

  const jobQuery = useQuery({
    queryKey: ["job", activeJobId],
    queryFn: () => fetchJob(activeJobId!),
    enabled: Boolean(activeJobId),
    refetchInterval: (query) =>
      query.state.data && isJobFinished(query.state.data.status) ? false : 2500,
  });

  useEffect(() => {
    if (!open) {
      // Minimizar: para o poll do modal; a linha da biblioteca continua acompanhando.
      setSelectedKey("");
      setConvertingKey(null);
      setActiveJobId(null);
      setError(null);
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !activeJobId) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, activeJobId]);

  // Ao reabrir (ex.: Minimizar → Acompanhar), retoma o job em andamento.
  useEffect(() => {
    if (!open || !keysQuery.data) return;
    const active = keysQuery.data.variants.find(
      (variant) => variant.status === "queued" || variant.status === "processing",
    );
    if (active?.job_id) {
      setConvertingKey(active.target_key);
      setSelectedKey(active.target_key);
      setActiveJobId(active.job_id);
    }
  }, [open, keysQuery.data]);

  const availableTargets = keysQuery.data?.available_targets ?? [];

  // Enquanto converte, o tom sai de available_targets — mantém-no visível no select.
  const selectOptions = useMemo(() => {
    const keys = [...availableTargets];
    const locked = convertingKey || selectedKey;
    if (locked && !keys.includes(locked)) {
      keys.unshift(locked);
    }
    return keys;
  }, [availableTargets, convertingKey, selectedKey]);

  useEffect(() => {
    if (!open || convertingKey || activeJobId) return;
    if (!selectedKey && availableTargets.length > 0) {
      setSelectedKey(availableTargets[0]!);
    }
  }, [open, availableTargets, selectedKey, convertingKey, activeJobId]);

  useEffect(() => {
    const job = jobQuery.data;
    if (!job || !isJobFinished(job.status)) return;
    void queryClient.invalidateQueries({ queryKey: ["song-keys", songId] });
    if (job.status === "completed") {
      toast.success(
        convertingKey
          ? `Tom ${convertingKey} convertido com sucesso.`
          : "Tom convertido com sucesso.",
      );
      setActiveJobId(null);
      setConvertingKey(null);
      onClose();
      return;
    }
    if (job.status === "failed" || job.status === "cancelled") {
      setError(job.error ?? "Falha na conversão de tom");
      setActiveJobId(null);
      setConvertingKey(null);
    }
  }, [jobQuery.data, onClose, queryClient, songId, toast, convertingKey]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selectedKey) throw new Error("Selecione um tom");
      return requestSongKeyVariant(songId, selectedKey);
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["song-keys", songId] });
      setSelectedKey(result.target_key);
      if (result.status === "ready") {
        toast.success(`Tom ${result.target_key} já está disponível.`);
        onClose();
        return;
      }
      if (result.job_id) {
        setConvertingKey(result.target_key);
        setActiveJobId(result.job_id);
        toast.success(`Conversão para ${result.target_key} iniciada.`);
        return;
      }
      toast.success(result.message ?? "Solicitação registrada.");
    },
    onError: (err: Error) => setError(err.message),
  });

  if (!open || typeof document === "undefined") return null;

  const sourceKey = keysQuery.data?.source_key ?? "—";
  const busy = mutation.isPending || Boolean(activeJobId);
  const job = jobQuery.data;
  const displayKey = convertingKey ?? selectedKey;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 p-4 backdrop-blur-sm sm:items-center"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className={`${modalPanelClass} flex max-h-[min(90vh,36rem)] w-full max-w-lg flex-col overflow-hidden p-0`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="convert-key-title"
      >
        <div className="shrink-0 border-b border-white/[0.06] px-5 py-4">
          <h2 id="convert-key-title" className="text-lg font-semibold text-slate-100">
            Converter tom
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Gera playback e stems em outro tom a partir da separação já feita — sem reanalisar.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {songTitle} · tom original <span className="text-green-300">{sourceKey}</span>
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {keysQuery.isLoading ? (
            <p className="text-sm text-slate-400">Carregando tons disponíveis...</p>
          ) : keysQuery.isError ? (
            <p className="text-sm text-red-400">
              {(keysQuery.error as Error).message || "Falha ao carregar tons"}
            </p>
          ) : selectOptions.length === 0 && !convertingKey ? (
            <p className="text-sm text-slate-400">
              Não há tons disponíveis para converter (todos já foram gerados ou estão na fila).
            </p>
          ) : busy && displayKey ? (
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-slate-500">Tom alvo</p>
              <p className="text-2xl font-medium text-green-300">{displayKey}</p>
            </div>
          ) : (
            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-wide text-slate-500">Tom alvo</span>
              <select
                className={cifraSelectClass}
                value={selectedKey}
                disabled={busy}
                onChange={(event) => setSelectedKey(event.target.value)}
              >
                {selectOptions.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </label>
          )}

          {job && activeJobId ? (
            <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-300">
              <p>
                Convertendo para <span className="text-green-300">{displayKey}</span>
                {" · "}
                {job.status === "queued"
                  ? (labelQueuePosition(job.queue_position, job.queue_total) ?? "Na fila")
                  : labelJobStage(job.stage)}
                {" · "}
                {job.progress}%
              </p>
              {job.error ? <p className="mt-1 text-red-300">{job.error}</p> : null}
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-400">{error}</p> : null}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-white/[0.06] px-5 py-4">
          <button
            type="button"
            className={btnGhost}
            disabled={mutation.isPending}
            onClick={onClose}
          >
            {activeJobId ? "Minimizar" : "Cancelar"}
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={busy || selectOptions.length === 0 || !selectedKey}
            onClick={() => {
              setError(null);
              mutation.mutate();
            }}
          >
            {mutation.isPending || activeJobId ? "Convertendo..." : "Converter"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
