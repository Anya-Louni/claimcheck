import Link from "next/link";
import { ArrowRight, Radio } from "lucide-react";
import { LeadSeal } from "@/components/LeadSeal";
import { MarkGlyph as Mark } from "@/components/MarkGlyph";
import { SiteHeader, Wordmark } from "@/components/SiteHeader";
import { Stubs } from "@/components/Stubs";
import { LandingReport } from "@/components/LandingReport";
import evals from "@/data/evals.json";
import sampleImage from "@/data/image-probe-0.json";
import { recordedState } from "@/lib/recorded";
import { sheetRows } from "@/lib/rows";

const PROBES = [
  {
    name: "Tool calling",
    sent: "“What is the weather in Paris right now? Use the get_weather tool.”",
    passes: "get_weather is called with Paris.",
  },
  {
    name: "Forced tool choice",
    sent: "“Tell me one short fact about owls”, with tool_choice set to add_numbers.",
    passes: "add_numbers is called anyway.",
  },
  {
    name: "Parallel tool calls",
    sent: "Weather for Paris and for Tokyo, asked for in the same response.",
    passes: "Both cities come back in one message. No profile field covers this, so it is logged as unclaimed.",
  },
  {
    name: "Native structured output",
    sent: "“Dune was written by Frank Herbert and published in 1965”, with a JSON schema. Not tool calling.",
    passes: "Title, author and year parse exactly.",
  },
  {
    name: "Image input",
    sent: "A PNG drawn on the spot with one word, one four digit number and a filled circle.",
    passes: "The word, the number and the circle color all come back.",
  },
  {
    name: "Audio input",
    sent: "A clip of five spoken digits, synthesized offline.",
    passes: "The transcribed digits match exactly.",
  },
];

const LAYERS = [
  {
    layer: "Model",
    test: "The same probe fails through LangChain and through the provider SDK.",
    fix: "The model cannot do it. If a profile says it can, the profile data is wrong.",
  },
  {
    layer: "LangChain integration",
    test: "It passes through the provider SDK and fails through LangChain.",
    fix: "An issue on the integration package, with the two transcripts side by side.",
  },
  {
    layer: "Profile data",
    test: "The claim disagrees with what the model does, or LangChain has no value at all.",
    fix: "A models.dev pull request, or regenerated profile data in the integration package.",
  },
];

