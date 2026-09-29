// Folds the event stream into what the workspace shows. Pure, so live runs and
// recorded replays go through exactly the same code.

import type { ClaimRow, InterruptValue, ProfileReport, StreamEvent } from "./types";

export const CAPABILITY_FIELDS = [
  "tool_calling",
  "tool_choice",
  "parallel_tool_calls",
  "structured_output",
  "image_inputs",
  "audio_inputs",
] as const;

export const LIMIT_FIELDS = ["max_input_tokens", "max_output_tokens"] as const;

export const FIELD_LABELS: Record<string, string> = {
  tool_calling: "Tool calling",
  tool_choice: "Forced tool choice",
  parallel_tool_calls: "Parallel tool calls",
  structured_output: "Native structured output",
  image_inputs: "Image input",
  audio_inputs: "Audio input",
  max_input_tokens: "Max input tokens",
  max_output_tokens: "Max output tokens",
};

export interface Trial {
  trial: number;
  of: number;
  passed: boolean | null;
  path: string;
  evidence_id: string;
  error: string | null;
}

export interface LogEntry {
  id: number;
  kind: string;
  title: string;
  detail?: string;
  args?: Record<string, unknown>;
  status?: string;
  ms?: number;
  evidenceId?: string;
  passed?: boolean | null;
  problems?: string[];
}

export interface Budget {
  tokens: number;
  maxTokens: number;
  seconds: number;
  maxSeconds: number;
  dailyCalls: number;
  dailyLimit: number;
}

export type Status = "idle" | "running" | "awaiting_approval" | "done" | "stopped" | "error";

export interface ChatLine {
  role: "user" | "agent";
  text: string;
}

export interface InspectionState {
  status: Status;
  provider?: string;
  model?: string;
  integration?: string;
  langchainEmpty?: boolean;
  unknownModel?: { didYouMean: string[] };
  claims: Record<string, ClaimRow>;
  trials: Record<string, Trial[]>;
  limits?: { max_input_tokens: number; max_output_tokens: number; evidence_id: string };
  log: LogEntry[];
  modelCalls: number;
  toolCalls: number;
  budget?: Budget;
  interrupt?: { id: string; value: InterruptValue };
  report?: ProfileReport;
  corrections: string[];
  chat: ChatLine[];
  draft?: { draft_id: string; path: string; diff: string; description: string };
  error?: string;
  stopReason?: string;
}

export const initialState: InspectionState = {
  status: "idle",
  claims: {},
  trials: {},
  log: [],
  modelCalls: 0,
  toolCalls: 0,
  corrections: [],
  chat: [],
};

let nextId = 0;
const entry = (e: Omit<LogEntry, "id">): LogEntry => ({ ...e, id: nextId++ });

export type Action =
  | { type: "event"; event: StreamEvent }
  | { type: "user"; text: string }
  | { type: "reset" }
  | { type: "fail"; message: string };

function onToolResult(state: InspectionState, name: string, data: unknown): InspectionState {
  if (!data || typeof data !== "object") return state;
  const d = data as Record<string, unknown>;
  if (name === "get_claims") {
    if (d.known === false) {
      return {
        ...state,
        model: String(d.model ?? state.model),
        unknownModel: { didYouMean: (d.did_you_mean as string[]) ?? [] },
      };
    }
    if (Array.isArray(d.claims)) {
      const claims: Record<string, ClaimRow> = {};
      for (const row of d.claims as ClaimRow[]) claims[row.field] = row;
      return {
        ...state,
        claims,
        provider: String(d.provider ?? ""),
        model: String(d.model ?? ""),
        integration: String(d.integration ?? ""),
        langchainEmpty: Boolean(d.langchain_profile_empty),
        unknownModel: undefined,
      };
    }
  }
  if (name === "check_provider_limits" && typeof d.max_input_tokens === "number") {
    return { ...state, limits: d as unknown as InspectionState["limits"] };
  }
  if (name === "draft_models_dev_change" && typeof d.diff === "string") {
    return { ...state, draft: d as unknown as InspectionState["draft"] };
  }
  return state;
}

