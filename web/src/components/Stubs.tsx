// A strip of seal stubs, one per allowed call. Each call tears one off: what is
// left of the budget stays visible at a glance, like a roll of inspection seals.

function Stub({ torn }: { torn: boolean }) {
  return (
    <svg viewBox="0 0 12 20" width="12" height="20" aria-hidden className="shrink-0">
      {torn ? (
        <path
          d="M1 19 V11 L3 9.5 L5 11 L7 9.5 L9 11 L11 9.5 V19 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="1.5 1.5"
          opacity="0.55"
        />
      ) : (
        <>
          <path d="M1 3 L3 1 L5 3 L7 1 L9 3 L11 1 V19 H1 Z" fill="currentColor" />
          <circle cx="6" cy="9" r="2.2" fill="var(--paper)" />
        </>
      )}
    </svg>
  );
}

export function Stubs({ used, total, label }: { used: number; total: number; label: string }) {
  const left = Math.max(0, total - used);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-label text-xs font-extrabold uppercase tracking-widest">{label}</span>
        <span className="font-mono text-xs tabular">
          {left} of {total} left
        </span>
      </div>
      <div
        className="mt-1 flex flex-wrap gap-[2px]"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={Math.min(used, total)}
        aria-valuetext={`${left} of ${total} left`}
      >
        {Array.from({ length: total }, (_, i) => (
          <Stub key={i} torn={i < used} />
        ))}
      </div>
    </div>
  );
}
