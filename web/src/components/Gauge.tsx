import type { Trial } from "@/lib/inspection";

// A graduated test measure lying on its side: one chamber per trial between
// graduation marks. A pass fills its chamber, a fail is struck through, an
// error is left dashed, and a pending trial stays empty. Each chamber opens
// its transcript.

const CHAMBER = 24;
const HEIGHT = 24;

export function Gauge({
  trials,
  of = 3,
  onOpen,
}: {
  trials: Trial[];
  of?: number;
  onOpen?: (evidenceId: string) => void;
}) {
  const total = Math.max(of, trials.length, trials[0]?.of ?? 0);
  const width = total * CHAMBER + 4;
  const passes = trials.filter((t) => t.passed === true).length;
  return (
    <span className="relative inline-block shrink-0" style={{ width, height: HEIGHT + 6 }}>
      <svg viewBox={`0 0 ${width} ${HEIGHT + 6}`} width={width} height={HEIGHT + 6} aria-hidden className="absolute inset-0">
        <rect x="1" y="1" width={width - 2} height={HEIGHT} rx="3" fill="var(--paper)" stroke="var(--ink)" strokeWidth="1.5" />
        {Array.from({ length: total }, (_, i) => {
          const t = trials[i];
          const x = 2 + i * CHAMBER;
          const state = !t ? "pending" : t.passed === true ? "pass" : t.passed === false ? "fail" : "error";
          return (
            <g key={i}>
              {state === "pass" && <rect x={x + 1.5} y="3.5" width={CHAMBER - 3} height={HEIGHT - 5} fill="var(--ink)" />}
              {state === "fail" && <line x1={x + 3} y1={HEIGHT - 1} x2={x + CHAMBER - 3} y2="4" stroke="var(--reject)" strokeWidth="2.2" />}
              {state === "error" && (
                <rect x={x + 2.5} y="4.5" width={CHAMBER - 5} height={HEIGHT - 7} fill="none" stroke="var(--carbon)" strokeDasharray="2 2" />
              )}
              {i > 0 && <line x1={x} y1="1" x2={x} y2={HEIGHT + 1} stroke="var(--ink)" strokeWidth="1" />}
              <line x1={x + CHAMBER} y1={HEIGHT + 1} x2={x + CHAMBER} y2={HEIGHT + 5} stroke="var(--ink)" strokeWidth="1" />
            </g>
          );
        })}
        <line x1="2" y1={HEIGHT + 1} x2="2" y2={HEIGHT + 5} stroke="var(--ink)" strokeWidth="1" />
      </svg>
      <span className="sr-only">
        {passes} of {total} trials passed
      </span>
      {onOpen && (
        <span className="absolute inset-0 flex px-[2px]">
          {Array.from({ length: total }, (_, i) => {
            const t = trials[i];
            if (!t) return <span key={i} style={{ width: CHAMBER }} />;
            const state = t.passed === true ? "pass" : t.passed === false ? "fail" : "error";
            const label = `Trial ${i + 1}: ${state}. Open transcript.`;
            return (
              <button
                key={i}
                type="button"
                aria-label={label}
                title={label}
                onClick={() => onOpen(t.evidence_id)}
                style={{ width: CHAMBER }}
                className="h-6 cursor-pointer hover:bg-carbon/20"
              />
            );
          })}
        </span>
      )}
    </span>
  );
}
