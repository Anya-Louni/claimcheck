import type { SheetRow } from "@/components/ReportSheet";
import { CAPABILITY_FIELDS, LIMIT_FIELDS, claimedText, type InspectionState } from "./inspection";

function fromJsonText(value: string | null): unknown {
  if (value === null || value === "null") return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Rows for the report sheet: live measurements first, final verdicts once the report lands. */
export function sheetRows(state: InspectionState): SheetRow[] {
  const report = state.report;
  const fields = [...CAPABILITY_FIELDS, ...LIMIT_FIELDS].filter(
    (f) => f in state.claims || state.trials[f] || report?.claims.some((c) => c.field === f),
  );
  return fields.map((field) => {
    const claim = state.claims[field];
    const final = report?.claims.find((c) => c.field === field);
    const trials = state.trials[field];
    let observed = final?.observed ?? "";
    if (!final && field in (state.limits ?? {})) {
      observed = claimedText((state.limits as Record<string, unknown>)[field]);
    }
    if (!final && trials) {
      const passes = trials.filter((t) => t.passed).length;
      observed = `${passes}/${trials[0]?.of ?? trials.length} passed`;
    }
    // Once the report is in, a field it left out still gets an honest mark.
    let verdict = final?.verdict;
    if (report && !final) {
      verdict = claim && (claim.langchain != null || claim.models_dev != null) ? "not_probed" : "unclaimed";
    }
    if (/^\d+( tokens)?$/.test(observed)) observed = Number.parseInt(observed, 10).toLocaleString("en-US");
    return {
      field,
      langchain: claimedText(final ? fromJsonText(final.claimed_langchain) : claim?.langchain),
      modelsDev: claimedText(final ? fromJsonText(final.claimed_models_dev) : claim?.models_dev),
      observed,
      verdict,
      layer: final?.layer,
      note: final?.note,
      trials,
      evidenceIds: final?.evidence_ids,
    };
  });
}
