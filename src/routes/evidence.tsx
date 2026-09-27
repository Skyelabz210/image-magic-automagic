import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Metric, PageTitle, Panel } from "@/components/shell";
import { downloadLayer, previewDataUrl, useWorkspace } from "@/lib/workspace";
import type { Channel, ProbeType } from "@/lib/engine/processing";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { suggestSettings, type AiSuggestion } from "@/lib/ai.functions";
import { toast } from "sonner";
import { workerRegion } from "@/lib/engine/pipeline";
import { readRaster } from "@/lib/engine/image-io";
import { validateFile } from "@/lib/engine/processing";
import { sha256 } from "@/lib/engine/provenance";
import type { Region, RegionMeasurements } from "@/lib/engine/region";
import { inspectJpeg, type JpegStructure } from "@/lib/engine/jpeg";

export const Route = createFileRoute("/evidence")({
  head: () => ({
    meta: [
      { title: "Evidence Lab — ENHANCE!" },
      {
        name: "description",
        content:
          "Exact integer probes: KELD band maps, lane-comb unit steps, pixel-step GCD and regional measurements.",
      },
      { property: "og:title", content: "Evidence Lab — ENHANCE!" },
      {
        property: "og:description",
        content: "Exact integer probes: KELD band maps, lane-comb unit steps and pixel-step GCD.",
      },
    ],
  }),
  component: EvidencePage,
});

const PROBES: { id: ProbeType; label: string; desc: string }[] = [
  {
    id: "keld",
    label: "KELD bands",
    desc: "K = ((L mod 36) − (L mod 37)) mod 37 — exact STAR8 band per sample.",
  },
  {
    id: "lane",
    label: "Lane comb",
    desc: "Signed ±1 steps matched on lanes 7, 11, 13 horizontally and vertically.",
  },
  {
    id: "quantization",
    label: "Pixel step GCD",
    desc: "Decoded RGB steps in 16×16 blocks; a pixel quantization proxy, not a JPEG DCT/DQT measurement.",
  },
];

