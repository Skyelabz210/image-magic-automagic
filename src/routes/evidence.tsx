import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Metric, PageTitle, Panel } from "@/components/shell";
import { downloadLayer, useWorkspace } from "@/lib/workspace";
import type { Channel, ProbeType } from "@/lib/engine/processing";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/evidence")({
  head: () => ({
    meta: [
      { title: "Evidence Lab — ENHANCE!" },
      { name: "description", content: "Exact integer probes: KELD band maps, lane-comb unit steps, and quantization fingerprints per RGB channel." },
      { property: "og:title", content: "Evidence Lab — ENHANCE!" },
      { property: "og:description", content: "Exact integer probes: KELD band maps, lane-comb unit steps, and quantization fingerprints." },
    ],
  }),
  component: EvidencePage,
});

const PROBES: { id: ProbeType; label: string; desc: string }[] = [
  { id: "keld", label: "KELD bands", desc: "K = ((L mod 36) − (L mod 37)) mod 37 — exact STAR8 band per sample." },
  { id: "lane", label: "Lane comb", desc: "Signed ±1 steps matched on lanes 7, 11, 13 horizontally and vertically." },
  { id: "quantization", label: "Quantization", desc: "GCD fingerprint of 16×16 blocks; orange blocks disagree with background step." },
];

function EvidencePage() {
  const ws = useWorkspace();
  const { source, probe, channel, busy } = ws;
  if (!source)
    return (
      <>
        <PageTitle kicker="02 / EVIDENCE LAB" title="Exact integer probes." />
        <Panel title="No source image">
          <p className="text-sm text-muted-foreground">Import an image on the <Link to="/" className="text-accent underline">Enhance</Link> page first.</p>
        </Panel>
      </>
    );
  return (
    <>
      <PageTitle kicker="02 / EVIDENCE LAB" title="Exact integer probes.">
        Probes read fully opaque samples of one RGB channel with no resampling or grayscale conversion.
      </PageTitle>
      <div className="grid gap-4 lg:grid-cols-[320px_1fr_300px]">
        <Panel title="Probe" kicker="select">
          <div className="mb-4 flex gap-1">
            {(["Red", "Green", "Blue"] as const).map((c, i) => (
              <button key={c} onClick={() => ws.setChannel(i as Channel)} className={cn("flex-1 rounded border px-2 py-1 font-mono text-xs", channel === i && "border-accent bg-secondary text-accent")}>{c}</button>
            ))}
          </div>
          <div className="space-y-2">
            {PROBES.map((p) => (
              <button key={p.id} disabled={!!busy} onClick={() => ws.runProbe(p.id)} className={cn("w-full rounded-md border bg-card p-3 text-left transition-colors hover:border-primary disabled:opacity-50", probe?.type === p.id && "border-primary")}>
                <div className="flex items-center gap-2 font-mono text-sm"><Crosshair className="h-3.5 w-3.5 text-primary" />{p.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{p.desc}</div>
              </button>
            ))}
          </div>
        </Panel>
        <Panel title="Probe map" kicker={probe ? `${probe.type} · ${["R", "G", "B"][probe.channel]}` : "empty"} actions={probe && (
          <Button size="sm" variant="ghost" onClick={() => downloadLayer(probe.url, source.name, `probe-${probe.type}`)} aria-label="Download probe map"><Download className="h-4 w-4" /></Button>
        )}>
          <div className="checker flex min-h-[360px] items-center justify-center rounded-md">
            {probe ? <img src={probe.url} alt={`${probe.type} probe map`} className="max-h-[68vh] max-w-full object-contain" style={{ imageRendering: "pixelated" }} /> : <span className="font-mono text-xs text-muted-foreground">choose a probe</span>}
          </div>
        </Panel>
        <Panel title="Measurements" kicker="readout">
          {probe ? (
            <div className="space-y-2">
              {probe.result.metrics.map((m) => <Metric key={m.label} label={m.label} value={m.value} />)}
              <p className="pt-2 text-xs text-muted-foreground">{probe.result.summary}</p>
            </div>
          ) : <p className="text-xs text-muted-foreground">Run a probe to see its measurements.</p>}
        </Panel>
      </div>
    </>
  );
}
