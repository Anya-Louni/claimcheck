// Replays a recorded real run with its original rhythm, compressed so it fits a visit.

import type { StreamEvent } from "./types";

export const DEMOS = {
  "gemma-4-26b": {
    title: "gemma-4-26b-a4b-it on Google",
    prompt: "Inspect google gemma-4-26b-a4b-it",
  },
} as const;

export type DemoName = keyof typeof DEMOS;

export async function loadDemo(name: DemoName): Promise<StreamEvent[]> {
  const response = await fetch(`/demo/${name}.jsonl`);
  if (!response.ok) throw new Error("The recorded example could not be loaded.");
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as StreamEvent);
}

/** Gap to wait before an event, from the recorded timestamps, squeezed into 60 to 900 ms. */
export function gapBefore(events: StreamEvent[], index: number, speed: number): number {
  if (index === 0) return 400 / speed;
  const now = events[index].at_ms;
  const before = events[index - 1].at_ms;
  if (typeof now !== "number" || typeof before !== "number" || now < before) return 250 / speed;
  const squeezed = Math.min(900, Math.max(60, (now - before) / 8));
  return squeezed / speed;
}