function onTrace(state: InspectionState, e: Record<string, unknown>): InspectionState {
  const kind = String(e.kind);
  const ms = typeof e.ms === "number" ? e.ms : undefined;
  switch (kind) {
    case "tool_call": {
      const name = String(e.name);
      if (name === "ProfileReport") {
        return { ...state, log: [...state.log, entry({ kind: "report", title: "Report written", ms })] };
      }
      return {
        ...state,
        toolCalls: state.toolCalls + 1,
        log: [...state.log, entry({ kind, title: name, args: e.args as Record<string, unknown>, ms })],
      };
    }
    case "tool_result": {
      const name = String(e.name);
      if (name === "ProfileReport") return state;
      const next = onToolResult(state, name, e.data);
      return {
        ...next,
        log: [
          ...next.log,
          entry({ kind, title: name, detail: String(e.detail ?? ""), status: String(e.status), ms }),
        ],
      };
    }
    case "probe_trial": {
      const cap = String(e.capability);
      const trial: Trial = {
        trial: Number(e.trial),
        of: Number(e.of),
        passed: (e.passed as boolean | null) ?? null,
        path: String(e.path),
        evidence_id: String(e.evidence_id),
        error: (e.error as string | null) ?? null,
      };
      const key = trial.path === "langchain" ? cap : `${cap}:sdk`;
      const trials = { ...state.trials, [key]: [...(state.trials[key] ?? []), trial] };
      const outcome = trial.passed === null ? "error" : trial.passed ? "pass" : "fail";
      return {
        ...state,
        trials,
        log: [
          ...state.log,
          entry({
            kind,
            title: `${cap} trial ${trial.trial}/${trial.of}`,
            detail: trial.error ? trial.error.slice(0, 160) : outcome,
            evidenceId: trial.evidence_id,
            passed: trial.passed,
          }),
        ],
      };
    }
    case "budget": {
      const budget: Budget = {
        tokens: Number(e.tokens),
        maxTokens: Number(e.max_tokens),
        seconds: Number(e.seconds),
        maxSeconds: Number(e.max_seconds),
        dailyCalls: Number(e.daily_calls),
        dailyLimit: Number(e.daily_limit),
      };
      return {
        ...state,
        budget,
        modelCalls: state.modelCalls + 1,
        log: [...state.log, entry({ kind: "model", title: "Model call", detail: `${budget.tokens} tokens this run`, ms })],
      };
    }
    case "model": {
      const text = String(e.detail ?? "");
      const stopped = text.startsWith("Stopped:");
      return {
        ...state,
        stopReason: stopped ? text : state.stopReason,
        chat: [...state.chat, { role: "agent", text }],
        log: [...state.log, entry({ kind: stopped ? "limit" : "answer", title: stopped ? "Budget stop" : "Answer", detail: text, ms })],
      };
    }
    case "evidence_check": {
      const problems = (e.problems as string[]) ?? [];
      return {
        ...state,
        corrections: problems,
        log: [
          ...state.log,
          entry({
            kind,
            title: "Evidence check",
            detail: problems.length ? `${problems.length} corrections` : "report matches the evidence",
            problems,
          }),
        ],
      };
    }
    case "middleware":
      return { ...state, log: [...state.log, entry({ kind, title: String(e.name), ms })] };
    case "recorded":
      return { ...state, log: [...state.log, entry({ kind, title: "Recorded example", detail: String(e.detail ?? "") })] };
    default:
      return state;
  }
}

export function reduce(state: InspectionState, action: Action): InspectionState {
  if (action.type === "reset") return initialState;
  if (action.type === "user") {
    return {
      ...state,
      status: "running",
      error: undefined,
      stopReason: undefined,
      interrupt: undefined,
      modelCalls: 0,
      toolCalls: 0,
      budget: undefined,
      chat: [...state.chat, { role: "user", text: action.text }],
    };
  }
  if (action.type === "fail") return { ...state, status: "error", error: action.message };
  const event = action.event;
  switch (event.type) {
    case "token":
      return state;
    case "trace":
      return onTrace(state, event as unknown as Record<string, unknown>);
    case "interrupt":
      return {
        ...state,
        status: "awaiting_approval",
        interrupt: { id: event.id, value: event.value },
        log: [
          ...state.log,
          entry({ kind: "approval", title: `Approval needed: ${event.value.action_requests.map((a) => a.name).join(", ")}` }),
        ],
      };
    case "decision":
      return {
        ...state,
        status: "running",
        interrupt: undefined,
        modelCalls: 0,
        toolCalls: 0,
        budget: undefined,
        log: [...state.log, entry({ kind: "approval", title: `Reviewer chose: ${event.decision}` })],
      };
    case "result":
      return { ...state, report: event.report, chat: [...state.chat, { role: "agent", text: event.report.summary }] };
    case "error":
      return { ...state, status: "error", error: event.message };
    default:
      return state;
  }
}

/** Called when a stream ends without error: settle the status. */
export function settle(state: InspectionState): InspectionState {
  if (state.status === "error" || state.status === "awaiting_approval") return state;
  return { ...state, status: state.stopReason ? "stopped" : "done" };
}

export function claimedText(value: unknown): string {
  if (value === null || value === undefined) return "no claim";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return value.toLocaleString("en-US");
  return String(value);
}
