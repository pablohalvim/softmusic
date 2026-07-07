import {
  buildChordRowChars,
  lineContentWidth,
  lineFromNotasAndLetra,
  lineMaxChordOffset,
  newPlacementId,
  normalizeEditableSheet,
  parseChordTokens,
  placementsToChordList,
  sheetFromImportedSections,
  updateLineNotasAndLetra,
  type ChordPlacement,
  type EditableCifraSheet,
} from "@softmusic/shared/cifra-layout";
import { transposeChord } from "@softmusic/shared/chords";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { CifraLineModal } from "./AddCifraLineModal";

interface ImportedCifraEditorProps {
  songId: string;
  baseSections: EditableCifraSheet["sections"];
  transposeSemitones: number;
  defaultNewChord: string;
  editable?: boolean;
  onEditsChange?: (hasEdits: boolean) => void;
  onSheetChange?: (sheet: EditableCifraSheet) => void;
  forcedSheet?: EditableCifraSheet | null;
  reloadToken?: number;
}

interface LineModalTarget {
  mode: "add" | "edit";
  sectionId?: string;
  lineId?: string;
  initialNotas: string;
  initialLetra: string;
}

function placementKey(lineId: string, placementId: string): string {
  return `${lineId}:${placementId}`;
}

interface ActiveChordMenu {
  key: string;
  sectionId: string;
  lineId: string;
  placement: ChordPlacement;
  sectionLabel: string;
  anchor: DOMRect;
}

const chordMenuClass =
  "flex min-w-[9rem] flex-col gap-1.5 rounded-lg border border-slate-600 bg-slate-900 p-2 shadow-xl";

const pencilIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 20 20"
    fill="currentColor"
    className="h-4 w-4"
    aria-hidden
  >
    <path d="m2.695 14.762-1.262 3.155a.5.5 0 0 0 .65.65l3.155-1.262a4 4 0 0 0 1.343-.886L17.5 5.501a2.121 2.121 0 0 0-3-3L3.58 13.42a4 4 0 0 0-.885 1.343Z" />
  </svg>
);

