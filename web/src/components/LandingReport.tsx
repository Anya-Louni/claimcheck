"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ReportSheet, type SheetRow } from "@/components/ReportSheet";

// The drawer's code loads only when a visitor opens a transcript.
const EvidenceDrawer = dynamic(() => import("@/components/EvidenceDrawer").then((m) => m.EvidenceDrawer), { ssr: false });

// The landing page's real report, with every transcript one click away.
export function LandingReport({ model, integration, rows }: { model: string; integration: string; rows: SheetRow[] }) {
  const [evidence, setEvidence] = useState<string | null>(null);
  return (
    <>
      <ReportSheet
        className="lg:-rotate-1"
        compact
        headingLevel={2}
        markSize={40}
        model={model}
        maker="Google, Gemini API"
        integration={integration}
        stamped="Recorded 29 Sep 2026"
        rows={rows}
        onEvidence={setEvidence}
        footer={
          <p className="text-ink-soft">
            <span className="font-semibold text-ink">Audio input sealed as claimed false.</span> All three calls came
            back with the provider error “Audio input modality is not enabled for this model”.
          </p>
        }
      />
      {evidence && <EvidenceDrawer id={evidence} recorded onClose={() => setEvidence(null)} />}
    </>
  );
}
