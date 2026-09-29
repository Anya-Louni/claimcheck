"use client";

import { motion, useReducedMotion } from "motion/react";
import { MarkBody, markLabel, tiltFor } from "@/components/MarkGlyph";
import type { Verdict } from "@/lib/types";

/** A mark that lands like a stamp: one short press, settled with an exponential ease-out. */
export default function StampedMark({ verdict, size = 56, tiltKey = "" }: { verdict: Verdict; size?: number; tiltKey?: string }) {
  const reduce = useReducedMotion();
  const tilt = tiltKey ? tiltFor(tiltKey) : 0;
  return (
    <motion.span
      role="img"
      aria-label={markLabel(verdict)}
      className="inline-block shrink-0"
      style={{ width: size, height: size }}
      initial={reduce ? false : { scale: 1.35, rotate: tilt - 14, filter: "blur(3px)" }}
      animate={{ scale: 1, rotate: tilt, filter: "blur(0px)" }}
      transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
    >
      <MarkBody verdict={verdict} />
    </motion.span>
  );
}
