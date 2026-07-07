import {
  collectUniqueDisplayChords,
  normalizeEditableSheet,
  replaceChordInSheetByDisplay,
  sheetFromImportedSections,
  type EditableCifraSheet,
} from "@softmusic/shared/cifra-layout";
import {
  buildCifraSheet,
  KEY_OPTIONS,
  transposeChord,
  transposeKey,
} from "@softmusic/shared/chords";
import { buildHarmonicField, chordToRoman, degreeLabel, chordToDegree, inferKeyFromChords } from "@softmusic/shared/harmony";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import {
  clearCifraKeyOverride,
  loadCifraKeyOverride,
  saveCifraKeyOverride,
  type CifraKeyOverride,
} from "./cifra-key";
import {
  fetchCifraVariations,
  importCifraVariationFromUrl,
  upsertCifraVariation,
  type CifraVariation,
  type CifraVariationSnapshot,
} from "./cifra-variations";
import {
  clearImportedCifraEdits,
  ImportedCifraEditor,
} from "./ImportedCifraEditor";
import { ImportCifraVariationModal } from "./ImportCifraVariationModal";
import {
  chordInputClass,
  chordNoteClass,
  cifraControlClass,
  cifraPanelClass,
  cifraSelectClass,
  btnPrimary,
} from "../../lib/ui-classes";
import { SaveCifraVariationModal } from "./SaveCifraVariationModal";
import { FoundChordsBar } from "./FoundChordsBar";

interface ImportedCifraSheet {
  original_key: string;
  mode: string;
  tempo_bpm: number;
  sections: Array<{
    id: string;
    label: string;
    lines: Array<{
      id: string;
      chords?: string[];
      lyrics: string;
      placements?: Array<{ id: string; chord: string; offset: number }>;
    }>;
  }>;
}

interface ChordData {
  song_id: string;
  title: string | null;
  artist: string | null;
  key: string;
  mode: string;
  tempo_bpm: number;
  source?: "analysis" | "cifra_club";
  cifra_club_url?: string;
  cifra_sheet?: ImportedCifraSheet;
  source_stem?: string;
  separated?: boolean;
  progression: Array<{
    start_seconds: number;
    end_seconds: number;
    chord: string;
    roman_numeral: string;
    function: string | null;
  }>;
  sections: Array<{
    type: string;
    start_seconds: number;
    end_seconds: number;
    confidence: number;
  }>;
}

interface CifraViewerProps {
  songId: string;
  songTitle: string;
  artist: string | null;
  chordData: ChordData;
  initialVariationId?: string;
}

function chordKey(sectionId: string, chordIndex: number): string {
  return `${sectionId}:${chordIndex}`;
}

const panelClass = cifraPanelClass;
const controlClass = cifraControlClass;
const selectClass = cifraSelectClass;

const TOOLS_MINIMIZED_MOBILE_KEY = "softmusic:cifra-tools-minimized-mobile";

function readToolsMinimizedMobile(): boolean {
  try {
    const stored = localStorage.getItem(TOOLS_MINIMIZED_MOBILE_KEY);
    if (stored === null) return true;
    return stored === "true";
  } catch {
    return true;
  }
}

function defaultTonicChord(key: string, mode: string): string {
  const field = buildHarmonicField(key, mode);
  return field[0]?.chord ?? key.replace(/m$/i, "") ?? "C";
}

