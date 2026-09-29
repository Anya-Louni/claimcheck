"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { audioUrl, getEvidence } from "@/lib/api";

type Record_ = Record<string, unknown>;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-rule py-2">
      <dt className="font-label text-xs font-extrabold uppercase tracking-widest text-carbon">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all bg-paper-2 p-2 font-mono text-xs">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function ProbeImage({ id, recorded }: { id: string; recorded: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    getEvidence(id, recorded).then((r) => r && setSrc(`data:image/png;base64,${r.png_base64}`));
  }, [id, recorded]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="The test image this trial sent." className="w-full border border-ink" /> : <p className="text-sm">Loading image</p>;
}

export function EvidenceDrawer({ id, recorded, onClose }: { id: string | null; recorded: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [loaded, setLoaded] = useState<{ id: string; record: Record_ | "missing" } | null>(null);
  const record = loaded && loaded.id === id ? loaded.record : null;

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (id) {
      if (!d.open) d.showModal();
      getEvidence(id, recorded).then((r) => setLoaded({ id, record: r ?? "missing" }));
    } else if (d.open) {
      d.close();
    }
  }, [id, recorded]);

  const request = record && record !== "missing" ? (record.request as Record_ | undefined) : undefined;
  const response = record && record !== "missing" ? (record.response as Record_ | undefined) : undefined;

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}
      aria-labelledby="evidence-title"
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-lg bg-paper text-ink backdrop:bg-ink/50 open:animate-[drawer_320ms_var(--ease-stamp)]"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between gap-3 border-b-2 border-ink px-5 py-4">
          <div>
            <p className="font-label text-xs font-extrabold uppercase tracking-widest text-carbon">Evidence</p>
            <h2 id="evidence-title" className="font-mono text-lg font-semibold">
              {id}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close evidence" className="grid size-10 place-items-center border-2 border-ink hover:bg-ink hover:text-paper">
            <X size={18} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {record === null && <p className="py-6 text-sm text-ink-soft">Opening the transcript</p>}
          {record === "missing" && (
            <p className="py-6 text-sm text-reject">This evidence file could not be found. It may belong to another server&apos;s data.</p>
          )}
          {record && record !== "missing" && (
            <dl>
              <Field label="Kind">{String(record.kind)}</Field>
              {"capability" in record && (
                <Field label="Probe">
                  {String(record.capability)}, trial {String(record.trial)}, {String(record.path)} path
                </Field>
              )}
              {"model" in record && <Field label="Model"><span className="font-mono">{String(record.model)}</span></Field>}
              {"passed" in record && (
                <Field label="Scored">
                  {record.passed === true ? "Pass: the known answer came back." : record.passed === false ? "Fail." : "Error: does not count for or against."}
                </Field>
              )}
              {"ms" in record && <Field label="Duration"><span className="font-mono tabular">{String(record.ms)} ms</span></Field>}
              <Field label="Recorded">
                <span className="font-mono">{String(record.created_at)}</span>
              </Field>
              {request && (
                <Field label="Sent">
                  {"prompt" in request && <p className="mb-2">{String(request.prompt)}</p>}
                  {"image_evidence_id" in request && <ProbeImage id={String(request.image_evidence_id)} recorded={recorded} />}
                  {"audio_fixture" in request && (
                    <audio controls preload="none" className="mt-1 w-full" src={audioUrl(String(request.audio_fixture), recorded)}>
                      Your browser cannot play this clip.
                    </audio>
                  )}
                  {"expected" in request && (
                    <p className="mt-2 text-sm">
                      Expected: <span className="font-mono">{typeof request.expected === "string" ? request.expected : JSON.stringify(request.expected)}</span>
                    </p>
                  )}
                  {!("prompt" in request) && <Json value={request} />}
                </Field>
              )}
              {response && (
                <Field label="Came back">
                  {response.error ? <p className="font-mono text-sm text-reject">{String(response.error)}</p> : null}
                  {response.text ? <p className="whitespace-pre-wrap">{String(response.text)}</p> : null}
                  {Array.isArray(response.tool_calls) && response.tool_calls.length > 0 && <Json value={response.tool_calls} />}
                  {response.parsed ? <Json value={response.parsed} /> : null}
                </Field>
              )}
              {record.kind === "metadata" && (
                <Field label="Provider metadata">
                  <p className="font-mono text-sm">{String(record.endpoint)}</p>
                  <Json value={record.response} />
                </Field>
              )}
              {record.kind === "source" && (
                <Field label="Fetched page, untrusted">
                  <a href={String(record.url)} className="break-all text-carbon underline" rel="noreferrer noopener" target="_blank">
                    {String(record.url)}
                  </a>
                  <Json value={record.content} />
                </Field>
              )}
            </dl>
          )}
        </div>
      </div>
    </dialog>
  );
}