function EvidencePage() {
  const ws = useWorkspace();
  const { source, probe, channel, busy } = ws;
  if (!source)
    return (
      <>
        <PageTitle kicker="02 / EVIDENCE LAB" title="Exact integer probes." />
        <Panel title="No source image">
          <p className="text-sm text-muted-foreground">
            Import an image on the{" "}
            <Link to="/" className="text-accent underline">
              Enhance
            </Link>{" "}
            page first.
          </p>
        </Panel>
      </>
    );
  return (
    <>
      <PageTitle kicker="02 / EVIDENCE LAB" title="Exact integer probes.">
        Probes read fully opaque samples of one RGB channel with no resampling or grayscale
        conversion.
      </PageTitle>
      <div className="grid gap-4 lg:grid-cols-[320px_1fr_300px]">
        <Panel title="Probe" kicker="select">
          <div className="mb-4 flex gap-1">
            {(["Red", "Green", "Blue"] as const).map((c, i) => (
              <button
                key={c}
                onClick={() => ws.setChannel(i as Channel)}
                className={cn(
                  "flex-1 rounded border px-2 py-1 font-mono text-xs",
                  channel === i && "border-accent bg-secondary text-accent",
                )}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {PROBES.map((p) => (
              <button
                key={p.id}
                disabled={!!busy}
                onClick={() => ws.runProbe(p.id)}
                className={cn(
                  "w-full rounded-md border bg-card p-3 text-left transition-colors hover:border-primary disabled:opacity-50",
                  probe?.type === p.id && "border-primary",
                )}
              >
                <div className="flex items-center gap-2 font-mono text-sm">
                  <Crosshair className="h-3.5 w-3.5 text-primary" />
                  {p.label}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{p.desc}</div>
              </button>
            ))}
          </div>
        </Panel>
        <Panel
          title="Probe map"
          kicker={probe ? `${probe.type} · ${["R", "G", "B"][probe.channel]}` : "empty"}
          actions={
            probe && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => downloadLayer(probe.url, source.name, `probe-${probe.type}`)}
                aria-label="Download probe map"
              >
                <Download className="h-4 w-4" />
              </Button>
            )
          }
        >
          <div className="checker flex min-h-[360px] items-center justify-center rounded-md">
            {probe ? (
              <img
                src={probe.url}
                alt={`${probe.type} probe map`}
                className="max-h-[68vh] max-w-full object-contain"
                style={{ imageRendering: "pixelated" }}
              />
            ) : (
              <span className="font-mono text-xs text-muted-foreground">choose a probe</span>
            )}
          </div>
        </Panel>
        <Panel title="Measurements" kicker="readout">
          {probe ? (
            <div className="space-y-2">
              {probe.result.metrics.map((m) => (
                <Metric key={m.label} label={m.label} value={m.value} />
              ))}
              <p className="pt-2 text-xs text-muted-foreground">{probe.result.summary}</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Run a probe to see its measurements.</p>
          )}
        </Panel>
      </div>
      <RegionInspector key={source.fileHash} source={source} record={ws.record} />
      <JpegPanel key={`jpeg-${source.fileHash}`} source={source} />
    </>
  );
}

function JpegPanel({ source }: { source: NonNullable<ReturnType<typeof useWorkspace>["source"]> }) {
  const [report, setReport] = useState<JpegStructure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const inspect = async () => {
    setReading(true);
    setError(null);
    try {
      const response = await fetch(source.url);
      if (!response.ok) throw new Error("Original file is no longer available.");
      setReport(inspectJpeg(new Uint8Array(await response.arrayBuffer())));
    } catch (e) {
      setError(e instanceof Error ? e.message : "JPEG inspection failed.");
    } finally {
      setReading(false);
    }
  };
  return (
    <div className="mt-4">
      <Panel title="Original-byte JPEG structure" kicker="DQT / frame / scans">
        <p className="mb-3 text-xs text-muted-foreground">
          Inspect the imported JPEG stream, separate from decoded pixel-step GCD. Quantization
          tables describe encoding settings; they alone cannot establish editing history or double
          compression.
        </p>
        <Button
          size="sm"
          variant="secondary"
          disabled={
            reading || (!/\.jpe?g$/i.test(source.name) && !/^image\/jpeg$/.test(source.type))
          }
          onClick={inspect}
        >
          {reading ? "Reading…" : "Inspect JPEG bytes"}
        </Button>
        {error && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        )}
        {report && (
          <div className="mt-3 space-y-2 text-xs">
            <p>
              {report.width}×{report.height} · {report.frame ?? "frame missing"} · {report.scans}{" "}
              scan(s) · {report.complete ? "EOI present" : "incomplete"}
            </p>
            <p>
              Components:{" "}
              {report.components
                .map((c) => `${c.id} ${c.horizontal}×${c.vertical} DQT ${c.tableId}`)
                .join("; ") || "unavailable"}
            </p>
            <p>Restart interval: {report.restartInterval ?? "unspecified"}</p>
            <p>
              Tables: {report.quantizationTables.length} · Markers:{" "}
              {report.markers.map((m) => m.name).join(", ")}
            </p>
            {report.quantizationTables.map((table, i) => (
              <details key={`${table.offset}-${i}`} className="rounded border p-2">
                <summary className="cursor-pointer">
                  DQT {table.id} · {table.precision} bit · byte {table.offset}
                </summary>
                <div
                  className="mt-2 grid max-w-md grid-cols-8 gap-1 font-mono"
                  aria-label="64 DQT values in encoded zigzag order"
                >
                  {table.zigzag.map((value, j) => (
                    <span key={j} className="rounded bg-secondary p-1 text-center">
                      {value}
                    </span>
                  ))}
                </div>
              </details>
            ))}
            {report.warnings.map((w, i) => (
              <p key={i} className="text-signal">
                {w}
              </p>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function RegionInspector({
  source,
  record,
}: {
  source: NonNullable<ReturnType<typeof useWorkspace>["source"]>;
  record: ReturnType<typeof useWorkspace>["record"];
}) {
  const [region, setRegion] = useState<Region | null>(null);
  const [saved, setSaved] = useState<
    { id: string; name: string; metrics: RegionMeasurements; masked?: boolean }[]
  >([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const metrics = saved.find((item) => item.id === selectedId)?.metrics ?? null;
  const [running, setRunning] = useState(false);
  const [provider, setProvider] = useState<"lovable" | "gemini">("lovable");
  const [question, setQuestion] = useState(
    "How do these regions differ, and what should I inspect next?",
  );
  const [answer, setAnswer] = useState<AiSuggestion | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const suggest = useServerFn(suggestSettings);
  const start = useRef<{ x: number; y: number } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const point = (event: PointerEvent<HTMLImageElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(
        source.raster.width - 1,
        Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * source.raster.width)),
      ),
      y: Math.min(
        source.raster.height - 1,
        Math.max(0, Math.floor(((event.clientY - rect.top) / rect.height) * source.raster.height)),
      ),
    };
  };
  const drag = (event: PointerEvent<HTMLImageElement>) => {
    if (!start.current) return;
    const end = point(event);
    const x = Math.min(start.current.x, end.x),
      y = Math.min(start.current.y, end.y);
    setRegion({
      x,
      y,
      width: Math.abs(start.current.x - end.x) + 1,
      height: Math.abs(start.current.y - end.y) + 1,
    });
  };
  const finish = async (event: PointerEvent<HTMLImageElement>) => {
    if (!start.current) return;
    drag(event);
    const end = point(event);
    const x = Math.min(start.current.x, end.x),
      y = Math.min(start.current.y, end.y);
    const selected = {
      x,
      y,
      width: Math.abs(start.current.x - end.x) + 1,
      height: Math.abs(start.current.y - end.y) + 1,
    };
    start.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setRegion(selected);
    setRunning(true);
    try {
      const result = await workerRegion(source.raster, selected, current.signal);
      current.signal.throwIfAborted();
      const id = crypto.randomUUID();
      setSaved((items) => [...items, { id, name: `Region ${items.length + 1}`, metrics: result }]);
      setSelectedId(id);
      await record("region:inspect", { ...selected, sourceSha256: source.rasterHash });
    } catch (error) {
      if (!current.signal.aborted)
        toast.error(error instanceof Error ? error.message : "Region inspection failed.");
    } finally {
      if (controller.current === current) setRunning(false);
    }
  };
  const askAboutRegions = async () => {
    setAiBusy(true);
    setAnswer(null);
    try {
      const metrics: Record<string, string | number> = {
        width: source.raster.width,
        height: source.raster.height,
        fileSha256: source.fileHash,
      };
      saved.slice(0, 12).forEach((item, i) => {
        const { region: r, channels: c, opaquePixels, excludedPixels } = item.metrics;
        metrics[`region${i + 1}`] =
          `${item.name.slice(0, 32)} at (${r.x},${r.y}) ${r.width}x${r.height}; opaque=${opaquePixels}; excluded=${excludedPixels}; red mean=${c[0].mean?.toFixed(2) ?? "N/A"}, entropy=${c[0].entropy?.toFixed(3) ?? "N/A"}; green mean=${c[1].mean?.toFixed(2) ?? "N/A"}, entropy=${c[1].entropy?.toFixed(3) ?? "N/A"}; blue mean=${c[2].mean?.toFixed(2) ?? "N/A"}, entropy=${c[2].entropy?.toFixed(3) ?? "N/A"}`;
      });
      const response = await suggest({
        data: { image: previewDataUrl(source.raster), metrics, provider, question },
      });
      setAnswer(response);
      await record("ai-region-question", {
        provider,
        regions: Math.min(saved.length, 12),
        sourceSha256: source.rasterHash,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI question failed.");
    } finally {
      setAiBusy(false);
    }
  };
  const inspectMask = async (file: File) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setRunning(true);
    let url: string | null = null;
    try {
      validateFile(file);
      url = URL.createObjectURL(file);
      const mask = await readRaster(url, current.signal);
      const metrics = await workerRegion(
        source.raster,
        {
          x: 0,
          y: 0,
          width: source.raster.width,
          height: source.raster.height,
        },
        current.signal,
        mask,
      );
      current.signal.throwIfAborted();
      const id = crypto.randomUUID();
      setSaved((items) => [...items, { id, name: file.name.slice(0, 32), metrics, masked: true }]);
      setSelectedId(id);
      setRegion(null);
      await record("region:mask", {
        sourceSha256: source.rasterHash,
        maskSha256: await sha256(await file.arrayBuffer()),
        threshold: 128,
        opaquePixels: metrics.opaquePixels,
      });
    } catch (e) {
      if (!current.signal.aborted)
        toast.error(e instanceof Error ? e.message : "Mask inspection failed.");
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (controller.current === current) setRunning(false);
    }
  };
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_300px]">
      <Panel title="Region inspector" kicker="native pixels">
        <p className="mb-3 text-xs text-muted-foreground">
          Drag across the original to measure a region. Coordinates and counts use original pixels;
          no resampling.
        </p>
        <div className="checker flex min-h-56 items-center justify-center rounded-md p-2">
          <div className="relative inline-block max-w-full select-none">
            <img
              src={source.url}
              alt="Drag to select a region of the original image"
              className="block max-h-[65vh] max-w-full touch-none object-contain"
              onPointerDown={(event) => {
                controller.current?.abort();
                start.current = point(event);
                event.currentTarget.setPointerCapture(event.pointerId);
                drag(event);
              }}
              onPointerMove={drag}
              onPointerUp={finish}
              onPointerCancel={() => {
                start.current = null;
                setRegion(null);
              }}
            />
            {saved
              .filter((item) => !item.masked)
              .map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "pointer-events-none absolute border-2 bg-accent/10",
                    item.id === selectedId ? "border-primary bg-primary/20" : "border-accent",
                  )}
                  style={{
                    left: `${(item.metrics.region.x * 100) / source.raster.width}%`,
                    top: `${(item.metrics.region.y * 100) / source.raster.height}%`,
                    width: `${(item.metrics.region.width * 100) / source.raster.width}%`,
                    height: `${(item.metrics.region.height * 100) / source.raster.height}%`,
                  }}
                />
              ))}
            {region && (
              <div
                className="pointer-events-none absolute border-2 border-primary bg-primary/20"
                style={{
                  left: `${(region.x * 100) / source.raster.width}%`,
                  top: `${(region.y * 100) / source.raster.height}%`,
                  width: `${(region.width * 100) / source.raster.width}%`,
                  height: `${(region.height * 100) / source.raster.height}%`,
                }}
              />
            )}
          </div>
        </div>
        <div className="mt-3 text-xs">
          <label className="block font-semibold" htmlFor="segment-mask">
            Inspect an external segmentation mask
          </label>
          <input
            id="segment-mask"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/bmp"
            disabled={running}
            className="mt-1 block max-w-full"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void inspectMask(file);
              event.currentTarget.value = "";
            }}
          />
          <p className="mt-1 text-muted-foreground">
            Use an exact-size mask from SAM or another segmenter: white selects pixels, black or
            transparency excludes; threshold 128. Measurements run locally.
          </p>
        </div>
        {saved.length > 0 && (
          <div className="mt-3 space-y-2">
            <label className="block text-xs" htmlFor="region-question">
              Ask AI about the measured regions (optional)
            </label>
            <input
              id="region-question"
              value={question}
              maxLength={300}
              onChange={(e) => setQuestion(e.target.value)}
              className="w-full rounded border bg-background p-2 text-sm"
            />
            <select
              aria-label="AI provider for region question"
              value={provider}
              onChange={(e) => setProvider(e.target.value as "lovable" | "gemini")}
              className="rounded border bg-background p-2 text-xs"
            >
              <option value="lovable">Lovable AI</option>
              <option value="gemini">Google Gemini</option>
            </select>
            <Button
              size="sm"
              className="ml-2"
              disabled={aiBusy || !question.trim()}
              onClick={askAboutRegions}
            >
              {aiBusy ? "Analyzing…" : "Ask about regions"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Sends a reduced preview, region coordinates and measurements to the selected provider.
              Answers are suggestions, not verified findings.
            </p>
            {answer && (
              <div className="rounded border p-2 text-sm">
                <p>{answer.summary}</p>
                <ul className="mt-2 list-disc pl-5 text-xs">
                  {answer.observations.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Panel>
      <Panel
        title="Selected pixels"
        kicker={
          running
            ? "measuring"
            : metrics
              ? `${metrics.region.width}×${metrics.region.height}`
              : "select"
        }
      >
        {saved.length > 0 && (
          <div className="mb-3 space-y-1">
            {saved.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "flex items-center gap-1 rounded border p-1",
                  selectedId === item.id && "border-primary",
                )}
              >
                <button
                  className="min-w-0 flex-1 truncate text-left text-xs"
                  onClick={() => {
                    setSelectedId(item.id);
                    setRegion(null);
                  }}
                  title="Show measurements"
                >
                  {item.masked ? "Mask: " : ""}
                  {item.name}
                </button>
                <input
                  aria-label={`Rename ${item.name}`}
                  className="w-20 rounded border bg-background p-1 text-xs"
                  value={item.name}
                  maxLength={32}
                  onChange={(e) =>
                    setSaved((items) =>
                      items.map((x) => (x.id === item.id ? { ...x, name: e.target.value } : x)),
                    )
                  }
                />
                <button
                  aria-label={`Remove ${item.name}`}
                  className="px-1 text-xs text-destructive"
                  onClick={() => {
                    setSaved((items) => items.filter((x) => x.id !== item.id));
                    if (selectedId === item.id) setSelectedId(null);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {metrics ? (
          <div className="space-y-2">
            <Metric label="coordinates (x, y)" value={`${metrics.region.x}, ${metrics.region.y}`} />
            <Metric
              label="opaque / excluded"
              value={`${metrics.opaquePixels.toLocaleString()} / ${metrics.excludedPixels.toLocaleString()}`}
            />
            {metrics.channels.map((c, i) => (
              <div key={i} className="rounded border p-2 text-xs">
                <div className="mb-1 font-semibold">{["Red", "Green", "Blue"][i]}</div>
                <div>
                  Range: {c.min ?? "—"}–{c.max ?? "—"} · Mean: {c.mean?.toFixed(2) ?? "—"}
                </div>
                <div>Shannon entropy: {c.entropy?.toFixed(3) ?? "—"} bits</div>
                <div>
                  KELD bands: {c.occupiedKeldBands} · Step GCD: {c.adjacentStepGcd} · ±1 steps:{" "}
                  {c.unitSteps}
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Regional measurements describe pixel patterns; they are not a manipulation verdict.
            </p>
            {saved.length > 1 && (
              <div className="rounded border p-2 text-xs">
                <p className="mb-1 font-semibold">Compare red channel mean and entropy</p>
                {saved.map((item) => (
                  <p key={item.id}>
                    {item.name}: mean {item.metrics.channels[0].mean?.toFixed(2) ?? "—"}; entropy{" "}
                    {item.metrics.channels[0].entropy?.toFixed(3) ?? "—"} bits;{" "}
                    {item.metrics.opaquePixels} opaque px
                  </p>
                ))}
                <p className="mt-1 text-muted-foreground">
                  Regions may differ in size and content. Compare like areas and use this readout as
                  descriptive evidence.
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {running
              ? "Measuring the selected pixels…"
              : "Drag on the original image to inspect a region."}
          </p>
        )}
      </Panel>
    </div>
  );
}