export function CifraViewer({ songId, songTitle, artist, chordData, initialVariationId }: CifraViewerProps) {
  const {
    playing: scrollPlaying,
    speedMultiplier: autoScrollSpeed,
    setSpeedMultiplier: setAutoScrollSpeed,
    syncWithAudio: autoScrollSyncAudio,
    setSyncWithAudio: setAutoScrollSyncAudio,
    pixelsPerSecond: autoScrollPixelsPerSecond,
    bpm: scrollBpm,
  } = useCifraScroll();

  const importedSheet = chordData.source === "cifra_club" ? chordData.cifra_sheet : undefined;

  const baseSheet = useMemo(
    () =>
      importedSheet ??
      buildCifraSheet({
        key: chordData.key,
        mode: chordData.mode,
        tempo_bpm: chordData.tempo_bpm,
        progression: chordData.progression,
        sections: chordData.sections,
      }),
    [chordData, importedSheet],
  );

  const baseSectionChords = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const section of baseSheet.sections) {
      const firstLine = section.lines[0];
      if (!firstLine) {
        map[section.id] = [];
        continue;
      }
      if ("placements" in firstLine && firstLine.placements?.length) {
        map[section.id] = firstLine.placements.map((placement) => placement.chord);
      } else if ("chords" in firstLine && firstLine.chords && firstLine.chords.length > 0) {
        map[section.id] = firstLine.chords;
      } else {
        map[section.id] = [];
      }
    }
    return map;
  }, [baseSheet]);

  const editableBaseSections = useMemo(
    () =>
      sheetFromImportedSections(
        baseSheet.sections.map((section) => ({
          id: section.id,
          label: section.label,
          lines: section.lines.map((line) => ({
            id: line.id,
            lyrics: line.lyrics,
            chords: "chords" in line ? line.chords : undefined,
            placements: "placements" in line ? line.placements : undefined,
          })),
        })),
      ).sections,
    [baseSheet],
  );

  const [transposeSemitones, setTransposeSemitones] = useState(0);
  const [capo, setCapo] = useState(0);
  const [sectionChords, setSectionChords] = useState<Record<string, string[]>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [showDegrees, setShowDegrees] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [hasImportedEdits, setHasImportedEdits] = useState(false);
  const [importResetKey, setImportResetKey] = useState(0);
  const [importedSheetLive, setImportedSheetLive] = useState<EditableCifraSheet | null>(null);
  const [forcedImportedSheet, setForcedImportedSheet] = useState<EditableCifraSheet | null | undefined>(
    undefined,
  );
  const [variations, setVariations] = useState<CifraVariation[]>([]);
  const [activeVariationId, setActiveVariationId] = useState<string>("");
  const [saveVariationOpen, setSaveVariationOpen] = useState(false);
  const [importVariationOpen, setImportVariationOpen] = useState(false);
  const [keyOverride, setKeyOverride] = useState<CifraKeyOverride | null>(null);
  const [showKeyPicker, setShowKeyPicker] = useState(false);
  const [pickKey, setPickKey] = useState("C");
  const [pickMode, setPickMode] = useState<"major" | "minor">("major");
  const [toolsMinimizedMobile, setToolsMinimizedMobile] = useState(readToolsMinimizedMobile);
  const [cifraEditMode, setCifraEditMode] = useState(false);

  const toggleCifraEditMode = () => {
    setCifraEditMode((current) => {
      if (current) {
        setEditingKey(null);
      }
      return !current;
    });
  };

  const toggleToolsMinimizedMobile = () => {
    setToolsMinimizedMobile((current) => {
      const next = !current;
      try {
        localStorage.setItem(TOOLS_MINIMIZED_MOBILE_KEY, String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const effectiveKey = keyOverride?.key ?? chordData.key;
  const effectiveMode = keyOverride?.mode ?? chordData.mode;
  const importedKeyLabel = chordData.key.replace(/m$/i, "");
  const showImportedCifra = Boolean(importedSheet || forcedImportedSheet || importedSheetLive);

  useEffect(() => {
    let cancelled = false;
    void fetchCifraVariations(chordData.song_id).then((items) => {
      if (!cancelled) {
        setVariations(items);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [chordData.song_id]);

  useEffect(() => {
    setKeyOverride(loadCifraKeyOverride(chordData.song_id));
  }, [chordData.song_id]);

  useEffect(() => {
    const storageKey = `softmusic:cifra:${chordData.song_id}`;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        setSectionChords(JSON.parse(saved) as Record<string, string[]>);
      } else {
        setSectionChords({});
      }
    } catch {
      setSectionChords({});
    }
    setEditingKey(null);
    setCifraEditMode(false);
    setTransposeSemitones(0);
    setCapo(0);
    setHydrated(true);
  }, [chordData.song_id, baseSectionChords]);

  useEffect(() => {
    if (!hydrated) return;

    const storageKey = `softmusic:cifra:${chordData.song_id}`;
    if (Object.keys(sectionChords).length === 0) {
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify(sectionChords));
  }, [sectionChords, chordData.song_id, hydrated]);

  const effectiveTranspose = transposeSemitones - capo;
  const currentKey = transposeKey(effectiveKey, effectiveMode, effectiveTranspose);
  const defaultNewChord = defaultTonicChord(effectiveKey, effectiveMode);

  const getOriginalChords = (sectionId: string): string[] =>
    sectionChords[sectionId] ?? baseSectionChords[sectionId] ?? [];

  const setOriginalChords = (sectionId: string, chords: string[]) => {
    setSectionChords((current) => ({ ...current, [sectionId]: chords }));
  };

  const toDisplayChord = (chord: string) => transposeChord(chord, effectiveTranspose);

  const toOriginalChord = (displayChord: string) => transposeChord(displayChord, -effectiveTranspose);

  const addChord = (sectionId: string) => {
    const chords = [...getOriginalChords(sectionId), defaultNewChord];
    setOriginalChords(sectionId, chords);
    setEditingKey(chordKey(sectionId, chords.length - 1));
  };

  const removeChord = (sectionId: string, chordIndex: number) => {
    const chords = getOriginalChords(sectionId).filter((_, index) => index !== chordIndex);
    setOriginalChords(sectionId, chords);
    if (editingKey === chordKey(sectionId, chordIndex)) {
      setEditingKey(null);
    }
  };

  const updateChord = (sectionId: string, chordIndex: number, displayValue: string) => {
    const trimmed = displayValue.trim();
    if (!trimmed) {
      removeChord(sectionId, chordIndex);
      return;
    }
    const chords = [...getOriginalChords(sectionId)];
    chords[chordIndex] = toOriginalChord(trimmed);
    setOriginalChords(sectionId, chords);
    setEditingKey(null);
  };

  const restoreCifra = () => {
    setSectionChords({});
    setEditingKey(null);
    setCifraEditMode(false);
    setTransposeSemitones(0);
    setCapo(0);
    setHasImportedEdits(false);
    setActiveVariationId("");
    setForcedImportedSheet(null);
    setImportedSheetLive(null);
    setKeyOverride(null);
    clearCifraKeyOverride(chordData.song_id);
    localStorage.removeItem(`softmusic:cifra:${chordData.song_id}`);
    if (importedSheet) {
      clearImportedCifraEdits(chordData.song_id);
      setImportResetKey((value) => value + 1);
    }
  };

  const buildVariationSnapshot = useCallback((): CifraVariationSnapshot => {
    const baseImportedSheet = sheetFromImportedSections(baseSheet.sections);
    const activeImportedSheet = importedSheetLive ?? forcedImportedSheet ?? null;
    const hasImported = Boolean(importedSheet || activeImportedSheet);
    return {
      transposeSemitones,
      capo,
      sectionChords,
      isImported: hasImported,
      importedSheet: hasImported ? (activeImportedSheet ?? baseImportedSheet) : null,
      keyOverride,
    };
  }, [
    transposeSemitones,
    capo,
    sectionChords,
    importedSheet,
    importedSheetLive,
    forcedImportedSheet,
    baseSheet.sections,
    keyOverride,
  ]);

  const applyVariationSnapshot = useCallback(
    (snapshot: CifraVariationSnapshot) => {
      setTransposeSemitones(snapshot.transposeSemitones);
      setCapo(snapshot.capo);
      setSectionChords(snapshot.sectionChords);
      setEditingKey(null);
      setKeyOverride(snapshot.keyOverride ?? null);
      if (snapshot.keyOverride) {
        saveCifraKeyOverride(chordData.song_id, snapshot.keyOverride);
      } else {
        clearCifraKeyOverride(chordData.song_id);
      }

      const sectionStorageKey = `softmusic:cifra:${chordData.song_id}`;
      if (Object.keys(snapshot.sectionChords).length === 0) {
        localStorage.removeItem(sectionStorageKey);
      } else {
        localStorage.setItem(sectionStorageKey, JSON.stringify(snapshot.sectionChords));
      }

      if (snapshot.isImported && snapshot.importedSheet) {
        const normalizedSheet = normalizeEditableSheet(snapshot.importedSheet);
        localStorage.setItem(
          `softmusic:cifra-sheet:${chordData.song_id}`,
          JSON.stringify(normalizedSheet),
        );
        setForcedImportedSheet(normalizedSheet);
        setImportedSheetLive(normalizedSheet);
        setImportResetKey((value) => value + 1);
      } else if (importedSheet) {
        if (snapshot.importedSheet) {
          const normalizedSheet = normalizeEditableSheet(snapshot.importedSheet);
          localStorage.setItem(
            `softmusic:cifra-sheet:${chordData.song_id}`,
            JSON.stringify(normalizedSheet),
          );
          setForcedImportedSheet(normalizedSheet);
          setImportedSheetLive(normalizedSheet);
        } else {
          clearImportedCifraEdits(chordData.song_id);
          setForcedImportedSheet(null);
          setImportedSheetLive(null);
        }
        setImportResetKey((value) => value + 1);
      }
    },
    [chordData.song_id, importedSheet],
  );

  const handleSaveVariation = async (name: string) => {
    const saved = upsertCifraVariation(chordData.song_id, name, buildVariationSnapshot());
    const items = await fetchCifraVariations(chordData.song_id);
    setVariations(items.length > 0 ? items : [saved]);
    setActiveVariationId(saved.id);
    setSaveVariationOpen(false);
  };

  const handleImportVariation = async (cifraClubUrl: string) => {
    const variation = await importCifraVariationFromUrl(chordData.song_id, cifraClubUrl);
    const items = await fetchCifraVariations(chordData.song_id);
    setVariations(items);
    setActiveVariationId(variation.id);
    applyVariationSnapshot(variation.snapshot);
    setImportVariationOpen(false);
  };

  const handleVariationSelect = (variationId: string) => {
    setActiveVariationId(variationId);
    if (!variationId) return;
    const variation = variations.find((entry) => entry.id === variationId);
    if (!variation) return;
    applyVariationSnapshot(variation.snapshot);
  };

  useEffect(() => {
    if (!initialVariationId || variations.length === 0) return;
    const variation = variations.find((entry) => entry.id === initialVariationId);
    if (!variation) return;
    setActiveVariationId(variation.id);
    applyVariationSnapshot(variation.snapshot);
  }, [initialVariationId, variations, applyVariationSnapshot]);

  const foundChords = useMemo(() => {
    if (showImportedCifra) {
      const sheet = importedSheetLive ?? forcedImportedSheet ?? sheetFromImportedSections(baseSheet.sections);
      return collectUniqueDisplayChords(sheet, toDisplayChord);
    }

    const seen = new Set<string>();
    const chords: string[] = [];
    for (const section of baseSheet.sections) {
      for (const chord of getOriginalChords(section.id)) {
        const display = toDisplayChord(chord);
        if (!display || seen.has(display)) continue;
        seen.add(display);
        chords.push(display);
      }
    }
    return chords;
  }, [
    importedSheet,
    importedSheetLive,
    baseSheet.sections,
    sectionChords,
    baseSectionChords,
    effectiveTranspose,
  ]);

  const collectAllOriginalChords = useCallback((): string[] => {
    if (showImportedCifra) {
      const sheet =
        importedSheetLive ??
        forcedImportedSheet ??
        sheetFromImportedSections(
          baseSheet.sections.map((section) => ({
            id: section.id,
            label: section.label,
            lines: section.lines.map((line) => ({
              id: line.id,
              lyrics: line.lyrics,
              chords: "chords" in line ? line.chords : undefined,
              placements: "placements" in line ? line.placements : undefined,
            })),
          })),
        );
      const chords: string[] = [];
      for (const section of sheet.sections) {
        for (const line of section.lines) {
          for (const placement of line.placements) {
            chords.push(placement.chord);
          }
        }
      }
      return chords;
    }

    const chords: string[] = [];
    for (const section of baseSheet.sections) {
      chords.push(...(sectionChords[section.id] ?? baseSectionChords[section.id] ?? []));
    }
    return chords;
  }, [importedSheet, importedSheetLive, baseSheet.sections, sectionChords, baseSectionChords]);

  const handleOpenKeyPicker = () => {
    const inferred = inferKeyFromChords(collectAllOriginalChords());
    setPickKey(inferred?.key ?? effectiveKey.replace(/m$/i, ""));
    setPickMode((inferred?.mode ?? effectiveMode) === "minor" ? "minor" : "major");
    setShowKeyPicker(true);
  };

  const handleDetectKey = () => {
    const inferred = inferKeyFromChords(collectAllOriginalChords());
    if (!inferred) {
      window.alert("Não foi possível inferir o tom a partir dos acordes da cifra.");
      return;
    }
    setPickKey(inferred.key);
    setPickMode(inferred.mode);
  };

  const handleApplyKeyOverride = () => {
    const next: CifraKeyOverride = { key: pickKey, mode: pickMode };
    setKeyOverride(next);
    saveCifraKeyOverride(chordData.song_id, next);
    setShowKeyPicker(false);
  };

  const handleClearKeyOverride = () => {
    setKeyOverride(null);
    clearCifraKeyOverride(chordData.song_id);
    setShowKeyPicker(false);
  };

  const handleGlobalChordReplace = (fromDisplay: string, toDisplay: string) => {
    const trimmedTo = toDisplay.trim();
    if (!trimmedTo || fromDisplay === trimmedTo) return;

    if (showImportedCifra) {
      const current = importedSheetLive ?? forcedImportedSheet ?? sheetFromImportedSections(baseSheet.sections);
      const next = replaceChordInSheetByDisplay(
        current,
        fromDisplay,
        trimmedTo,
        toOriginalChord,
        toDisplayChord,
      );
      localStorage.setItem(`softmusic:cifra-sheet:${chordData.song_id}`, JSON.stringify(next));
      setForcedImportedSheet(next);
      setImportedSheetLive(next);
      setImportResetKey((value) => value + 1);
      return;
    }

    setSectionChords((current) => {
      const next = { ...current };
      for (const section of baseSheet.sections) {
        const chords = current[section.id] ?? baseSectionChords[section.id] ?? [];
        const updated = chords.map((chord) =>
          toDisplayChord(chord) === fromDisplay ? toOriginalChord(trimmedTo) : chord,
        );
        if (updated.some((chord, index) => chord !== chords[index])) {
          next[section.id] = updated;
        }
      }
      return next;
    });
    setEditingKey(null);
  };

  const hasManualEdits =
    Object.keys(sectionChords).length > 0 ||
    transposeSemitones !== 0 ||
    capo !== 0 ||
    hasImportedEdits ||
    keyOverride !== null;

  return (
    <div className="min-w-0 max-w-full space-y-4">
      <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-100/90">
        {showImportedCifra ? (
          <p>
            <strong className="text-emerald-200">Cifra importada do Cifra Club.</strong> Acordes e letra
            foram copiados do link informado na análise
            {chordData.cifra_club_url ? (
              <>
                {" "}
                (
                <a
                  href={chordData.cifra_club_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-100 underline"
                >
                  ver original
                </a>
                )
              </>
            ) : null}
            . Clique nos acordes para editar, use ◀ ▶ para reposicionar, × para remover, clique na letra para posicionar acorde, o{" "}
            <strong className="text-emerald-200">lápis</strong> para editar letra/notas da linha, ou{" "}
            <strong className="text-emerald-200">+ Linha</strong> para adicionar uma nova.
          </p>
        ) : (
          <p>
            <strong className="text-amber-200">Cifra automática.</strong> A detecção pode errar acordes
            (ex.: intro esperada <span className="font-mono text-amber-100">A · F#m · D</span>). Use{" "}
            <strong className="text-amber-200">+</strong> para incluir, clique para editar e{" "}
            <strong className="text-amber-200">×</strong> para remover — ou envie o link do Cifra Club na
            próxima análise.
          </p>
        )}
        {!showImportedCifra && chordData.separated ? (
          <p className="mt-2 text-emerald-200/90">
            Acordes estimados a partir do stem violão/teclado (Demucs), não do mix completo.
          </p>
        ) : null}
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside
          className={`space-y-3 text-sm text-slate-300 lg:sticky lg:top-6 lg:self-start ${
            toolsMinimizedMobile ? "rounded-xl border border-slate-800 bg-slate-900/60 p-3 lg:p-4" : panelClass
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-slate-100">Ferramentas</p>
              {toolsMinimizedMobile ? (
                <p className="mt-0.5 truncate text-xs text-slate-500 lg:hidden">
                  Tom {currentKey}
                  {capo > 0 ? ` · Capo ${capo}` : ""}
                  {scrollPlaying ? " · Rolagem ativa" : ""}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={toggleToolsMinimizedMobile}
              className="shrink-0 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100 lg:hidden"
              aria-expanded={!toolsMinimizedMobile}
            >
              {toolsMinimizedMobile ? "Expandir" : "Minimizar"}
            </button>
          </div>

          <div className={`space-y-3 ${toolsMinimizedMobile ? "hidden lg:block" : ""}`}>
          <button
            type="button"
            className={`${controlClass} w-full text-left disabled:cursor-not-allowed disabled:opacity-40`}
            onClick={restoreCifra}
            disabled={!hasManualEdits}
          >
            Restaurar cifra
          </button>

          <div className={`${panelClass} !p-3`}>
            <label className="mb-2 block text-xs uppercase tracking-wide text-slate-500">
              Variações salvas
            </label>
            <select
              className={selectClass}
              value={activeVariationId}
              onChange={(event) => handleVariationSelect(event.target.value)}
            >
              <option value="">Edição atual</option>
              {variations.map((variation) => (
                <option key={variation.id} value={variation.id}>
                  {variation.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`${controlClass} mt-2 w-full text-center text-green-300 hover:text-green-200`}
              onClick={() => setSaveVariationOpen(true)}
            >
              Salvar variação
            </button>
            <button
              type="button"
              className={`${controlClass} mt-2 w-full text-center text-emerald-300 hover:text-emerald-200`}
              onClick={() => setImportVariationOpen(true)}
            >
              Importar nova variação
            </button>
          </div>

          <div className={`${panelClass} !p-3`}>
            <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Tom</p>
            <p className="mb-3 text-2xl chord-note">{currentKey}</p>
            <div className="flex items-center justify-between gap-1">
              <button
                type="button"
                className={`${controlClass} px-2 py-1 text-xs`}
                onClick={() => setTransposeSemitones((value) => value - 1)}
              >
                − ½ tom
              </button>
              <button
                type="button"
                className={`${controlClass} px-2 py-1 text-xs`}
                onClick={() => setTransposeSemitones(0)}
              >
                Original
              </button>
              <button
                type="button"
                className={`${controlClass} px-2 py-1 text-xs`}
                onClick={() => setTransposeSemitones((value) => value + 1)}
              >
                + ½ tom
              </button>
            </div>
            <select
              className={`${selectClass} mt-3`}
              value={currentKey.replace("m", "")}
              onChange={(event) => {
                const target = event.target.value;
                const originalRoot = effectiveKey.replace(/m/i, "");
                const fromIndex = KEY_OPTIONS.indexOf(originalRoot as (typeof KEY_OPTIONS)[number]);
                const toIndex = KEY_OPTIONS.indexOf(target as (typeof KEY_OPTIONS)[number]);
                if (fromIndex >= 0 && toIndex >= 0) {
                  setTransposeSemitones(toIndex - fromIndex + capo);
                }
              }}
            >
              {KEY_OPTIONS.map((note) => (
                <option key={note} value={note}>
                  {note}
                </option>
              ))}
            </select>
          </div>

          <div className={`${panelClass} !p-3`}>
            <label className="mb-2 block text-xs uppercase tracking-wide text-slate-500">
              Capotraste
            </label>
            <select
              className={selectClass}
              value={capo}
              onChange={(event) => setCapo(Number(event.target.value))}
            >
              {Array.from({ length: 13 }, (_, fret) => (
                <option key={fret} value={fret}>
                  {fret === 0 ? "Sem capo" : `Casa ${fret}`}
                </option>
              ))}
            </select>
          </div>

          <div className={`${panelClass} !p-3`}>
            <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Rolagem automática</p>
            <p className="mb-3 text-xs text-slate-400">
              Use o botão <strong className="text-green-300">▶ Rolagem</strong> na barra de áudio
              {scrollPlaying ? (
                <span className="text-green-300"> (ativa agora)</span>
              ) : null}
              .
            </p>

            <label className="block text-xs text-slate-400">
              Velocidade ({Math.round(autoScrollSpeed * 100)}%)
              <input
                type="range"
                min={50}
                max={200}
                step={5}
                value={Math.round(autoScrollSpeed * 100)}
                onChange={(event) => setAutoScrollSpeed(Number(event.target.value) / 100)}
                className="mt-2 w-full accent-chord"
              />
            </label>

            <label className="mt-3 flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={autoScrollSyncAudio}
                onChange={(event) => setAutoScrollSyncAudio(event.target.checked)}
                className="rounded border-slate-600 bg-slate-950 text-green-500 focus:ring-green-500/40"
              />
              <span className="text-xs text-slate-400">
                Ao iniciar rolagem, tocar o áudio e pausar junto
              </span>
            </label>

            <button
              type="button"
              className={`${controlClass} mt-3 w-full text-center text-xs`}
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            >
              Voltar ao topo
            </button>

            <p className="mt-3 text-xs text-slate-500">
              Velocidade baseada em {scrollBpm.toFixed(0)} BPM (~
              {autoScrollPixelsPerSecond.toFixed(0)} px/s).
            </p>
          </div>

          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-800 px-3 py-2">
            <input
              type="checkbox"
              checked={showDegrees}
              onChange={(event) => setShowDegrees(event.target.checked)}
              className="rounded border-slate-600 bg-slate-950 text-green-500 focus:ring-green-500/40"
            />
            <span className="text-xs text-slate-400">Mostrar graus do campo harmônico</span>
          </label>

          <p className="text-xs text-slate-500">
            Novo acorde usa a tônica ({defaultNewChord}) · BPM {chordData.tempo_bpm.toFixed(0)}
          </p>

          <Link
            to={`/songs/${songId}`}
            className={`${controlClass} block text-center text-green-300 hover:text-green-200`}
          >
            Ver análise completa
          </Link>
          </div>
        </aside>

        <article className={`${panelClass} min-w-0 max-w-full p-4 sm:p-6`}>
          <header className="mb-8 border-b border-slate-800 pb-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-green-400">{artist ?? "Artista desconhecido"}</p>
                <h1 className="mt-1 break-words text-2xl font-bold text-slate-100 sm:text-3xl">{songTitle}</h1>
              </div>
              <button
                type="button"
                onClick={toggleCifraEditMode}
                className={`shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                  cifraEditMode
                    ? "border-green-500/60 bg-green-500/15 text-green-200 hover:bg-green-500/25"
                    : "border-slate-700 bg-slate-950/50 text-slate-200 hover:border-slate-500 hover:bg-slate-900"
                }`}
                aria-pressed={cifraEditMode}
              >
                {cifraEditMode ? "Concluir" : "Editar"}
              </button>
            </div>
            <div className="mt-3 space-y-2">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-slate-400">
                <span>
                  Tom: <strong className="text-green-400">{currentKey}</strong>
                  {capo > 0 ? ` · Capo ${capo}` : null}
                  <span className="mx-2 text-slate-700">·</span>
                  {effectiveMode === "minor" ? "menor" : "maior"}
                </span>
                {showImportedCifra ? (
                  <>
                    <button
                      type="button"
                      className="rounded-lg border border-green-800/60 bg-green-950/30 px-2.5 py-1 text-xs text-green-200 transition hover:border-green-500/50 hover:bg-green-950/50"
                      onClick={() => (showKeyPicker ? setShowKeyPicker(false) : handleOpenKeyPicker())}
                    >
                      {showKeyPicker ? "Fechar" : "Corrigir TOM"}
                    </button>
                    {keyOverride ? (
                      <>
                        <span className="text-xs text-slate-500">
                          importado: {importedKeyLabel} {chordData.mode === "minor" ? "menor" : "maior"}
                        </span>
                        <button
                          type="button"
                          className="text-xs text-slate-500 underline decoration-slate-700 underline-offset-2 hover:text-slate-300"
                          onClick={handleClearKeyOverride}
                        >
                          usar importado
                        </button>
                      </>
                    ) : null}
                  </>
                ) : null}
              </p>

              {showImportedCifra && showKeyPicker ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    Nota
                    <select
                      className={`${selectClass} w-auto min-w-[4.5rem]`}
                      value={pickKey}
                      onChange={(event) => setPickKey(event.target.value)}
                    >
                      {KEY_OPTIONS.map((note) => (
                        <option key={note} value={note}>
                          {note}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    Modo
                    <select
                      className={`${selectClass} w-auto min-w-[5.5rem]`}
                      value={pickMode}
                      onChange={(event) =>
                        setPickMode(event.target.value === "minor" ? "minor" : "major")
                      }
                    >
                      <option value="major">maior</option>
                      <option value="minor">menor</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="sm-btn-primary px-3 py-2 text-xs"
                    onClick={handleApplyKeyOverride}
                  >
                    Aplicar
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-slate-500"
                    onClick={handleDetectKey}
                  >
                    Detectar dos acordes
                  </button>
                </div>
              ) : null}
            </div>
            <FoundChordsBar
              chords={foundChords}
              onReplace={handleGlobalChordReplace}
              editable={cifraEditMode}
            />
          </header>

          <div className="space-y-10 font-mono text-[15px] leading-8">
            {showImportedCifra ? (
              <ImportedCifraEditor
                key={importResetKey}
                songId={chordData.song_id}
                baseSections={editableBaseSections}
                transposeSemitones={effectiveTranspose}
                defaultNewChord={defaultNewChord}
                editable={cifraEditMode}
                onEditsChange={setHasImportedEdits}
                onSheetChange={setImportedSheetLive}
                forcedSheet={forcedImportedSheet}
                reloadToken={importResetKey}
              />
            ) : (
              baseSheet.sections.map((section) => {
              const originalChords = getOriginalChords(section.id);
              const displayChords = originalChords.map((chord) => toDisplayChord(chord));

              return (
                <section key={section.id}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h2 className="font-bold text-slate-200">[{section.label}]</h2>
                    {cifraEditMode ? (
                      <button
                        type="button"
                        className="rounded-full border border-dashed border-slate-600 px-2.5 py-0.5 text-xs text-slate-400 transition hover:border-green-500/60 hover:text-green-400"
                        onClick={() => addChord(section.id)}
                      >
                        + acorde
                      </button>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
                    {displayChords.map((chord, chordIndex) => {
                      const key = chordKey(section.id, chordIndex);
                      const isEditing = editingKey === key;
                      const degree = chordToDegree(chord, currentKey, effectiveMode);
                      const roman = chordToRoman(chord, currentKey, effectiveMode);

                      return (
                        <div key={key} className="group relative min-w-[3.5rem] text-center">
                          {cifraEditMode ? (
                            <button
                              type="button"
                              className="absolute -right-2 -top-2 hidden h-4 w-4 items-center justify-center rounded-full bg-slate-800 text-[10px] text-slate-400 ring-1 ring-slate-700 group-hover:flex hover:bg-red-950 hover:text-red-300"
                              onClick={() => removeChord(section.id, chordIndex)}
                              title="Remover acorde"
                            >
                              ×
                            </button>
                          ) : null}

                          {isEditing ? (
                            <input
                              autoFocus
                              defaultValue={chord}
                              className="chord-note-input w-20 px-1 py-0.5"
                              onBlur={(event) =>
                                updateChord(section.id, chordIndex, event.target.value)
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  updateChord(section.id, chordIndex, event.currentTarget.value);
                                }
                                if (event.key === "Escape") {
                                  setEditingKey(null);
                                }
                              }}
                            />
                          ) : cifraEditMode ? (
                            <button
                              type="button"
                              className="chord-note transition hover:text-green-300"
                              onClick={() => setEditingKey(key)}
                              title="Clique para editar o acorde"
                            >
                              {chord}
                            </button>
                          ) : (
                            <span className="chord-note">{chord}</span>
                          )}
                          {showDegrees ? (
                            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                              {degree ? `${degreeLabel(degree)} · ${roman}` : roman}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}

                    {cifraEditMode ? (
                      <button
                        type="button"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-dashed border-slate-600 text-lg text-slate-500 transition hover:border-green-500/60 hover:bg-green-500/5 hover:text-green-400"
                        onClick={() => addChord(section.id)}
                        title="Adicionar acorde nesta seção"
                      >
                        +
                      </button>
                    ) : null}
                  </div>

                  {displayChords.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-600">
                      Nenhum acorde nesta seção. Clique em <strong>+</strong> para montar a cifra.
                    </p>
                  ) : null}
                </section>
              );
            })
            )}
          </div>
        </article>
      </div>

      <SaveCifraVariationModal
        open={saveVariationOpen}
        defaultName={
          activeVariationId
            ? (variations.find((variation) => variation.id === activeVariationId)?.name ?? "")
            : ""
        }
        onClose={() => setSaveVariationOpen(false)}
        onSave={handleSaveVariation}
      />

      <ImportCifraVariationModal
        open={importVariationOpen}
        onClose={() => setImportVariationOpen(false)}
        onImport={handleImportVariation}
      />
    </div>
  );
}
