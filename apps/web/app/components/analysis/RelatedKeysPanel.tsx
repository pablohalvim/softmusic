import { buildRelatedKeys, type RelatedKeyInfo } from "@softmusic/shared/harmony";

import { panelClass } from "../../lib/ui-classes";

interface RelatedKeysPanelProps {
  keyName: string;
  mode: string;
  relativeKey?: string;
  parallelKey?: string;
}

function RelatedKeyCard({ item }: { item: RelatedKeyInfo }) {
  return (
    <div className={panelClass}>
      <p className="text-xs uppercase tracking-wide text-slate-500">{item.type}</p>
      <p className="mt-1 font-medium text-white">
        {item.key} {item.mode === "minor" ? "menor" : "maior"}
      </p>
      <p className="mt-1 text-xs text-slate-400">{item.description}</p>
    </div>
  );
}

export function RelatedKeysPanel({ keyName, mode, relativeKey, parallelKey }: RelatedKeysPanelProps) {
  const related = buildRelatedKeys(keyName, mode);

  return (
    <article className={`${panelClass} md:col-span-2`}>
      <h2 className="font-medium">Tons relacionados</h2>
      <p className="mt-1 text-sm text-slate-400">
        Relativos e paralelos possíveis a partir de {keyName} {mode}.
      </p>

      {(relativeKey || parallelKey) && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
          {relativeKey ? (
            <span className="rounded-full border border-slate-700 px-2 py-1">
              Detectado — relativo: {relativeKey}
            </span>
          ) : null}
          {parallelKey ? (
            <span className="rounded-full border border-slate-700 px-2 py-1">
              Detectado — paralelo: {parallelKey}
            </span>
          ) : null}
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {related.map((item) => (
          <RelatedKeyCard key={item.type} item={item} />
        ))}
      </div>
    </article>
  );
}