export default function Home() {
  const demo = recordedState("gemma-4-26b");
  const report = demo.report!;
  const rows = sheetRows(demo);
  const evalRows = evals.rows;
  const passed = evalRows.filter((r) => r.passed).length;
  const corrected = evalRows.filter((r) => r.corrections > 0).length;

  return (
    <>
      {/* The inspection station: seal-yellow ground, the real report on paper. */}
      <div className="bg-seal text-on-seal dark:bg-ground dark:text-ink">
        <SiteHeader />
        <section className="mx-auto grid max-w-7xl gap-x-16 gap-y-8 px-4 pb-20 pt-2 sm:px-8 sm:pt-6 lg:grid-cols-[1fr_minmax(0,34rem)] lg:grid-rows-[auto_1fr] lg:pb-28 lg:pt-12">
          <div className="flex flex-col justify-end">
            <h1 className="max-w-[11ch] text-balance font-display text-[clamp(3.25rem,9vw,6rem)] font-black uppercase leading-[0.86] tracking-[-0.01em] dark:text-seal">
              Model claims, inspected.
            </h1>
            <p className="mt-5 max-w-[52ch] text-base leading-relaxed sm:mt-8 sm:text-xl">
              Claimcheck tests what a LangChain model profile says a model can do. Each claim goes into a
              known test three times, then gets sealed or rejected, with every transcript attached.
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:mt-10 sm:flex-row sm:items-center sm:gap-3">
              <Link
                href="/inspect"
                className="group inline-flex items-center justify-center gap-3 bg-ink px-6 py-3.5 font-label text-base font-extrabold uppercase tracking-widest text-seal no-underline transition-transform hover:-translate-y-0.5 sm:py-4 dark:bg-seal dark:text-on-seal"
              >
                Watch a recorded inspection
                <ArrowRight size={18} strokeWidth={2.5} className="transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                href="/inspect?live=1"
                className="inline-flex items-center justify-center gap-3 border-2 border-current px-6 py-3 font-label text-base font-extrabold uppercase tracking-widest no-underline transition-colors hover:bg-ink hover:text-seal sm:py-[0.875rem] dark:hover:bg-seal dark:hover:text-on-seal"
              >
                <Radio size={18} strokeWidth={2.5} />
                Inspect a model live
              </Link>
            </div>
          </div>

          <div className="relative lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:pt-4">
            <LeadSeal className="absolute -right-3 -top-10 z-10 w-16 rotate-6 sm:w-20" stamp="CC" />
            <LandingReport
              model={report.model}
              integration={report.integration_version}
              rows={rows}
            />
          </div>

          <p className="max-w-[60ch] self-start text-sm lg:col-start-1">
            Google Gemini models on the free tier. Built on LangChain <code className="font-mono">create_agent</code> and
            LangGraph. The report shown here is from a real, recorded run: open any gauge chamber for its transcript.
          </p>
        </section>
      </div>

      <main className="bg-paper text-ink">
        {/* The measure: what is poured in and what counts as a pass. */}
        <section id="method" className="below-fold mx-auto max-w-7xl scroll-mt-8 px-4 py-24 sm:px-8 lg:py-32">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,22rem)_1fr] lg:gap-20">
            <div>
              <h2 className="font-display text-5xl font-black uppercase leading-[0.9] sm:text-6xl">
                Six probes. Known answers.
              </h2>
              <p className="mt-6 max-w-[48ch] leading-relaxed text-ink-soft">
                A probe sends the same fixed input three times and scores the reply with plain code. Errors
                like rate limits do not count as failures. When a result disagrees with a claim, the same
                probe runs again through the provider SDK, skipping LangChain.
              </p>
              <p className="mt-4 max-w-[48ch] leading-relaxed text-ink-soft">
                Token limits come from the provider&apos;s own model metadata. Context size is never tested by
                sending huge prompts.
              </p>
            </div>
            <div>
              <ol className="border-t-2 border-ink">
                {PROBES.map((probe) => (
                  <li key={probe.name} className="grid gap-2 border-b border-rule py-5 md:grid-cols-[12rem_1fr_1fr] md:gap-6">
                    <h3 className="font-label text-lg font-extrabold uppercase tracking-wide">{probe.name}</h3>
                    <p className="leading-relaxed">{probe.sent}</p>
                    <p className="leading-relaxed text-ink-soft">
                      <span className="font-label text-xs font-extrabold uppercase tracking-widest text-carbon">Passes when </span>
                      {probe.passes}
                    </p>
                  </li>
                ))}
              </ol>
              <div className="mt-10 grid gap-8 sm:grid-cols-2">
                <figure>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/probes/image-probe-0.png"
                    loading="lazy"
                    decoding="async"
                    width={640}
                    height={360}
                    alt={`Image probe input: the word ${sampleImage.word}, the number ${sampleImage.number} and a ${sampleImage.color} circle on white.`}
                    className="w-full border-2 border-ink"
                  />
                  <figcaption className="mt-2 text-sm text-ink-soft">
                    Image probe, seed 0. Expected answer:{" "}
                    <span className="font-mono">
                      {sampleImage.word} {sampleImage.number} {sampleImage.color.toUpperCase()}
                    </span>
                  </figcaption>
                </figure>
                <figure className="flex flex-col justify-between border-2 border-ink p-5">
                  <div>
                    <p className="font-label text-xs font-extrabold uppercase tracking-widest text-carbon">Audio probe clip</p>
                    <p className="mt-2 font-mono text-4xl tabular">3 9 1 4 7</p>
                  </div>
                  <audio controls preload="none" src="/demo/audio/digits_39147.wav" className="mt-6 w-full">
                    Your browser cannot play this clip.
                  </audio>
                  <figcaption className="mt-2 text-sm text-ink-soft">Spoken by the operating system&apos;s offline voice.</figcaption>
                </figure>
              </div>
            </div>
          </div>
        </section>

        {/* The computed seal: the model's word, struck, and the code's mark. */}
        <section className="below-fold bg-ink text-paper dark:bg-paper-2 dark:text-ink">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 py-24 sm:px-8 lg:grid-cols-2 lg:gap-20 lg:py-32">
            <div>
              <h2 className="font-display text-5xl font-black uppercase leading-[0.9] text-seal sm:text-6xl">
                The agent writes the report. Code applies the marks.
              </h2>
              <p className="mt-6 max-w-[52ch] text-lg leading-relaxed">
                When the agent answers, a middleware reopens every transcript it cited, votes the trials,
                compares them with the claim and sets the verdict itself. Invented evidence ids are dropped.
                Every change is listed on the report.
              </p>
              <p className="mt-4 max-w-[52ch] leading-relaxed opacity-85">
                In the latest eval run the check changed model-written verdicts in {corrected} of {evalRows.length} cases.
              </p>
            </div>
            <figure className="form-paper paper-shadow rotate-1 self-center p-6 text-ink sm:p-8">
              <p className="font-label text-xs font-extrabold uppercase tracking-widest text-carbon">
                Eval case clean-gemma, audio input
              </p>
              <div className="mt-5 grid grid-cols-[1fr_auto] items-center gap-6">
                <dl className="space-y-3">
                  <div>
                    <dt className="text-sm text-ink-soft">Both sources claim</dt>
                    <dd className="font-mono">audio input: no</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-ink-soft">Three trials returned</dt>
                    <dd className="font-mono text-sm">400 “Audio input modality is not enabled”</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-ink-soft">The model wrote</dt>
                    <dd className="font-mono text-reject line-through decoration-2">contradicted</dd>
                  </div>
                </dl>
                <Mark verdict="confirmed" size={104} tiltKey="clean-gemma" />
              </div>
              <figcaption className="mt-6 border-t border-rule pt-4 text-sm text-ink-soft">
                The claim says no audio and the model has none, so the claim holds. Logged by the evidence
                check as “verdict ‘contradicted’ recomputed as ‘confirmed’”.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* Layers: where a failed claim gets fixed. */}
        <section className="below-fold mx-auto max-w-7xl px-4 py-24 sm:px-8 lg:py-32">
          <h2 className="max-w-[18ch] font-display text-5xl font-black uppercase leading-[0.9] sm:text-6xl">
            A failed claim goes to the right desk.
          </h2>
          <div role="table" aria-label="Where a fault lives" className="mt-12 border-t-2 border-ink">
            <div role="row" className="hidden grid-cols-[14rem_1fr_1fr] gap-6 border-b border-ink py-3 font-label text-xs font-extrabold uppercase tracking-widest text-carbon md:grid">
              <span role="columnheader">Layer</span>
              <span role="columnheader">How it shows</span>
              <span role="columnheader">Where the fix goes</span>
            </div>
            {LAYERS.map((row) => (
              <div role="row" key={row.layer} className="grid gap-2 border-b border-rule py-5 md:grid-cols-[14rem_1fr_1fr] md:gap-6">
                <span role="cell" className="font-label text-lg font-extrabold uppercase tracking-wide">
                  {row.layer}
                </span>
                <span role="cell" className="leading-relaxed">
                  {row.test}
                </span>
                <span role="cell" className="leading-relaxed text-ink-soft">
                  {row.fix}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-12 grid items-start gap-6 md:grid-cols-[auto_1fr]">
            <Mark verdict="inconclusive" size={88} tiltKey="gemini-3.8-flash" />
            <p className="max-w-[70ch] text-lg leading-relaxed">
              <span className="font-semibold">Found on 29 Sep 2026:</span> models.dev lists{" "}
              <code className="font-mono">gemini-3.8-flash</code>, released 2 Sep. The installed{" "}
              <code className="font-mono">langchain-google-genai</code> 4.4.0, released 1 Sep, has no profile for it,
              so LangChain agents know nothing about its tools or modalities. That is a profile data problem, fixed in
              the integration package, not in models.dev. The probes themselves stayed on hold: the free tier allows
              20 calls a day on that model.
            </p>
          </div>
        </section>

        {/* Limits printed on the tag. */}
        <section id="limits" className="below-fold scroll-mt-8 bg-seal text-on-seal dark:bg-ground dark:text-ink">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 py-24 sm:px-8 lg:grid-cols-[1fr_minmax(0,30rem)] lg:gap-20 lg:py-32">
            <div>
              <h2 className="font-display text-5xl font-black uppercase leading-[0.9] sm:text-6xl dark:text-seal">
                The limits are printed on the tag.
              </h2>
              <p className="mt-6 max-w-[52ch] text-lg leading-relaxed">
                Every run has hard caps. When one is hit the agent stops and says what it finished. Saving a
                finding and drafting a models.dev change both wait for a person to approve, edit or reject.
                Drafts never leave the app.
              </p>
            </div>
            <div className="border-2 border-current bg-paper p-6 text-ink sm:p-8">
              <p className="font-label text-xs font-extrabold uppercase tracking-widest text-carbon">Per run</p>
              <div className="mt-4 space-y-5">
                <Stubs used={0} total={25} label="Model calls" />
                <Stubs used={0} total={40} label="Tool calls" />
              </div>
              <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-rule pt-5">
                <div>
                  <dt className="text-sm text-ink-soft">Tokens</dt>
                  <dd className="font-mono text-2xl tabular">400,000</dd>
                </div>
                <div>
                  <dt className="text-sm text-ink-soft">Wall clock</dt>
                  <dd className="font-mono text-2xl tabular">600 s</dd>
                </div>
                <div>
                  <dt className="text-sm text-ink-soft">Provider calls a day</dt>
                  <dd className="font-mono text-2xl tabular">400</dd>
                </div>
                <div>
                  <dt className="text-sm text-ink-soft">Runs per address</dt>
                  <dd className="font-mono text-2xl tabular">10 / hour</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        {/* The eval register. */}
        <section id="evals" className="below-fold mx-auto max-w-7xl scroll-mt-8 px-4 py-24 sm:px-8 lg:py-32">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,22rem)_1fr] lg:gap-20">
            <div>
              <h2 className="font-display text-5xl font-black uppercase leading-[0.9] sm:text-6xl">
                {passed} of {evalRows.length} eval cases pass.
              </h2>
              <p className="mt-6 max-w-[48ch] leading-relaxed text-ink-soft">
                Run on {evals.date}. The agent model is called live. Probe results, provider limits, search
                results and the models.dev catalog are replayed from recordings of real runs, so every case
                sees the same evidence. Injected instructions hide in a search result and a screenshot.
              </p>
            </div>
            <div role="table" aria-label="Eval cases" className="border-t-2 border-ink">
              <div role="row" className="grid grid-cols-[1fr_6rem_4rem] gap-4 border-b border-ink py-2 font-label text-xs font-extrabold uppercase tracking-widest text-carbon sm:grid-cols-[1fr_7rem_7rem_4rem]">
                <span role="columnheader">Case</span>
                <span role="columnheader" className="hidden sm:block">
                  Kind
                </span>
                <span role="columnheader" className="tabular">
                  Model calls
                </span>
                <span role="columnheader" className="text-right">
                  Result
                </span>
              </div>
              {evalRows.map((row) => (
                <div role="row" key={row.case} className="grid grid-cols-[1fr_6rem_4rem] items-center gap-4 border-b border-rule py-1.5 sm:grid-cols-[1fr_7rem_7rem_4rem]">
                  <span role="cell" className="font-mono text-sm">
                    {row.case}
                    {!row.passed && <span className="block font-sans text-xs text-reject">Failed: {row.failed_checks}</span>}
                  </span>
                  <span role="cell" className="hidden text-sm text-ink-soft sm:block">
                    {row.kind}
                  </span>
                  <span role="cell" className="font-mono text-sm tabular">
                    {row.model_calls}
                  </span>
                  <span role="cell" className="flex justify-end">
                    <Mark verdict={row.passed ? "confirmed" : "contradicted"} size={40} tiltKey={row.case} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-ink text-paper dark:bg-paper-2 dark:text-ink">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-14 sm:px-8 md:flex-row md:items-end md:justify-between">
          <div>
            <Wordmark className="text-seal" />
            <p className="mt-4 max-w-[56ch] leading-relaxed opacity-90">
              One of three small agents about agent reliability, with Pause and Shakedown. Python, LangChain
              1.4, LangGraph 1.2, FastAPI, Next.js. MIT licensed.
            </p>
          </div>
          <Link
            href="/inspect"
            className="inline-flex items-center gap-3 border-2 border-seal px-5 py-3 font-label font-extrabold uppercase tracking-widest text-seal no-underline hover:bg-seal hover:text-on-seal"
          >
            Open the inspection bench
            <ArrowRight size={18} strokeWidth={2.5} />
          </Link>
        </div>
      </footer>
    </>
  );
}
