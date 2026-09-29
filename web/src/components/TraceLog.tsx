"use client";

import { ArrowUpRight, BadgeCheck, CircleStop, CornerDownLeft, Hand, Layers, Sparkles, Tag } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LogEntry } from "@/lib/inspection";

const ICON: Record<string, React.ReactNode> = {
  tool_call: <ArrowUpRight size={15} />,
  tool_result: <CornerDownLeft size={15} />,
  model: <Sparkles size={15} />,
  middleware: <Layers size={15} />,
  approval: <Hand size={15} />,
  evidence_check: <BadgeCheck size={15} />,
  limit: <CircleStop size={15} />,
  report: <Tag size={15} />,
  answer: <Sparkles size={15} />,
  recorded: <Tag size={15} />,
};

function Row({ entry, onEvidence }: { entry: LogEntry; onEvidence: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(entry.args || (entry.detail && entry.detail.length > 90) || entry.problems?.length);
  const quiet = entry.kind === "middleware";
  const tone =
    entry.kind === "limit" || entry.status === "error"
      ? "text-reject"
      : entry.kind === "approval"
        ? "bg-seal text-on-seal -mx-3 px-3"
        : quiet
          ? "text-ink-soft"
          : "";

  if (entry.kind === "probe_trial") {
    const state = entry.passed === true ? "pass" : entry.passed === false ? "fail" : "error";
    return (
      <li className="flex items-center gap-2 py-1 pl-6 text-sm">
        <span
          aria-hidden
          className={[
            "h-3.5 w-2.5 shrink-0 border",
            state === "pass" && "border-ink bg-ink",
            state === "fail" && "border-reject bg-reject",
            state === "error" && "border-dashed border-carbon",
          ]
            .filter(Boolean)
            .join(" ")}
        />
        <button
          type="button"
          onClick={() => entry.evidenceId && onEvidence(entry.evidenceId)}
          className="min-w-0 truncate text-left hover:underline"
        >
          {entry.title} <span className={state === "fail" ? "text-reject" : "text-ink-soft"}>{entry.detail}</span>
        </button>
      </li>
    );
  }

  return (
    <li className={`py-1.5 ${tone}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0" aria-hidden>
          {ICON[entry.kind] ?? <Layers size={15} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            {expandable ? (
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                className={`min-w-0 truncate text-left font-mono ${quiet ? "text-xs" : "text-sm font-semibold"} hover:underline`}
              >
                {entry.title}
              </button>
            ) : (
              <span className={`min-w-0 truncate font-mono ${quiet ? "text-xs" : "text-sm font-semibold"}`}>{entry.title}</span>
            )}
            {typeof entry.ms === "number" && entry.ms > 0 && !quiet && (
              <span className="ml-auto shrink-0 font-mono text-xs text-ink-soft tabular">
                {entry.ms >= 1000 ? `${(entry.ms / 1000).toFixed(1)} s` : `${entry.ms} ms`}
              </span>
            )}
          </div>
          {entry.detail && !open && !quiet && <p className="truncate text-sm text-ink-soft">{entry.detail}</p>}
          {open && (
            <div className="mt-1 space-y-1">
              {entry.args && (
                <pre className="overflow-x-auto whitespace-pre-wrap break-all bg-paper-2 p-2 font-mono text-xs">
                  {JSON.stringify(entry.args, null, 2)}
                </pre>
              )}
              {entry.detail && <p className="whitespace-pre-wrap break-words text-sm text-ink-soft">{entry.detail}</p>}
              {entry.problems?.map((p) => (
                <p key={p} className="font-mono text-xs">
                  {p}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/** Runs of middleware steps collapse into one line, so the calls stay readable. */
function group(entries: LogEntry[]): (LogEntry | LogEntry[])[] {
  const out: (LogEntry | LogEntry[])[] = [];
  for (const entry of entries) {
    const last = out[out.length - 1];
    if (entry.kind === "middleware" && Array.isArray(last)) last.push(entry);
    else out.push(entry.kind === "middleware" ? [entry] : entry);
  }
  return out;
}

export function TraceLog({
  entries,
  onEvidence,
  live,
  active = true,
}: {
  entries: LogEntry[];
  onEvidence: (id: string) => void;
  live: boolean;
  active?: boolean;
}) {
  const end = useRef<HTMLLIElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    if (stick.current) end.current?.scrollIntoView({ block: "nearest" });
  }, [entries.length, active]);

  function check() {
    const el = box.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  return (
    <div
      ref={box}
      // Only the reader's own scrolling can unstick the log; new entries never do.
      onWheel={() => requestAnimationFrame(check)}
      onTouchMove={() => requestAnimationFrame(check)}
      onKeyDown={() => requestAnimationFrame(check)}
      className="h-full overflow-y-auto px-3"
    >
      {entries.length === 0 ? (
        <p className="py-6 text-sm text-ink-soft">
          Every model call, tool call, probe trial, middleware step and approval appears here as it happens.
        </p>
      ) : (
        <ol aria-live={live ? "polite" : "off"} aria-label="Inspector's log" className="divide-y divide-rule/70 py-2">
          {group(entries).map((item) =>
            Array.isArray(item) ? (
              <li key={item[0].id} className="py-1 font-mono text-xs text-ink-soft">
                <span className="inline-flex items-center gap-2">
                  <Layers size={13} aria-hidden />
                  Middleware: {item.map((e) => e.title.split(".")[0].replace("Middleware", "")).join(", ")}
                </span>
              </li>
            ) : (
              <Row key={item.id} entry={item} onEvidence={onEvidence} />
            ),
          )}
          <li ref={end} aria-hidden />
        </ol>
      )}
    </div>
  );
}
