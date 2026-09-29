// Talks to the Claimcheck API. The API holds every key; the browser only sees events.

import type { Decision, StreamEvent } from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function readSse(response: Response, onEvent: (e: StreamEvent) => void): Promise<void> {
  if (!response.ok || !response.body) {
    let detail = `The inspection service answered ${response.status}.`;
    try {
      const body = await response.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      // keep the generic message
    }
    throw new ApiError(detail, response.status);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut = buffer.indexOf("\n\n");
    while (cut !== -1) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      if (data) onEvent(JSON.parse(data) as StreamEvent);
      cut = buffer.indexOf("\n\n");
    }
  }
}

export interface RunInput {
  threadId: string;
  message: string;
  images: File[];
  audio: Blob | null;
}

export async function startRun(input: RunInput, onEvent: (e: StreamEvent) => void, signal?: AbortSignal) {
  const form = new FormData();
  form.set("thread_id", input.threadId);
  form.set("message", input.message);
  for (const image of input.images) form.append("images", image, image.name);
  if (input.audio) form.append("audio", input.audio, "voice.webm");
  const response = await fetch(`${API_URL}/runs`, { method: "POST", body: form, signal });
  await readSse(response, onEvent);
}

export async function resumeRun(
  threadId: string,
  decisions: Decision[],
  onEvent: (e: StreamEvent) => void,
  signal?: AbortSignal,
) {
  const response = await fetch(`${API_URL}/runs/${threadId}/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decisions }),
    signal,
  });
  await readSse(response, onEvent);
}

export interface Limits {
  daily_calls_used: number;
  daily_calls_limit: number;
  model_calls_per_run: number;
  tool_calls_per_run: number;
  tokens_per_run: number;
  seconds_per_run: number;
}

/** Resolves to the limits when the API is awake, or null within a few seconds when it is not. */
export async function checkApi(timeoutMs = 5000): Promise<Limits | null> {
  try {
    const response = await fetch(`${API_URL}/limits`, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok ? ((await response.json()) as Limits) : null;
  } catch {
    return null;
  }
}

export interface Finding {
  saved_at: string;
  integration_version: string;
  verdicts: Record<string, string>;
}

export async function getFindings(provider: string, model: string): Promise<Finding[]> {
  try {
    const response = await fetch(`${API_URL}/findings/${provider}/${model}`);
    return response.ok ? ((await response.json()) as Finding[]) : [];
  } catch {
    return [];
  }
}

/** Evidence comes from the API in live mode and from static files in recorded mode. */
export async function getEvidence(id: string, recorded: boolean): Promise<Record<string, unknown> | null> {
  const url = recorded ? `/demo/evidence/${id}.json` : `${API_URL}/evidence/${id}`;
  try {
    const response = await fetch(url);
    return response.ok ? ((await response.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function audioUrl(fixturePath: string, recorded: boolean): string {
  const name = fixturePath.split("/").pop() ?? "";
  return recorded ? `/demo/audio/${name}` : `${API_URL}/fixtures/audio/${name}`;
}
