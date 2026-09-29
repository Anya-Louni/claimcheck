"use client";

import { useState } from "react";
import type { Decision, InterruptValue } from "@/lib/types";

const PURPOSE: Record<string, string> = {
  save_finding: "Save these verdicts so the next inspection of this model can show what changed.",
  draft_models_dev_change: "Draft a models.dev correction for you to review. Nothing is submitted.",
};

// A hold tag hung on the report: the run waits here until a person decides.
export function ApprovalTag({
  value,
  recorded,
  onDecide,
}: {
  value: InterruptValue;
  recorded: boolean;
  onDecide: (decisions: Decision[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => JSON.stringify(value.action_requests[0]?.args ?? {}, null, 2));
  const [reason, setReason] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const count = value.action_requests.length;

  function all(decision: Decision): Decision[] {
    return Array.from({ length: count }, () => decision);
  }

  function submitEdit() {
    try {
      const args = JSON.parse(draft) as Record<string, unknown>;
      const name = value.action_requests[0].name;
      onDecide([{ type: "edit", edited_action: { name, args } }, ...all({ type: "approve" }).slice(1)]);
    } catch {
      setParseError("That is not valid JSON. Fix it or approve the original.");
    }
  }

  return (
    <section
      aria-labelledby="approval-title"
      className="relative border-2 border-on-seal bg-seal p-5 text-on-seal shadow-[0_14px_30px_-14px_rgb(var(--shadow)/0.5)]"
    >
      <span aria-hidden className="absolute left-4 top-4 size-3 rounded-full border-2 border-on-seal bg-paper" />
      <h2 id="approval-title" className="pl-6 font-display text-2xl font-black uppercase leading-none">
        Held for approval
      </h2>
      {value.action_requests.map((request, i) => (
        <div key={`${request.name}-${i}`} className="mt-4">
          <p className="font-mono text-sm font-semibold">{request.name}</p>
          <p className="mt-1 text-sm">{PURPOSE[request.name] ?? "This action changes saved state."}</p>
          {!editing && (
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all bg-paper p-2 font-mono text-xs text-ink">
              {JSON.stringify(request.args, null, 2)}
            </pre>
          )}
        </div>
      ))}

      {recorded ? (
        <p className="mt-4 font-label text-sm font-extrabold uppercase tracking-widest">Approved during the recording.</p>
      ) : editing ? (
        <div className="mt-4">
          <label htmlFor="edit-args" className="font-label text-xs font-extrabold uppercase tracking-widest">
            Edit arguments
          </label>
          <textarea
            id="edit-args"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={8}
            className="mt-1 block w-full bg-paper p-2 font-mono text-xs text-ink"
          />
          {parseError && <p role="alert" className="mt-1 text-sm font-semibold">{parseError}</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={submitEdit} className="bg-on-seal px-4 py-2 font-label text-sm font-extrabold uppercase tracking-widest text-seal">
              Approve edited
            </button>
            <button type="button" onClick={() => setEditing(false)} className="border-2 border-on-seal px-4 py-2 font-label text-sm font-extrabold uppercase tracking-widest">
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onDecide(all({ type: "approve" }))} className="bg-on-seal px-4 py-2 font-label text-sm font-extrabold uppercase tracking-widest text-seal">
              Approve
            </button>
            {count === 1 && (
              <button type="button" onClick={() => setEditing(true)} className="border-2 border-on-seal px-4 py-2 font-label text-sm font-extrabold uppercase tracking-widest">
                Edit
              </button>
            )}
            <button
              type="button"
              onClick={() => onDecide(all({ type: "reject", message: reason.trim() || "Rejected by the reviewer." }))}
              className="border-2 border-on-seal px-4 py-2 font-label text-sm font-extrabold uppercase tracking-widest hover:bg-reject hover:text-on-reject"
            >
              Reject
            </button>
          </div>
          <div>
            <label htmlFor="reject-reason" className="font-label text-xs font-extrabold uppercase tracking-widest">
              Reason, if rejecting
            </label>
            <input
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 block w-full border-b-2 border-on-seal bg-transparent py-1 text-sm"
            />
          </div>
        </div>
      )}
    </section>
  );
}
