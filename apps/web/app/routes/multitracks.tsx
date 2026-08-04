import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { useState } from "react";

import {
  createMultitrack,
  fetchMultitracks,
  MULTITRACK_TIME_SIGNATURES,
  type MultitrackTimeSignature,
} from "../lib/api";
import { useBand } from "../lib/band-context";
import { useToast } from "../lib/toast";
import {
  btnGhost,
  btnPrimary,
  cifraSelectClass,
  inputClass,
  panelClass,
} from "../lib/ui-classes";

const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export default function MultitracksPage() {
  const { activeBand } = useBand();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = Boolean(activeBand?.is_owner || activeBand?.can_analyze_songs);
  const blocked = Boolean(activeBand?.is_blocked);

  const [title, setTitle] = useState("");
  const [sourceKey, setSourceKey] = useState("C");
  const [sourceMode, setSourceMode] = useState<"major" | "minor">("major");
  const [bpm, setBpm] = useState("");
  const [timeSignature, setTimeSignature] = useState<MultitrackTimeSignature>("4/4");
  const [createOpen, setCreateOpen] = useState(false);

  const listQuery = useQuery({
    queryKey: ["multitracks", activeBand?.id],
    queryFn: () => fetchMultitracks({ limit: 50 }),
    enabled: Boolean(activeBand?.id),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createMultitrack({
        title: title.trim(),
        source_key: sourceMode === "minor" ? `${sourceKey}m` : sourceKey,
        source_mode: sourceMode,
        bpm: bpm ? Number(bpm) : null,
        time_signature: timeSignature,
      }),
    onSuccess: (created) => {
      toast.success("Multitrack criado");
      setCreateOpen(false);
      setTitle("");
      setBpm("");
      setTimeSignature("4/4");
      void queryClient.invalidateQueries({ queryKey: ["multitracks"] });
      window.location.href = `/multitracks/${created.id}`;
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const items = listQuery.data?.items ?? [];

  return (
    <section className="space-y-6 sm-animate-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="sm-page-title">Multitracks</h1>
          <p className="sm-page-subtitle">
            Cadastre faixas separadas para ensaio. Independente dos stems da análise.
          </p>
        </div>
        {canWrite && !blocked ? (
          <button type="button" className={btnPrimary} onClick={() => setCreateOpen((v) => !v)}>
            Novo Multitrack
          </button>
        ) : null}
      </div>

      {createOpen ? (
        <div className={`${panelClass} space-y-3`}>
          <h2 className="font-medium text-slate-100">Criar Multitrack</h2>
          <label className="block text-sm text-slate-300">
            Título
            <input
              className={`${inputClass} mt-1 w-full`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ex.: Sublime — ensaio"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm text-slate-300">
              Tom
              <select
                className={`${cifraSelectClass} mt-1`}
                value={sourceKey}
                onChange={(event) => setSourceKey(event.target.value)}
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
                value={sourceMode}
                onChange={(event) => setSourceMode(event.target.value as "major" | "minor")}
              >
                <option value="major">Maior</option>
                <option value="minor">Menor</option>
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              BPM (opcional)
              <input
                className={`${inputClass} mt-1 w-full`}
                value={bpm}
                onChange={(event) => setBpm(event.target.value)}
                inputMode="numeric"
                placeholder="72"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Compasso
              <select
                className={`${cifraSelectClass} mt-1`}
                value={timeSignature}
                onChange={(event) =>
                  setTimeSignature(event.target.value as MultitrackTimeSignature)
                }
              >
                {MULTITRACK_TIME_SIGNATURES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-slate-500">
            Use o tom real das faixas. Depois você ainda pode alterar o tom de origem no Multitrack.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btnPrimary}
              disabled={!title.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "Criando..." : "Criar"}
            </button>
            <button type="button" className={btnGhost} onClick={() => setCreateOpen(false)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {listQuery.isLoading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : items.length === 0 ? (
        <div className={panelClass}>
          <p className="text-sm text-slate-400">Nenhum Multitrack ainda.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className={panelClass}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h2 className="truncate font-medium text-slate-100">{item.title}</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Tom {item.source_key}
                    {item.source_mode === "minor" ? "m" : ""}
                    {" · "}
                    {item.track_count} faixa{item.track_count === 1 ? "" : "s"}
                    {item.bpm ? ` · ${item.bpm} BPM` : ""}
                    {item.song_id ? " · vinculado a música" : ""}
                  </p>
                </div>
                <Link to={`/multitracks/${item.id}`} className={`${btnPrimary} px-3 py-1.5 text-sm`}>
                  Abrir
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
