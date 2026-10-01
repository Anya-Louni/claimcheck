"use client";

import { FastForward, Pause, Play, Plus, Radio, RotateCcw } from "lucide-react";
import { MotionConfig } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { ApprovalTag } from "@/components/ApprovalTag";
import { Composer } from "@/components/Composer";
import { EvidenceDrawer } from "@/components/EvidenceDrawer";
import { MarkGlyph as Mark } from "@/components/MarkGlyph";
import { ReportSheet } from "@/components/ReportSheet";
import { Wordmark } from "@/components/SiteHeader";
import { LimitsPanel } from "@/components/LimitsPanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TraceLog } from "@/components/TraceLog";
import { getFindings, type Finding } from "@/lib/api";
import type { InspectionState } from "@/lib/inspection";
import { sheetRows } from "@/lib/rows";
import { useInspection, type ApiStatus } from "@/lib/useInspection";

const EXAMPLES = ["Inspect google gemini-3.5-flash-lite", "Does gemma-4-26b-a4b-it on Google accept audio input?"];

const STATUS_TEXT: Record<InspectionState["status"], string> = {
  idle: "Bench empty",
  running: "Inspecting",
  awaiting_approval: "Held for approval",
  done: "Inspection complete",
  stopped: "Stopped at a limit",
  error: "Run failed",
};

function ApiBadge({ api }: { api: ApiStatus }) {
  const text = {
    checking: "Checking service",
    awake: "Live service awake",
    waking: "Live service waking up",
    asleep: "Live service asleep",
  }[api];
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span
        aria-hidden
        className={`size-2.5 ${api === "awake" ? "bg-current" : "border border-dashed border-current"} ${api === "checking" || api === "waking" ? "animate-pulse" : ""}`}
      />
      {text}
    </span>
  );
}

