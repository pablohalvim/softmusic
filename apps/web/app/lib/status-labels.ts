import type { Job, SongSummary } from "./api";

const jobStatusLabels: Record<Job["status"], string> = {
  queued: "Na fila",
  processing: "Processando",
  completed: "Concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
};

const songStatusLabels: Record<SongSummary["status"], string> = {
  pending: "Aguardando",
  processing: "Processando",
  completed: "Concluída",
  failed: "Falhou",
};

const stageLabels: Record<string, string> = {
  validate: "Validando arquivo",
  download: "Baixando áudio",
  normalize: "Normalizando áudio",
  convert: "Convertendo formato",
  trim_silence: "Removendo silêncio",
  separate_stems: "Separando instrumentos",
  analyze_stems: "Analisando harmonia e ritmo",
  import_cifra: "Importando cifra do Cifra Club",
  merge: "Consolidando resultados",
  knowledge_graph: "Montando grafo musical",
  explain: "Gerando explicações",
  persist: "Salvando análise",
};

export function labelJobStatus(status: Job["status"]): string {
  return jobStatusLabels[status];
}

export function labelSongStatus(status: SongSummary["status"]): string {
  return songStatusLabels[status];
}

export function labelJobStage(stage: string | null): string {
  if (!stage) {
    return "Preparando...";
  }
  return stageLabels[stage] ?? stage;
}

export function statusTone(
  status: Job["status"] | SongSummary["status"],
): "neutral" | "active" | "success" | "error" {
  if (status === "completed") return "success";
  if (status === "failed" || status === "cancelled") return "error";
  if (status === "processing" || status === "queued" || status === "pending") return "active";
  return "neutral";
}
