import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Metric, PageTitle, Panel } from "@/components/shell";
import { downloadLayer, useWorkspace } from "@/lib/workspace";
import type { Channel, ProbeType } from "@/lib/engine/processing";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { toast } from "sonner";
import { workerRegion } from "@/lib/engine/pipeline";
import type { Region, RegionMeasurements } from "@/lib/engine/region";

export const Route = createFileRoute("/evidence")({
  head: () => ({
    meta: [
      { title: "Evidence Lab — ENHANCE!" },
      {
        name: "description",
        content:
          "Exact integer probes: KELD band maps, lane-comb unit steps, and quantization fingerprints per RGB channel.",
      },
      { property: "og:title", content: "Evidence Lab — ENHANCE!" },
      {
        property: "og:description",
        content:
          "Exact integer probes: KELD band maps, lane-comb unit steps, and quantization fingerprints.",
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
    label: "Quantization",
    desc: "GCD fingerprint of 16×16 blocks; orange blocks disagree with background step.",
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
    </>
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
  const [metrics, setMetrics] = useState<RegionMeasurements | null>(null);
  const [running, setRunning] = useState(false);
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
    setMetrics(null);
    setRunning(true);
    try {
      const result = await workerRegion(source.raster, selected, current.signal);
      current.signal.throwIfAborted();
      setMetrics(result);
      await record("region:inspect", { ...selected, sourceSha256: source.rasterHash });
    } catch (error) {
      if (!current.signal.aborted)
        toast.error(error instanceof Error ? error.message : "Region inspection failed.");
    } finally {
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
                setMetrics(null);
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