export function ImportedCifraEditor({
  songId,
  baseSections,
  transposeSemitones,
  defaultNewChord,
  editable = false,
  onEditsChange,
  onSheetChange,
  forcedSheet,
  reloadToken = 0,
}: ImportedCifraEditorProps) {
  const storageKey = `softmusic:cifra-sheet:${songId}`;
  const baseSheet = useMemo(() => sheetFromImportedSections(baseSections), [baseSections]);

  const [sheet, setSheet] = useState<EditableCifraSheet>(() => sheetFromImportedSections(baseSections));
  const [activeMenu, setActiveMenu] = useState<ActiveChordMenu | null>(null);
  const [lineModal, setLineModal] = useState<LineModalTarget | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const selectedKey = activeMenu?.key ?? null;

  useEffect(() => {
    try {
      if (forcedSheet !== undefined) {
        setSheet(
          forcedSheet ? normalizeEditableSheet(forcedSheet) : sheetFromImportedSections(baseSections),
        );
      } else {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          setSheet(normalizeEditableSheet(JSON.parse(saved) as EditableCifraSheet));
        } else {
          setSheet(sheetFromImportedSections(baseSections));
        }
      }
    } catch {
      setSheet(sheetFromImportedSections(baseSections));
    }
    setActiveMenu(null);
    setHydrated(true);
  }, [songId, baseSections, storageKey, forcedSheet, reloadToken]);

  useEffect(() => {
    if (!hydrated) return;
    const baseJson = JSON.stringify(sheetFromImportedSections(baseSections));
    const currentJson = JSON.stringify(sheet);
    const hasEdits = baseJson !== currentJson;
    onEditsChange?.(hasEdits);
    onSheetChange?.(sheet);
    if (hasEdits) {
      localStorage.setItem(storageKey, currentJson);
    } else {
      localStorage.removeItem(storageKey);
    }
  }, [sheet, hydrated, baseSections, storageKey, onEditsChange, onSheetChange]);

  useEffect(() => {
    if (!editable) {
      setActiveMenu(null);
      setLineModal(null);
    }
  }, [editable]);

  useEffect(() => {
    if (!editable) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-chord-menu]") || target.closest("[data-chord-trigger]")) {
        return;
      }
      setActiveMenu(null);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [editable]);

  useEffect(() => {
    if (!activeMenu) return;
    const close = () => setActiveMenu(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [activeMenu]);

  const updateLine = useCallback(
    (sectionId: string, lineId: string, updater: (placements: ChordPlacement[]) => ChordPlacement[]) => {
      setSheet((current) => ({
        sections: current.sections.map((section) =>
          section.id !== sectionId
            ? section
            : {
                ...section,
                lines: section.lines.map((line) =>
                  line.id !== lineId
                    ? line
                    : { ...line, placements: updater(line.placements) },
                ),
              },
        ),
      }));
    },
    [],
  );

  const toDisplayChord = (chord: string) => transposeChord(chord, transposeSemitones);
  const toOriginalChord = (displayChord: string) =>
    transposeChord(displayChord, -transposeSemitones);

  const lineToDisplayNotas = (
    line: EditableCifraSheet["sections"][number]["lines"][number],
  ): string => {
    return placementsToChordList(line.placements).map(toDisplayChord).join(" ");
  };

  const removePlacement = (sectionId: string, lineId: string, placementId: string) => {
    updateLine(sectionId, lineId, (placements) =>
      placements.filter((placement) => placement.id !== placementId),
    );
    setActiveMenu(null);
  };

  const updatePlacementChord = (
    sectionId: string,
    lineId: string,
    placementId: string,
    displayValue: string,
  ) => {
    const trimmed = displayValue.trim();
    if (!trimmed) {
      removePlacement(sectionId, lineId, placementId);
      return;
    }
    const chord = toOriginalChord(trimmed);
    updateLine(sectionId, lineId, (placements) =>
      placements.map((placement) =>
        placement.id === placementId ? { ...placement, chord } : placement,
      ),
    );
  };

  const movePlacement = (
    sectionId: string,
    lineId: string,
    placementId: string,
    delta: number,
    sectionLabel: string,
  ) => {
    updateLine(sectionId, lineId, (placements) =>
      placements.map((placement) => {
        if (placement.id !== placementId) return placement;
        const line =
          sheet.sections
            .find((section) => section.id === sectionId)
            ?.lines.find((entry) => entry.id === lineId) ?? null;
        if (!line) return placement;
        const maxOffset = lineMaxChordOffset(line.lyrics, placements, {
          sectionLabel,
          chordLength: placement.chord.length,
        });
        const nextOffset = Math.min(Math.max(0, placement.offset + delta), maxOffset);
        return { ...placement, offset: nextOffset };
      }),
    );
  };

  const addPlacementAt = (sectionId: string, lineId: string, offset: number) => {
    const chord = defaultNewChord;
    const placement: ChordPlacement = {
      id: newPlacementId(chord, offset),
      chord,
      offset,
    };
    updateLine(sectionId, lineId, (placements) => [...placements, placement]);
    setActiveMenu(null);
  };

  const openChordMenu = (
    event: React.MouseEvent<HTMLButtonElement>,
    sectionId: string,
    lineId: string,
    placement: ChordPlacement,
    sectionLabel: string,
  ) => {
    const key = placementKey(lineId, placement.id);
    if (selectedKey === key) {
      setActiveMenu(null);
      return;
    }
    setActiveMenu({
      key,
      sectionId,
      lineId,
      placement,
      sectionLabel,
      anchor: event.currentTarget.getBoundingClientRect(),
    });
  };

  const renderChordMenu = () => {
    if (!activeMenu || typeof document === "undefined") return null;

    const { sectionId, lineId, placement, sectionLabel, anchor } = activeMenu;
    const displayChord = toDisplayChord(placement.chord);
    const menuTop = Math.max(8, anchor.top - 8);
    const menuLeft = Math.min(anchor.left, window.innerWidth - 160);

    return createPortal(
      <div
        data-chord-menu
        className={chordMenuClass}
        style={{
          position: "fixed",
          top: menuTop,
          left: menuLeft,
          transform: "translateY(-100%)",
          zIndex: 100,
        }}
      >
        <input
          autoFocus
          defaultValue={displayChord}
          className="w-full rounded border border-green-500/50 bg-slate-950 px-2 py-1 text-center text-sm font-bold text-green-400 outline-none ring-1 ring-green-500/30"
          onBlur={(event) =>
            updatePlacementChord(sectionId, lineId, placement.id, event.target.value)
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              updatePlacementChord(sectionId, lineId, placement.id, event.currentTarget.value);
              setActiveMenu(null);
            }
            if (event.key === "Escape") {
              setActiveMenu(null);
            }
          }}
        />
        <div className="flex items-center justify-center gap-1">
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 hover:border-green-500/60 hover:text-green-300"
            onClick={() => movePlacement(sectionId, lineId, placement.id, -1, sectionLabel)}
            title="Mover para esquerda"
          >
            ◀
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded border border-slate-600 bg-slate-800 text-xs text-red-300 hover:border-red-500/60 hover:text-red-200"
            onClick={() => removePlacement(sectionId, lineId, placement.id)}
            title="Remover acorde"
          >
            ×
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 hover:border-green-500/60 hover:text-green-300"
            onClick={() => movePlacement(sectionId, lineId, placement.id, 1, sectionLabel)}
            title="Mover para direita"
          >
            ▶
          </button>
        </div>
      </div>,
      document.body,
    );
  };

  const nextChordOffset = (
    line: EditableCifraSheet["sections"][number]["lines"][number],
    sectionLabel: string,
  ) => {
    const placementEnd = line.placements.reduce(
      (max, placement) => Math.max(max, placement.offset + placement.chord.length),
      0,
    );
    const maxOffset = lineMaxChordOffset(line.lyrics, line.placements, {
      sectionLabel,
      chordLength: defaultNewChord.length,
    });
    return Math.min(maxOffset, Math.max(placementEnd, 0));
  };

  const addPlacementAtEnd = (sectionId: string, lineId: string, sectionLabel: string) => {
    const line = sheet.sections
      .find((section) => section.id === sectionId)
      ?.lines.find((entry) => entry.id === lineId);
    if (!line) return;
    addPlacementAt(sectionId, lineId, nextChordOffset(line, sectionLabel));
  };

  const removeLine = (sectionId: string, lineId: string) => {
    setSheet((current) => ({
      sections: current.sections
        .map((section) =>
          section.id !== sectionId
            ? section
            : { ...section, lines: section.lines.filter((line) => line.id !== lineId) },
        )
        .filter((section) => section.lines.length > 0),
    }));
    setActiveMenu(null);
  };

  const applyLineModal = (notasInput: string, letraInput: string) => {
    const lyrics = letraInput;
    const chords = parseChordTokens(notasInput).map((chord) => toOriginalChord(chord));
    if (!lyrics.trim() && chords.length === 0) return;

    if (lineModal?.mode === "edit" && lineModal.sectionId && lineModal.lineId) {
      const { sectionId, lineId } = lineModal;
      setSheet((current) => ({
        sections: current.sections.map((section) =>
          section.id !== sectionId
            ? section
            : {
                ...section,
                lines: section.lines.map((line) =>
                  line.id !== lineId
                    ? line
                    : updateLineNotasAndLetra(line, { lyrics, chords }),
                ),
              },
        ),
      }));
      return;
    }

    const newLine = lineFromNotasAndLetra({ lyrics, chords });

    setSheet((current) => {
      if (current.sections.length === 0) {
        return {
          sections: [
            {
              id: `section-extra-${Date.now()}`,
              label: "Extra",
              lines: [newLine],
            },
          ],
        };
      }

      const sections = [...current.sections];
      const lastIndex = sections.length - 1;
      const lastSection = sections[lastIndex]!;
      sections[lastIndex] = {
        ...lastSection,
        lines: [...lastSection.lines, newLine],
      };
      return { sections };
    });
  };

  const openAddLineModal = () => {
    setLineModal({ mode: "add", initialNotas: "", initialLetra: "" });
  };

  const openEditLineModal = (
    sectionId: string,
    line: EditableCifraSheet["sections"][number]["lines"][number],
  ) => {
    setLineModal({
      mode: "edit",
      sectionId,
      lineId: line.id,
      initialNotas: lineToDisplayNotas(line),
      initialLetra: line.lyrics,
    });
  };

  return (
    <div className="min-w-0 max-w-full space-y-10 font-mono text-[15px] leading-7">
      {renderChordMenu()}
      <CifraLineModal
        open={lineModal !== null}
        mode={lineModal?.mode ?? "add"}
        initialNotas={lineModal?.initialNotas ?? ""}
        initialLetra={lineModal?.initialLetra ?? ""}
        onClose={() => setLineModal(null)}
        onSave={applyLineModal}
      />

      {editable ? (
        <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-lg border border-green-500/30 bg-slate-950/95 px-3 py-2 backdrop-blur-sm">
          <button
            type="button"
            className="rounded-lg bg-green-500 px-3 py-1.5 text-sm font-medium text-slate-950 transition hover:bg-green-400"
            onClick={openAddLineModal}
          >
            + Linha (notas + letra)
          </button>
          <span className="text-xs text-slate-500">
            Use o lápis ao lado de cada linha para editar letra e acordes
          </span>
        </div>
      ) : null}

      {sheet.sections.map((section) => (
        <section key={section.id}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-bold text-slate-200">[{section.label}]</h2>
          </div>

          <div className="space-y-6">
            {section.lines.map((line) => {
              const contentWidth = lineContentWidth(line.lyrics, line.placements);
              const chordChars = buildChordRowChars(line.lyrics, line.placements, contentWidth);
              const maxOffset = lineMaxChordOffset(line.lyrics, line.placements, {
                sectionLabel: section.label,
              });
              const hasLyrics = line.lyrics.trim().length > 0;

              return (
                <div key={line.id} className="group/line max-w-full">
                  <div className="mb-1 flex items-center justify-end gap-2">
                    {editable ? (
                      <button
                        type="button"
                        className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400 transition hover:border-red-500/50 hover:bg-red-950/30 hover:text-red-300"
                        onClick={() => removeLine(section.id, line.id)}
                        title="Remover linha (notas e letra)"
                      >
                        Remover linha
                      </button>
                    ) : null}
                  </div>
                  <div className="flex max-w-full items-end gap-2">
                    <div className="relative min-h-6 min-w-0 flex-1 overflow-x-auto overscroll-x-contain pr-3 whitespace-pre leading-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {line.placements.map((placement) => {
                        const key = placementKey(line.id, placement.id);
                        const isSelected = selectedKey === key;
                        const displayChord = toDisplayChord(placement.chord);

                        return (
                          <span
                            key={placement.id}
                            className="absolute bottom-0"
                            style={{ left: `${placement.offset}ch` }}
                          >
                            {editable ? (
                              <button
                                type="button"
                                data-chord-trigger
                                className={`font-bold transition ${
                                  isSelected
                                    ? "rounded bg-green-500/15 px-0.5 text-green-300 ring-1 ring-green-500/40"
                                    : "text-green-400 hover:text-green-300"
                                }`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openChordMenu(event, section.id, line.id, placement, section.label);
                                }}
                                title="Clique para editar acorde"
                              >
                                {displayChord}
                              </button>
                            ) : (
                              <span className="chord-note">{displayChord}</span>
                            )}
                          </span>
                        );
                      })}

                      <span className="invisible whitespace-pre select-none" aria-hidden>
                        {chordChars.join("")}
                      </span>
                    </div>

                    {editable ? (
                      <button
                        type="button"
                        className="shrink-0 rounded-full border border-dashed border-slate-600 px-2.5 py-1 text-xs text-slate-400 transition hover:border-green-500/60 hover:bg-green-500/5 hover:text-green-400"
                        onClick={() => addPlacementAtEnd(section.id, line.id, section.label)}
                        title="Adicionar acorde no final da linha"
                      >
                        + Nota
                      </button>
                    ) : null}
                  </div>

                  <div className="flex max-w-full items-start gap-2">
                    {hasLyrics ? (
                      <p
                        className={`min-w-0 flex-1 overflow-x-auto overscroll-x-contain pr-1 whitespace-pre text-left leading-7 text-slate-200 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
                          editable ? "cursor-text" : "cursor-default"
                        }`}
                        onClick={
                          editable
                            ? (event) => {
                                const target = event.currentTarget;
                                const rect = target.getBoundingClientRect();
                                const style = window.getComputedStyle(target);
                                const charWidth = Number.parseFloat(style.fontSize) * 0.6 || 9;
                                const offset = Math.min(
                                  maxOffset,
                                  Math.max(0, Math.round((event.clientX - rect.left) / charWidth)),
                                );
                                addPlacementAt(section.id, line.id, offset);
                              }
                            : undefined
                        }
                        title={
                          editable
                            ? "Clique na letra para posicionar acorde · use o lápis para editar a linha"
                            : undefined
                        }
                      >
                        {line.lyrics}
                      </p>
                    ) : line.placements.length > 0 ? (
                      <p className="flex-1 text-xs text-slate-500">Somente acordes</p>
                    ) : (
                      <p className="flex-1 text-xs italic text-slate-600">Linha vazia</p>
                    )}

                    {editable ? (
                      <button
                        type="button"
                        className="mt-0.5 shrink-0 rounded-lg border border-slate-600 bg-slate-900 p-1.5 text-slate-400 transition hover:border-green-500/60 hover:bg-green-950/30 hover:text-green-300"
                        onClick={() => openEditLineModal(section.id, line)}
                        title="Editar letra e notas desta linha"
                        aria-label="Editar linha"
                      >
                        {pencilIcon}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {editable ? (
        <div className="flex justify-center border-t border-dashed border-slate-800 pt-6">
          <button
            type="button"
            className="rounded-full border border-dashed border-slate-600 px-4 py-2 text-sm text-slate-400 transition hover:border-green-500/60 hover:bg-green-500/5 hover:text-green-400"
            onClick={openAddLineModal}
          >
            + Linha (notas + letra)
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function clearImportedCifraEdits(songId: string): void {
  localStorage.removeItem(`softmusic:cifra-sheet:${songId}`);
}
