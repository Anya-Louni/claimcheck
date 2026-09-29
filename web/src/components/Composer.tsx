"use client";

import { Camera, ImagePlus, Mic, Send, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const frame = useRef(0);
  const stopTracks = useRef<() => void>(() => {});

  async function start() {
    setError(null);
    setAudio(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => setAudio(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
      rec.start();
      recorder.current = rec;

      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const started = performance.now();
      const draw = () => {
        const c = canvas.current;
        if (c) {
          const g = c.getContext("2d")!;
          const { width, height } = c;
          analyser.getByteTimeDomainData(data);
          g.clearRect(0, 0, width, height);
          g.strokeStyle = getComputedStyle(c).color;
          g.lineWidth = 2;
          g.beginPath();
          for (let i = 0; i < data.length; i++) {
            const x = (i / (data.length - 1)) * width;
            const y = (data[i] / 255) * height;
            if (i === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.stroke();
        }
        setSeconds(Math.floor((performance.now() - started) / 1000));
        frame.current = requestAnimationFrame(draw);
      };
      draw();
      stopTracks.current = () => {
        cancelAnimationFrame(frame.current);
        stream.getTracks().forEach((t) => t.stop());
        context.close();
      };
      setRecording(true);
    } catch {
      setError("Microphone access was blocked. Allow it in the browser, or type the request.");
    }
  }

  function stop() {
    recorder.current?.stop();
    stopTracks.current();
    setRecording(false);
  }

  useEffect(() => () => stopTracks.current(), []);

  return { recording, audio, setAudio, error, seconds, canvas, start, stop };
}

export function Composer({
  disabled,
  onSend,
  placeholder,
}: {
  disabled: boolean;
  onSend: (message: string, images: File[], audio: Blob | null) => void;
  placeholder: string;
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const { recording, audio, setAudio, error: micError, seconds, canvas, start, stop } = useRecorder();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  function addFiles(files: FileList | File[] | null) {
    if (!files) return;
    const next = [...images];
    for (const file of Array.from(files)) {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        setProblem(`${file.name} is not a PNG, JPEG or WebP image.`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setProblem(`${file.name} is larger than 8 MB.`);
        continue;
      }
      if (next.length >= MAX_IMAGES) {
        setProblem(`At most ${MAX_IMAGES} images per message.`);
        break;
      }
      next.push(file);
    }
    setImages(next);
  }

  // Dropping an image anywhere on the bench attaches it.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        setDragging(true);
      }
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      setDragging(false);
      setProblem(null);
      addFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  });

  const ready = !disabled && !recording && (text.trim() || images.length > 0 || audio);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    onSend(text.trim(), images, audio);
    setText("");
    setImages([]);
    setAudio(null);
    setProblem(null);
  }

  return (
    <form onSubmit={submit} className="relative border-2 border-ink bg-paper text-ink has-[textarea:focus-visible]:outline-3 has-[textarea:focus-visible]:outline-offset-3 has-[textarea:focus-visible]:outline-carbon">
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-seal/85 text-on-seal">
          <p className="border-4 border-dashed border-on-seal px-10 py-8 font-display text-4xl font-black uppercase">
            Drop the model page here
          </p>
        </div>
      )}

      {(images.length > 0 || audio) && (
        <ul className="flex flex-wrap gap-2 border-b border-rule p-2" aria-label="Attachments">
          {images.map((file, i) => (
            <li key={`${file.name}-${i}`} className="flex items-center gap-2 border border-ink bg-paper-2 py-1 pl-2 pr-1 text-sm">
              <span className="max-w-40 truncate">{file.name}</span>
              <button type="button" aria-label={`Remove ${file.name}`} className="p-1 hover:text-reject" onClick={() => setImages(images.filter((_, j) => j !== i))}>
                <X size={14} />
              </button>
            </li>
          ))}
          {audio && (
            <li className="flex items-center gap-2 border border-ink bg-paper-2 py-1 pl-2 pr-1 text-sm">
              Voice note, {seconds} s
              <button type="button" aria-label="Remove voice note" className="p-1 hover:text-reject" onClick={() => setAudio(null)}>
                <X size={14} />
              </button>
            </li>
          )}
        </ul>
      )}

      {recording ? (
        <div className="flex h-[4.5rem] items-center gap-3 px-3">
          <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-reject" aria-hidden />
          <canvas ref={canvas} width={600} height={56} className="h-14 min-w-0 flex-1 text-carbon" aria-label="Live microphone waveform" />
          <span className="font-mono text-sm tabular">{seconds}s</span>
        </div>
      ) : (
        <>
          <label htmlFor="request" className="sr-only">
            Request
          </label>
          <textarea
            id="request"
            rows={2}
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) submit(e);
            }}
            placeholder={placeholder}
            className="block w-full resize-none bg-transparent px-3 pt-3 text-base placeholder:text-ink-soft focus:outline-none disabled:opacity-60"
          />
        </>
      )}

      <div className="flex items-center gap-1 p-2">
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => addFiles(e.target.files)} />
        <IconButton label="Attach a screenshot" onClick={() => fileInput.current?.click()} disabled={disabled}>
          <ImagePlus size={20} />
        </IconButton>
        <IconButton label="Take a photo" onClick={() => cameraInput.current?.click()} disabled={disabled} className="sm:hidden">
          <Camera size={20} />
        </IconButton>
        {recording ? (
          <IconButton label="Stop recording" onClick={stop} className="text-reject">
            <Square size={18} fill="currentColor" />
          </IconButton>
        ) : (
          <IconButton label="Record a voice note" onClick={start} disabled={disabled}>
            <Mic size={20} />
          </IconButton>
        )}
        <button
          type="submit"
          disabled={!ready}
          className="ml-auto inline-flex items-center gap-2 bg-ink px-4 py-2.5 font-label text-sm font-extrabold uppercase tracking-widest text-paper transition-opacity disabled:cursor-not-allowed disabled:opacity-35"
        >
          Inspect
          <Send size={16} />
        </button>
      </div>
      {(problem || micError) && (
        <p role="alert" className="border-t border-rule px-3 py-2 text-sm text-reject">
          {problem ?? micError}
        </p>
      )}
    </form>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  className = "",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid size-10 place-items-center hover:bg-paper-2 disabled:opacity-35 ${className}`}
    >
      {children}
    </button>
  );
}
