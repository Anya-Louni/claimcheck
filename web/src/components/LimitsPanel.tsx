import { Stubs } from "@/components/Stubs";
import type { Budget } from "@/lib/inspection";

// A ruled measuring tape: the filled length is what has been used.
function Tape({ label, used, max, unit }: { label: string; used: number; max: number; unit: string }) {
  const share = Math.min(1, max ? used / max : 0);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-label text-xs font-extrabold uppercase tracking-widest">{label}</span>
        <span className="font-mono text-xs tabular">
          {used.toLocaleString("en-US")} of {max.toLocaleString("en-US")} {unit}
        </span>
      </div>
      <div
        className="relative mt-1 h-3 border border-ink"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={used}
      >
        <div className="h-full bg-ink" style={{ width: `${share * 100}%` }} />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage: "repeating-linear-gradient(to right, transparent 0 calc(10% - 1px), var(--steel) calc(10% - 1px) 10%)",
          }}
        />
      </div>
    </div>
  );
}

export function LimitsPanel({
  modelCalls,
  toolCalls,
  maxModel,
  maxTools,
  maxTokens,
  maxSeconds,
  budget,
  daily,
}: {
  modelCalls: number;
  toolCalls: number;
  maxModel: number;
  maxTools: number;
  maxTokens: number;
  maxSeconds: number;
  budget?: Budget;
  daily?: { used: number; limit: number };
}) {
  const dailyUsed = budget?.dailyCalls ?? daily?.used;
  const dailyLimit = budget?.dailyLimit ?? daily?.limit;
  return (
    <section aria-labelledby="limits-title" className="space-y-3 border-b-2 border-ink px-3 py-3">
      <h3 id="limits-title" className="sr-only">
        Limits
      </h3>
      <Stubs used={modelCalls} total={maxModel} label="Model calls" />
      <Stubs used={toolCalls} total={maxTools} label="Tool calls" />
      <Tape label="Tokens" used={budget?.tokens ?? 0} max={budget?.maxTokens ?? maxTokens} unit="" />
      <Tape label="Time" used={Math.round(budget?.seconds ?? 0)} max={budget?.maxSeconds ?? maxSeconds} unit="s" />
      {dailyUsed !== undefined && dailyLimit !== undefined && (
        <p className="flex items-baseline justify-between gap-3 text-xs">
          <span className="font-label font-extrabold uppercase tracking-widest">Provider calls today</span>
          <span className="font-mono tabular">
            {dailyUsed} of {dailyLimit}
          </span>
        </p>
      )}
      <p className="text-xs text-ink-soft">Per-run counts restart when a run resumes after an approval.</p>
    </section>
  );
}
