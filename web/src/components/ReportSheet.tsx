"use client";

import { Gauge } from "@/components/Gauge";
import dynamic from "next/dynamic";
import { MarkGlyph, VERDICT_WORD } from "@/components/MarkGlyph";
import { FIELD_LABELS, type Trial } from "@/lib/inspection";
import type { Layer, Verdict } from "@/lib/types";

export interface SheetRow {
  field: string;
  langchain: string;
  modelsDev: string;
  observed: string;
  verdict?: Verdict;
  layer?: Layer;
  note?: string;
  trials?: Trial[];
  evidenceIds?: string[];
}

const StampedMark = dynamic(() => import("@/components/StampedMark"));

const LAYER_TEXT: Record<Layer, string> = {
  model: "Model",
  integration: "LangChain integration",
  data: "Profile data",
  none: "",
};

export function ReportSheet({
  model,
  maker,
  integration,
  stamped,
  rows,
  footer,
  onEvidence,
  stamp = false,
  compact = false,
  markSize = 52,
  headingLevel = 3,
  className = "",
}: {
  model: string;
  maker: string;
  integration: string;
  stamped: string;
  rows: SheetRow[];
  footer?: React.ReactNode;
  onEvidence?: (id: string) => void;
  stamp?: boolean;
  compact?: boolean;
  markSize?: number;
  headingLevel?: 2 | 3;
  className?: string;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className={`form-paper paper-shadow relative text-ink ${className}`} aria-label={`Inspection report for ${model}`}>
      <header className="border-b-2 border-ink px-5 pb-3 pt-4 sm:px-6">
        <div className="flex items-baseline justify-between gap-4">
          <Heading className="font-display text-2xl font-black uppercase leading-none tracking-wide sm:text-3xl">
            Inspection report
          </Heading>
          <p className="font-mono text-xs text-carbon">{stamped}</p>
        </div>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="font-label text-xs font-extrabold uppercase tracking-widest text-carbon">Device</dt>
          <dd className="font-mono break-all">{model}</dd>
          <dt className={`font-label text-xs font-extrabold uppercase tracking-widest text-carbon ${compact ? "max-sm:hidden" : ""}`}>Maker</dt>
          <dd className={compact ? "max-sm:hidden" : ""}>{maker}</dd>
          <dt className={`font-label text-xs font-extrabold uppercase tracking-widest text-carbon ${compact ? "max-sm:hidden" : ""}`}>Through</dt>
          <dd className={`font-mono break-all ${compact ? "max-sm:hidden" : ""}`}>{integration}</dd>
        </dl>
      </header>

      <div role="table" aria-label="Claims and results" className={`px-5 sm:px-6 ${compact ? "sheet-compact" : ""}`}>
        <div
          role="row"
          className="sheet-row hidden border-b border-ink py-2 font-label text-xs font-extrabold uppercase tracking-widest text-carbon md:grid"
        >
          <span role="columnheader" className="[grid-area:claim]">Claim</span>
          <span role="columnheader" className="[grid-area:lc]">LangChain says</span>
          <span role="columnheader" className="[grid-area:md]">models.dev says</span>
          <span role="columnheader" className="[grid-area:gauge]">Measured</span>
          <span role="columnheader" className="text-right [grid-area:mark]">
            Mark
          </span>
        </div>
        {rows.map((row) => (
          <div role="row" key={row.field} className={`sheet-row border-b border-rule ${compact ? "py-1.5" : "py-3"}`}>
            <div role="cell" className="font-semibold [grid-area:claim]">
              {FIELD_LABELS[row.field] ?? row.field}
              {row.layer && row.layer !== "none" && (
                <span className="ml-2 font-label text-xs font-extrabold uppercase tracking-wider text-reject">
                  {LAYER_TEXT[row.layer]}
                </span>
              )}
            </div>
            <div role="cell" className="flex gap-2 text-sm [grid-area:lc]">
              <span className="font-label text-xs font-extrabold uppercase tracking-widest text-carbon md:hidden">LangChain</span>
              <span className="font-mono tabular">{row.langchain}</span>
            </div>
            <div role="cell" className="flex gap-2 text-sm [grid-area:md]">
              <span className="font-label text-xs font-extrabold uppercase tracking-widest text-carbon md:hidden">models.dev</span>
              <span className="font-mono tabular">{row.modelsDev}</span>
            </div>
            <div role="cell" className="flex flex-wrap items-center gap-x-3 gap-y-1 [grid-area:gauge]">
              <span className="font-label text-xs font-extrabold uppercase tracking-widest text-carbon md:hidden">Measured</span>
              {row.trials && <Gauge trials={row.trials} onOpen={onEvidence} />}
              <span className={`font-mono text-sm tabular text-ink-soft ${compact && row.trials ? "sr-only" : ""}`}>{row.observed}</span>
              {!row.trials && compact && onEvidence &&
                row.evidenceIds?.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onEvidence(id)}
                    aria-label={`Open evidence ${id}`}
                    className="border border-carbon px-1 font-mono text-[0.7rem] text-carbon hover:bg-carbon hover:text-paper"
                  >
                    source
                  </button>
                ))}
            </div>
            <div role="cell" className="flex items-center justify-end gap-2 [grid-area:mark]">
              {row.verdict ? (
                <span className="flex flex-col items-center gap-0.5">
                  {stamp ? (
                    <StampedMark verdict={row.verdict} size={markSize} tiltKey={row.field} />
                  ) : (
                    <MarkGlyph verdict={row.verdict} size={markSize} tiltKey={row.field} />
                  )}
                  <span className="font-label text-xs font-extrabold uppercase tracking-widest">{VERDICT_WORD[row.verdict]}</span>
                </span>
              ) : (
                <span className="font-label text-xs font-extrabold uppercase tracking-widest text-carbon">Measuring</span>
              )}
            </div>
            {row.note && !compact && (
              <p className="text-sm text-ink-soft [grid-area:note]">
                {row.note}
                {row.evidenceIds && row.evidenceIds.length > 0 && onEvidence && (
                  <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                    {row.evidenceIds.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => onEvidence(id)}
                        className="border border-carbon px-1.5 font-mono text-[0.7rem] text-carbon hover:bg-carbon hover:text-paper"
                      >
                        {id}
                      </button>
                    ))}
                  </span>
                )}
              </p>
            )}
          </div>
        ))}
      </div>
      {footer && <footer className="px-5 py-4 text-sm sm:px-6">{footer}</footer>}
    </article>
  );
}
