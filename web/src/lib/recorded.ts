import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import { initialState, reduce, settle, type InspectionState } from "./inspection";
import type { StreamEvent } from "./types";

/** Fold a recorded run into its final state at build time. */
export function recordedState(name: string): InspectionState {
  const file = path.join(process.cwd(), "public", "demo", `${name}.jsonl`);
  const events = readFileSync(file, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as StreamEvent);
  return settle(events.reduce((state, event) => reduce(state, { type: "event", event }), initialState));
}
