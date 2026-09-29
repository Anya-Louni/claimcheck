// Shapes of the events the API streams and of the report the agent returns.

export type Verdict = "confirmed" | "contradicted" | "inconclusive" | "unclaimed" | "not_probed";
export type Layer = "model" | "integration" | "data" | "none";

export interface ClaimVerdict {
  field: string;
  claimed_langchain: string | null;
  claimed_models_dev: string | null;
  observed: string;
  verdict: Verdict;
  layer: Layer;
  evidence_ids: string[];
  note: string;
}

export interface ProfileReport {
  provider: string;
  model: string;
  integration_version: string;
  scope_note: string;
  claims: ClaimVerdict[];
  draft_change_id: string | null;
  unverified: string[];
  summary: string;
}

export interface ClaimRow {
  field: string;
  langchain: unknown;
  models_dev: unknown;
  sources_agree: boolean;
  missing_in_langchain: boolean;
}

export interface ActionRequest {
  name: string;
  args: Record<string, unknown>;
  description?: string;
}

export interface InterruptValue {
  action_requests: ActionRequest[];
  review_configs: { action_name: string; allowed_decisions: string[] }[];
}

export type StreamEvent =
  | { type: "token"; text: string; at_ms?: number }
  | { type: "result"; report: ProfileReport; at_ms?: number }
  | { type: "error"; message: string; at_ms?: number }
  | { type: "interrupt"; id: string; value: InterruptValue; at_ms?: number }
  | { type: "decision"; decision: "approve" | "reject"; at_ms?: number }
  | ({ type: "trace"; kind: string; at_ms?: number } & Record<string, unknown>);

export interface Decision {
  type: "approve" | "edit" | "reject";
  message?: string;
  edited_action?: { name: string; args: Record<string, unknown> };
}
