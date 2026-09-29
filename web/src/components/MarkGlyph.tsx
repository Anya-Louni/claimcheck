import type { Verdict } from "@/lib/types";

// The verdict is the mark itself: a die-cut seal, a red reject tag, a dashed hold
// sticker, a blank label, or a voided square. Shape and word carry it, not color.

export const VERDICT_WORD: Record<Verdict, string> = {
  confirmed: "Sealed",
  contradicted: "Rejected",
  inconclusive: "Hold",
  unclaimed: "No claim",
  not_probed: "Not tested",
};

export const VERDICT_MEANING: Record<Verdict, string> = {
  confirmed: "The observation matches the claim.",
  contradicted: "The observation differs from the claim.",
  inconclusive: "Trials split or errored. No verdict.",
  unclaimed: "No source states a value.",
  not_probed: "This run did not test it.",
};

function rosette(cx: number, cy: number, r: number, bumps: number, depth: number): string {
  const points: string[] = [];
  const steps = bumps * 4;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rr = r - depth * (0.5 - 0.5 * Math.cos(a * bumps));
    points.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `M${points.join("L")}Z`;
}

const SEAL_EDGE = rosette(50, 50, 48, 22, 4);

function Seal({ label }: { label: string }) {
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
      <path d={SEAL_EDGE} fill="var(--seal)" stroke="var(--on-seal)" strokeWidth="1.4" />
      <circle cx="50" cy="50" r="35" fill="none" stroke="var(--on-seal)" strokeWidth="2.2" />
      <circle cx="50" cy="50" r="30" fill="none" stroke="var(--on-seal)" strokeWidth="0.9" strokeDasharray="2 3" />
      <text x="50" y="60" textAnchor="middle" fontSize="30" fontWeight="900" fill="var(--on-seal)" fontFamily="var(--font-stencil)">
        {label}
      </text>
    </svg>
  );
}

function RejectTag({ label }: { label: string }) {
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
      <path d="M50 4 C 40 14, 26 10, 24 22" fill="none" stroke="var(--ink)" strokeWidth="1.2" />
      <path d="M22 18 L78 18 L90 30 L90 92 L10 92 L10 30 Z" fill="var(--reject)" />
      <circle cx="24" cy="30" r="5" fill="var(--paper)" stroke="var(--on-reject)" strokeWidth="1.2" />
      <text
        x="50"
        y="64"
        textAnchor="middle"
        fontSize="21"
        fontWeight="900"
        fill="var(--on-reject)"
        fontFamily="var(--font-stencil)"
      >
        {label}
      </text>
      <line x1="18" y1="74" x2="82" y2="74" stroke="var(--on-reject)" strokeWidth="1" />
      <line x1="18" y1="81" x2="62" y2="81" stroke="var(--on-reject)" strokeWidth="1" />
    </svg>
  );
}

function HoldSticker({ label }: { label: string }) {
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
      <rect x="8" y="22" width="84" height="56" rx="6" fill="var(--paper)" stroke="var(--carbon)" strokeWidth="3" strokeDasharray="7 5" />
      <text x="50" y="59" textAnchor="middle" fontSize="24" fontWeight="900" fill="var(--carbon)" fontFamily="var(--font-stencil)">
        {label}
      </text>
    </svg>
  );
}

function Blank() {
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
      <circle cx="50" cy="50" r="40" fill="none" stroke="var(--carbon)" strokeWidth="1.5" />
      <text textAnchor="middle" fontSize="19" fontWeight="900" fill="var(--carbon)" fontFamily="var(--font-stencil)">
        <tspan x="50" y="47">NO</tspan>
        <tspan x="50" y="66">CLAIM</tspan>
      </text>
    </svg>
  );
}

function Void({ label }: { label: string }) {
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
      <rect x="14" y="24" width="72" height="52" fill="none" stroke="var(--ink-soft)" strokeWidth="1.5" />
      <line x1="14" y1="76" x2="86" y2="24" stroke="var(--ink-soft)" strokeWidth="1.5" />
      <text x="50" y="58" textAnchor="middle" fontSize="22" fontWeight="900" fill="var(--ink-soft)" fontFamily="var(--font-stencil)" paintOrder="stroke" stroke="var(--paper)" strokeWidth="5">
        {label}
      </text>
    </svg>
  );
}

const SHORT: Record<Verdict, string> = {
  confirmed: "OK",
  contradicted: "REJECT",
  inconclusive: "HOLD",
  unclaimed: "NO CLAIM",
  not_probed: "VOID",
};

/** Small stable tilt per key, so a sheet of seals looks hand-applied but never shifts. */
export function tiltFor(key: string, spread = 9): number {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return ((Math.abs(h) % 1000) / 1000 - 0.5) * 2 * spread;
}

export function MarkBody({ verdict }: { verdict: Verdict }) {
  const label = SHORT[verdict];
  if (verdict === "confirmed") return <Seal label={label} />;
  if (verdict === "contradicted") return <RejectTag label={label} />;
  if (verdict === "inconclusive") return <HoldSticker label={label} />;
  if (verdict === "unclaimed") return <Blank />;
  return <Void label={label} />;
}

export function markLabel(verdict: Verdict): string {
  return `${VERDICT_WORD[verdict]}: ${VERDICT_MEANING[verdict]}`;
}

/** A still mark, no script needed. */
export function MarkGlyph({ verdict, size = 56, tiltKey = "" }: { verdict: Verdict; size?: number; tiltKey?: string }) {
  return (
    <span
      role="img"
      aria-label={markLabel(verdict)}
      className="inline-block shrink-0"
      style={{ width: size, height: size, transform: `rotate(${tiltKey ? tiltFor(tiltKey) : 0}deg)` }}
    >
      <MarkBody verdict={verdict} />
    </span>
  );
}