function History({ provider, model }: { provider: string; model: string }) {
  const [items, setItems] = useState<Finding[] | null>(null);
  useEffect(() => {
    getFindings(provider, model).then(setItems);
  }, [provider, model]);
  if (!items || items.length < 2) return null;
  const [previous, latest] = [items[items.length - 2], items[items.length - 1]];
  const changed = Object.keys(latest.verdicts).filter((k) => previous.verdicts[k] !== latest.verdicts[k]);
  return (
    <section aria-labelledby="history-title" className="border-2 border-ink bg-paper p-5 text-ink">
      <h3 id="history-title" className="font-label text-sm font-extrabold uppercase tracking-widest">
        Since the last saved inspection
      </h3>
      <p className="mt-1 text-sm text-ink-soft">
        {items.length} saved, last before this on <span className="font-mono">{previous.saved_at}</span>.
      </p>
      {changed.length === 0 ? (
        <p className="mt-2">No verdict changed.</p>
      ) : (
        <ul className="mt-2 space-y-1 font-mono text-sm">
          {changed.map((k) => (
            <li key={k}>
              {k}: {previous.verdicts[k] ?? "none"} → {latest.verdicts[k]}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Workspace({ startLive }: { startLive: boolean }) {
  const bench = useInspection(startLive ? "live" : "recorded");
  const { state, mode, api, limits, playing } = bench;
  const [evidence, setEvidence] = useState<string | null>(null);
  const [tab, setTab] = useState<"report" | "log" | "talk">("report");
  const recorded = mode === "recorded";
  const busy = state.status === "running" && !recorded;

  const down = api === "waking" || api === "asleep";

  useEffect(() => {
    if (!startLive) bench.playDemo();
    // play once on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A live visit with the service asleep falls back to the recorded run.
  useEffect(() => {
    if (down && startLive && mode === "live" && state.status === "idle") bench.playDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const rows = useMemo(() => sheetRows(state), [state]);
  const hasSheet = rows.length > 0;
  const maxModel = limits?.model_calls_per_run ?? 25;
  const maxTools = limits?.tool_calls_per_run ?? 40;

  const report = (
    <div className="space-y-5">
      {down && recorded && (
        <p role="status" className="border-2 border-dashed border-current px-4 py-3 text-sm">
          {api === "waking"
            ? "The live service is waking up, which takes about a minute. This is the recorded example meanwhile."
            : "The live service did not answer, so this is the recorded example. Reload the page to try again."}
        </p>
      )}
      {state.interrupt && (
        <ApprovalTag value={state.interrupt.value} recorded={recorded} onDecide={(d) => bench.decide(d)} />
      )}

      {state.status === "error" && (
        <div role="alert" className="flex items-start gap-4 border-2 border-reject bg-paper p-5 text-ink">
          <Mark verdict="contradicted" size={56} />
          <div>
            <p className="font-label text-sm font-extrabold uppercase tracking-widest text-reject">Run failed</p>
            <p className="mt-1">{state.error}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => bench.playDemo()} className="border-2 border-ink px-3 py-1.5 font-label text-sm font-extrabold uppercase tracking-widest">
                Watch the recorded example
              </button>
            </div>
          </div>
        </div>
      )}

      {state.stopReason && (
        <div role="status" className="border-2 border-dashed border-carbon bg-paper p-5 text-ink">
          <p className="font-label text-sm font-extrabold uppercase tracking-widest text-carbon">Stopped at a limit</p>
          <p className="mt-1">{state.stopReason}</p>
        </div>
      )}

      {state.unknownModel && (
        <div className="border-2 border-dashed border-carbon bg-paper p-5 text-ink">
          <p className="font-semibold">
            No source knows <span className="font-mono">{state.model}</span>. Nothing was probed.
          </p>
          {state.unknownModel.didYouMean.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {state.unknownModel.didYouMean.map((m) => (
                <button key={m} type="button" disabled={busy} onClick={() => bench.send(`Inspect google ${m}`, [], null)} className="border border-ink px-2 py-1 font-mono text-sm hover:bg-ink hover:text-paper">
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {hasSheet ? (
        <ReportSheet
          model={state.model ?? ""}
          maker={state.provider === "google_genai" ? "Google, Gemini API" : (state.provider ?? "")}
          integration={state.integration ?? ""}
          stamped={recorded ? "Recorded 29 Sep 2026" : STATUS_TEXT[state.status]}
          rows={rows}
          stamp
          onEvidence={setEvidence}
          footer={
            state.report && (
              <div className="space-y-3">
                <p>{state.report.summary}</p>
                {state.report.unverified.length > 0 && (
                  <div>
                    <p className="font-label text-xs font-extrabold uppercase tracking-widest text-carbon">Unverified or corrected</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink-soft">
                      {state.report.unverified.map((u) => (
                        <li key={u}>{u}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-sm text-ink-soft">{state.report.scope_note}</p>
              </div>
            )
          }
        />
      ) : (
        state.status === "idle" && (
          <div className="form-paper paper-shadow p-6 text-ink sm:p-8">
            <h2 className="font-display text-4xl font-black uppercase leading-none">The bench is empty.</h2>
            <p className="mt-4 max-w-[52ch] leading-relaxed text-ink-soft">
              Name a Google model, record a voice note, or drop a screenshot of its model page. A full
              inspection takes a few minutes on the free tier, about five seconds per probe call.
            </p>
            <div className="mt-6 flex flex-col items-start gap-2">
              {EXAMPLES.map((text) => (
                <button key={text} type="button" disabled={api !== "awake"} onClick={() => bench.send(text, [], null)} className="border-b-2 border-ink text-left font-mono text-sm hover:text-carbon disabled:opacity-40">
                  {text}
                </button>
              ))}
              {down && (
                <p className="mt-2 text-sm text-ink-soft">
                  {api === "waking" ? "The live service is waking up. These unlock in about a minute." : "The live service did not answer, so these are disabled."}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => bench.playDemo()}
              className="mt-6 inline-flex items-center gap-2 bg-ink px-4 py-2.5 font-label text-sm font-extrabold uppercase tracking-widest text-paper"
            >
              <Play size={15} /> Watch the recorded example
            </button>
          </div>
        )
      )}

      {state.draft && (
        <section aria-labelledby="draft-title" className="border-2 border-ink bg-paper p-5 text-ink">
          <h3 id="draft-title" className="font-label text-sm font-extrabold uppercase tracking-widest">
            Draft models.dev change, not submitted
          </h3>
          <pre className="mt-2 overflow-x-auto bg-paper-2 p-3 font-mono text-xs">
            {state.draft.diff.split("\n").map((line, i) => (
              <span key={i} className={`block ${line.startsWith("+") ? "text-carbon" : line.startsWith("-") ? "text-reject" : ""}`}>
                {line}
              </span>
            ))}
          </pre>
          <pre className="mt-3 whitespace-pre-wrap text-sm">{state.draft.description}</pre>
        </section>
      )}

      {!recorded && state.status === "done" && state.provider && state.model && <History provider={state.provider} model={state.model} />}
    </div>
  );

  const talk = (
    <ol className="space-y-3" aria-label="Messages">
      {state.chat.map((line, i) => (
        <li key={i} className={line.role === "user" ? "ml-6 border-2 border-ink bg-paper p-3 text-ink" : "mr-6 p-1"}>
          <p className="font-label text-xs font-extrabold uppercase tracking-widest opacity-80">{line.role === "user" ? "You" : "Claimcheck"}</p>
          <p className="mt-1 whitespace-pre-wrap">{line.text}</p>
        </li>
      ))}
      {state.chat.length === 0 && <li className="text-sm">Messages to and from the agent show here.</li>}
    </ol>
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-dvh flex-col bg-seal text-on-seal lg:h-dvh lg:overflow-hidden dark:bg-ground dark:text-ink">
        <header className="border-b-2 border-on-seal dark:border-rule">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
            <Wordmark className="dark:text-seal" />
            {recorded ? (
              <span className="border-2 border-dashed border-current px-2 py-0.5 font-label text-xs font-extrabold uppercase tracking-widest">
                Recorded example
              </span>
            ) : (
              <span className="bg-ink px-2 py-0.5 font-label text-xs font-extrabold uppercase tracking-widest text-seal dark:bg-seal dark:text-on-seal">Live</span>
            )}
            <ApiBadge api={api} />
            <div className="ml-auto flex items-center gap-5">
              <button type="button" onClick={bench.reset} className="inline-flex items-center gap-2 border-2 border-current px-3 py-2 font-label text-sm font-extrabold uppercase tracking-widest hover:bg-ink hover:text-seal dark:hover:bg-seal dark:hover:text-on-seal">
                <Plus size={16} /> New
              </button>
              <ThemeToggle />
            </div>
          </div>
          {recorded && (
            <div className="flex flex-wrap items-center gap-3 border-t-2 border-on-seal/30 px-4 py-2 text-sm sm:px-6 dark:border-rule">
              <span className="font-mono">Real run of gemma-4-26b-a4b-it, replayed at {bench.speed * 8}× speed.</span>
              <div className="flex items-center gap-1">
                {playing ? (
                  <button type="button" onClick={bench.pause} aria-label="Pause replay" className="grid size-8 place-items-center border border-current">
                    <Pause size={15} />
                  </button>
                ) : (
                  <button type="button" onClick={bench.resume} aria-label="Resume replay" className="grid size-8 place-items-center border border-current">
                    <Play size={15} />
                  </button>
                )}
                <button type="button" onClick={() => bench.setSpeed(bench.speed === 1 ? 2 : bench.speed === 2 ? 4 : 1)} aria-label="Change replay speed" className="h-8 border border-current px-2 font-mono">
                  {bench.speed}×
                </button>
                <button type="button" onClick={bench.skipToEnd} aria-label="Skip to the end" className="grid size-8 place-items-center border border-current">
                  <FastForward size={15} />
                </button>
                <button type="button" onClick={() => bench.playDemo()} aria-label="Replay from the start" className="grid size-8 place-items-center border border-current">
                  <RotateCcw size={15} />
                </button>
              </div>
              <button
                type="button"
                onClick={bench.reset}
                disabled={api !== "awake"}
                className="ml-auto inline-flex items-center gap-2 bg-ink px-3 py-1.5 font-label font-extrabold uppercase tracking-widest text-seal disabled:opacity-40 dark:bg-seal dark:text-on-seal"
              >
                <Radio size={15} /> Inspect live
              </button>
            </div>
          )}
        </header>

        <nav aria-label="Panels" className="flex border-b-2 border-on-seal lg:hidden dark:border-rule">
          {(["report", "log", "talk"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tab === t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 font-label text-sm font-extrabold uppercase tracking-widest ${tab === t ? "bg-ink text-seal dark:bg-seal dark:text-on-seal" : ""}`}
            >
              {t === "report" ? "Report" : t === "log" ? `Log ${state.log.length || ""}` : "Messages"}
            </button>
          ))}
        </nav>

        <div className="grid flex-1 grid-cols-[minmax(0,1fr)] gap-0 lg:min-h-0 lg:grid-cols-[20rem_minmax(0,1fr)_24rem]">
          <aside className={`${tab === "talk" ? "block" : "hidden"} border-on-seal p-4 lg:block lg:border-r-2 lg:overflow-y-auto dark:border-rule`}>
            <p className="mb-3 font-label text-sm font-extrabold uppercase tracking-widest">{STATUS_TEXT[state.status]}</p>
            {talk}
          </aside>

          <main className={`${tab === "report" ? "block" : "hidden"} p-4 sm:p-6 lg:block lg:overflow-y-auto`} aria-label="Report">
            <div className="mx-auto max-w-4xl pb-40 lg:pb-8">{report}</div>
          </main>

          <aside className={`${tab === "log" ? "flex" : "hidden"} min-h-[60dvh] flex-col bg-paper text-ink lg:flex lg:min-h-0 lg:border-l-2 lg:border-on-seal dark:lg:border-rule`} aria-labelledby="log-title">
            <div className="flex items-baseline justify-between border-b-2 border-ink px-3 py-3">
              <h2 id="log-title" className="font-display text-xl font-black uppercase leading-none">
                Limits and log
              </h2>
            </div>
            <LimitsPanel
              modelCalls={state.modelCalls}
              toolCalls={state.toolCalls}
              maxModel={maxModel}
              maxTools={maxTools}
              maxTokens={limits?.tokens_per_run ?? 400_000}
              maxSeconds={limits?.seconds_per_run ?? 600}
              budget={state.budget}
              daily={limits ? { used: limits.daily_calls_used, limit: limits.daily_calls_limit } : undefined}
            />
            <div className="min-h-0 flex-1">
              <TraceLog entries={state.log} onEvidence={setEvidence} live={state.status === "running"} active={tab === "log"} />
            </div>
          </aside>
        </div>

        <div className="sticky bottom-0 z-20 border-t-2 border-on-seal bg-seal p-3 sm:px-6 dark:border-rule dark:bg-ground">
          <div className="mx-auto max-w-4xl">
            <Composer
              disabled={busy || state.status === "awaiting_approval" || api !== "awake"}
              onSend={bench.send}
              placeholder={
                api === "awake"
                  ? state.model
                    ? `Ask a follow-up about ${state.model}`
                    : "Which model should I inspect? For example: google gemini-3.5-flash-lite"
                  : api === "waking" ? "The live service is waking up. About a minute." : api === "checking" ? "Checking the live service" : "The live service did not answer. Reload to try again."
              }
            />
          </div>
        </div>

        <EvidenceDrawer id={evidence} recorded={recorded} onClose={() => setEvidence(null)} />
      </div>
    </MotionConfig>
  );
}
