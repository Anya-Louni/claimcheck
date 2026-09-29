// A lead-and-wire seal: the wire threads the sheet, the flat stamped disc carries the mark.
export function LeadSeal({ className = "", stamp = "CC" }: { className?: string; stamp?: string }) {
  return (
    <svg viewBox="0 0 120 160" className={className} aria-hidden>
      <path
        d="M20 4 C 10 40, 70 36, 58 74 M72 4 C 88 36, 40 44, 62 74"
        fill="none"
        stroke="var(--ink)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <g transform="translate(60 104)">
        <circle r="31" fill="var(--steel)" stroke="var(--ink)" strokeWidth="2" />
        <circle r="24" fill="none" stroke="var(--ink)" strokeWidth="1" strokeDasharray="3 3" />
        <text y="8" textAnchor="middle" fontSize="22" fontWeight="900" fill="var(--ink)" fontFamily="var(--font-stencil)">
          {stamp}
        </text>
      </g>
    </svg>
  );
}
