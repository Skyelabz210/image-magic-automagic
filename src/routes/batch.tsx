import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Download, FileJson, Play, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dropzone } from "@/components/dropzone";
import { PageTitle, Panel } from "@/components/shell";
import { useWorkspace } from "@/lib/workspace";
import { validateFile, type Channel } from "@/lib/engine/processing";
import { downloadBlob, isAbort, outputName, readRaster } from "@/lib/engine/image-io";
import { runFullPipeline } from "@/lib/engine/pipeline";
import { sha256 } from "@/lib/engine/provenance";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/batch")({
  head: () => ({
    meta: [
      { title: "Batch — ENHANCE!" },
      { name: "description", content: "Drop many images and run auto-tune, enhancement, and all forensic probes on each, with a combined receipt." },
      { property: "og:title", content: "Batch — ENHANCE!" },
      { property: "og:description", content: "Run the full auto-tuned pipeline across many images at once." },
    ],
  }),
  component: BatchPage,
});

type Item = {
  id: string; file: File; status: "queued" | "running" | "done" | "error"; step?: string; error?: string;
  thumb?: string; out?: string; blob?: Blob;
  summary?: { threshold: number; strength: number; meanEntropy: number; active: number; clipped: number; bands: number; laneSteps: number; flagged: number; fileHash: string; outHash: string };
};

function BatchPage() {
  const ws = useWorkspace();
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [channel, setChannel] = useState<Channel>(1);
  const abort = useRef<AbortController | null>(null);

  const patch = (id: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const add = (files: File[]) =>
    setItems((xs) => [...xs, ...files.map((file) => ({ id: crypto.randomUUID(), file, status: "queued" as const, thumb: URL.createObjectURL(file) }))]);

  const run = async () => {
    const c = new AbortController();
    abort.current = c;
    setRunning(true);
    for (const it of items.filter((x) => x.status === "queued" || x.status === "error")) {
      if (c.signal.aborted) break;
      patch(it.id, { status: "running", step: "Decoding", error: undefined });
      try {
        validateFile(it.file);
        const raster = await readRaster(it.thumb!, c.signal);
        const fileHash = await sha256(await it.file.arrayBuffer());
        const r = await runFullPipeline(raster, channel, c.signal, (step) => patch(it.id, { step }));
        const summary = {
          threshold: r.tune.threshold, strength: r.tune.strength,
          meanEntropy: r.enhancement.meanEntropy, active: r.enhancement.activePercent, clipped: r.enhancement.clippedPixels,
          bands: r.probes.keld.count, laneSteps: r.probes.lane.count, flagged: r.probes.quantization.count,
          fileHash, outHash: r.hashes.enhancedPng,
        };
        await ws.record("batch:pipeline", {
          file: it.file.name, fileSha256: fileHash, rasterSha256: r.hashes.raster, channel: ["red", "green", "blue"][channel],
          threshold: summary.threshold, strength: summary.strength, keldBands: summary.bands, laneSteps: summary.laneSteps, flaggedBlocks: summary.flagged, outputSha256: summary.outHash,
        });
        patch(it.id, { status: "done", step: undefined, blob: r.enhancedBlob, out: URL.createObjectURL(r.enhancedBlob), summary });
      } catch (e) {
        if (isAbort(e)) { patch(it.id, { status: "queued", step: undefined }); break; }
        patch(it.id, { status: "error", step: undefined, error: e instanceof Error ? e.message : "Failed" });
      }
    }
    setRunning(false);
  };

  const done = items.filter((x) => x.status === "done");

  const exportReport = () => {
    const rows = done.map((x) => ({ file: x.file.name, ...x.summary }));
    downloadBlob(new Blob([JSON.stringify({ format: "enhance-batch-v1", exportedAt: new Date().toISOString(), channel: ["red", "green", "blue"][channel], items: rows, ledgerHead: ws.ledger.at(-1)?.chain ?? null }, null, 2)], { type: "application/json" }), "enhance-batch-report.json");
  };

  return (
    <>
      <PageTitle kicker="03 / BATCH" title="Many images, one pass.">
        Each image is auto-tuned, enhanced, and probed with KELD, lane comb, and quantization. Every result is added to the provenance ledger.
      </PageTitle>
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Panel title="Queue" kicker={`${items.length} files`}>
          <Dropzone multiple compact onFiles={add} />
          <div className="mt-4 font-mono text-xs text-muted-foreground">probe channel</div>
          <div className="mt-1 flex gap-1">
            {(["Red", "Green", "Blue"] as const).map((c, i) => (
              <button key={c} disabled={running} onClick={() => setChannel(i as Channel)} className={cn("flex-1 rounded border px-2 py-1 font-mono text-xs", channel === i && "border-accent bg-secondary text-accent")}>{c}</button>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {running ? (
              <Button variant="destructive" onClick={() => abort.current?.abort()}><Square className="h-4 w-4" /> Stop</Button>
            ) : (
              <Button onClick={run} disabled={!items.some((x) => x.status === "queued" || x.status === "error")}><Play className="h-4 w-4" /> Run batch</Button>
            )}
            <Button variant="secondary" onClick={exportReport} disabled={!done.length}><FileJson className="h-4 w-4" /> Export batch report</Button>
            <Button variant="ghost" disabled={running || !items.length} onClick={() => setItems([])}><Trash2 className="h-4 w-4" /> Clear queue</Button>
          </div>
        </Panel>
        <Panel title="Results" kicker={`${done.length}/${items.length} done`}>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add images to start.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map((x) => (
                <div key={x.id} className={cn("overflow-hidden rounded-md border bg-card", x.status === "running" && "border-accent", x.status === "error" && "border-destructive")}>
                  <div className="checker aspect-video">
                    <img src={x.out ?? x.thumb} alt={x.file.name} className="h-full w-full object-contain" />
                  </div>
                  <div className="space-y-1 p-3">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-xs">{x.file.name}</span>
                      <span className={cn("ml-auto rounded px-1.5 py-0.5 font-mono text-[10px] uppercase", x.status === "done" ? "bg-accent text-accent-foreground" : x.status === "error" ? "bg-destructive text-destructive-foreground" : "bg-secondary text-muted-foreground")}>{x.step ?? x.status}</span>
                    </div>
                    {x.error && <p className="text-xs text-destructive">{x.error}</p>}
                    {x.summary && (
                      <>
                        <div className="grid grid-cols-3 gap-1 font-mono text-[11px] text-muted-foreground">
                          <span>thr <b className="text-foreground">{x.summary.threshold}</b></span>
                          <span>str <b className="text-foreground">{x.summary.strength}</b></span>
                          <span>ent <b className="text-foreground">{x.summary.meanEntropy.toFixed(2)}</b></span>
                          <span>bands <b className="text-foreground">{x.summary.bands}</b></span>
                          <span>±1 <b className="text-foreground">{x.summary.laneSteps}</b></span>
                          <span>flag <b className={x.summary.flagged ? "text-signal" : "text-foreground"}>{x.summary.flagged}</b></span>
                        </div>
                        <Button size="sm" variant="outline" className="mt-1 w-full" onClick={() => x.blob && downloadBlob(x.blob, outputName(x.file.name, "enhanced"))}>
                          <Download className="h-3.5 w-3.5" /> Enhanced PNG
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
