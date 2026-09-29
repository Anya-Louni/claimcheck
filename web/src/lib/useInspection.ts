"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ApiError, checkApi, resumeRun, startRun, type Limits } from "./api";
import { DEMOS, gapBefore, loadDemo, type DemoName } from "./demo";
import { initialState, reduce, settle, type InspectionState } from "./inspection";
import type { Decision, StreamEvent } from "./types";

type Mode = "recorded" | "live";
export type ApiStatus = "checking" | "awake" | "asleep";

function newThread(): string {
  return `t-${Math.random().toString(36).slice(2, 10)}`;
}

function reducer(state: InspectionState, action: Parameters<typeof reduce>[1] | { type: "settle" }) {
  return action.type === "settle" ? settle(state) : reduce(state, action);
}

function friendly(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    return "This address has used its 10 live runs for the hour. The recorded example still works.";
  }
  if (error instanceof ApiError) return error.message;
  if (error instanceof DOMException && error.name === "AbortError") return "Run cancelled.";
  return "The inspection service did not answer. It may be asleep. Try again in a minute, or watch the recorded example.";
}

export function useInspection(initialMode: Mode) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [api, setApi] = useState<ApiStatus>("checking");
  const [limits, setLimits] = useState<Limits | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const thread = useRef(newThread());
  const abort = useRef<AbortController | null>(null);
  const replay = useRef({ events: [] as StreamEvent[], index: 0, timer: 0 as number | undefined });
  // Each replay gets a generation number, so a superseded replay can never keep dispatching.
  const generation = useRef(0);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => {
    checkApi().then((result) => {
      setLimits(result);
      setApi(result ? "awake" : "asleep");
    });
  }, []);

  const onEvent = useCallback((event: StreamEvent) => dispatch({ type: "event", event }), []);

  // Recorded replay ---------------------------------------------------------
  const step = useCallback(() => {
    const r = replay.current;
    const gen = generation.current;
    if (r.index >= r.events.length) {
      dispatch({ type: "settle" });
      setPlaying(false);
      return;
    }
    const event = r.events[r.index];
    const delay = gapBefore(r.events, r.index, speedRef.current) + (event.type === "decision" ? 1600 / speedRef.current : 0);
    r.timer = window.setTimeout(() => {
      if (gen !== generation.current) return;
      dispatch({ type: "event", event });
      r.index += 1;
      step();
    }, delay);
  }, []);

  const playDemo = useCallback(
    async (name: DemoName = "gemma-4-26b") => {
      window.clearTimeout(replay.current.timer);
      const gen = ++generation.current;
      dispatch({ type: "reset" });
      setMode("recorded");
      try {
        const events = await loadDemo(name);
        if (gen !== generation.current) return;
        replay.current = { events, index: 0, timer: undefined };
        dispatch({ type: "user", text: DEMOS[name].prompt });
        setPlaying(true);
        step();
      } catch (error) {
        dispatch({ type: "fail", message: error instanceof Error ? error.message : String(error) });
      }
    },
    [step],
  );

  const pause = useCallback(() => {
    window.clearTimeout(replay.current.timer);
    setPlaying(false);
  }, []);

  const resume = useCallback(() => {
    if (replay.current.index >= replay.current.events.length) return;
    setPlaying(true);
    step();
  }, [step]);

  const skipToEnd = useCallback(() => {
    window.clearTimeout(replay.current.timer);
    const r = replay.current;
    for (; r.index < r.events.length; r.index++) dispatch({ type: "event", event: r.events[r.index] });
    dispatch({ type: "settle" });
    setPlaying(false);
  }, []);

  useEffect(() => () => window.clearTimeout(replay.current.timer), []);

  // Live runs ---------------------------------------------------------------
  const run = useCallback(async (task: (signal: AbortSignal) => Promise<void>) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    try {
      await task(controller.signal);
      dispatch({ type: "settle" });
    } catch (error) {
      dispatch({ type: "fail", message: friendly(error) });
    } finally {
      checkApi().then(setLimits);
    }
  }, []);

  const send = useCallback(
    async (message: string, images: File[], audio: Blob | null) => {
      generation.current += 1;
      window.clearTimeout(replay.current.timer);
      setPlaying(false);
      if (mode !== "live") {
        dispatch({ type: "reset" });
        setMode("live");
        thread.current = newThread();
      }
      const shown = message || (audio ? "Voice note" : images.length ? "Screenshot" : "");
      dispatch({ type: "user", text: [shown, images.length ? `+${images.length} image` : "", audio && message ? "+ voice note" : ""].filter(Boolean).join(" ") });
      await run((signal) => startRun({ threadId: thread.current, message, images, audio }, onEvent, signal));
    },
    [mode, onEvent, run],
  );

  const decide = useCallback(
    async (decisions: Decision[]) => {
      dispatch({ type: "event", event: { type: "decision", decision: decisions[0]?.type === "reject" ? "reject" : "approve" } });
      await run((signal) => resumeRun(thread.current, decisions, onEvent, signal));
    },
    [onEvent, run],
  );

  const cancel = useCallback(() => abort.current?.abort(), []);

  const reset = useCallback(() => {
    generation.current += 1;
    window.clearTimeout(replay.current.timer);
    abort.current?.abort();
    setPlaying(false);
    thread.current = newThread();
    setMode("live");
    dispatch({ type: "reset" });
  }, []);

  return {
    state,
    mode,
    api,
    limits,
    playing,
    speed,
    setSpeed,
    playDemo,
    pause,
    resume,
    skipToEnd,
    send,
    decide,
    cancel,
    reset,
  };
}
