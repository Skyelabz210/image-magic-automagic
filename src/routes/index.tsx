import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, Play, RotateCcw, Sparkles, Wand2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Dropzone } from "@/components/dropzone";
import { Metric, PageTitle, Panel } from "@/components/shell";
import { downloadLayer, previewDataUrl, useWorkspace, type Layer } from "@/lib/workspace";
import { suggestSettings, type AiSuggestion } from "@/lib/ai.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Enhance — ENHANCE! Digital Image Processing" },
      { name: "description", content: "Entropy-guided image enhancement with auto-tuning, one-click full runs, and AI setting suggestions." },
      { property: "og:title", content: "Enhance — ENHANCE! Digital Image Processing" },
      { property: "og:description", content: "Entropy-guided image enhancement with auto-tuning, one-click full runs, and AI setting suggestions." },
    ],
  }),
  component: EnhancePage,
});

const LAYERS: Layer[] = ["original", "enhanced", "entropy", "mask"];

function EnhancePage() {
  const ws = useWorkspace();
  const { source, enhancement, layerUrls, threshold, strength, busy, tune } = ws;
  const [layer, setLayer] = useState<Layer>("original");
  const suggest = useServerFn(suggestSettings);
  const [ai, setAi] = useState<AiSuggestion | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const stale = enhancement && ws.enhancedFor !== `${threshold}|${strength}`;

  const askAi = async () => {
    if (!source) return;
    setAiBusy(true);
    try {
      const metrics: Record<string, string | number> = { width: source.raster.width, height: source.raster.height, currentThreshold: threshold, currentStrength: strength };
      if (enhancement) Object.assign(metrics, { meanEntropy: +enhancement.meanEntropy.toFixed(3), activePercent: +enhancement.activePercent.toFixed(1), clippedPixels: enhancement.clippedPixels });
      if (tune) Object.assign(metrics, { autoThreshold: tune.threshold, autoStrength: tune.strength });
      const r = await suggest({ data: { image: previewDataUrl(source.raster), metrics } });
      setAi(r);
      await ws.record("ai-suggest", { threshold: r.threshold ?? "none", strength: r.strength ?? "none" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI suggestion failed.");
    } finally {
      setAiBusy(false);
    }
  };

  if (!source)
    return (
      <>
        <PageTitle kicker="01 / ENHANCE" title="Bring hidden detail forward.">
          Import an image to run entropy-guided enhancement, let the app tune itself, or run the whole pipeline in one click. Everything runs in your browser.
        </PageTitle>
        <Dropzone onFiles={(f) => f[0] && ws.loadFile(f[0])} />
      </>
    );

  const url = layerUrls[layer] ?? layerUrls.original;

  return (
    <>
      <PageTitle kicker="01 / ENHANCE" title={source.name} />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Panel
          title="Viewer"
          kicker="layer"
          actions={
            <>
              {LAYERS.map((l) => (
                <button
                  key={l}
                  disabled={!layerUrls[l]}
                  onClick={() => setLayer(l)}
                  className={cn("rounded px-2 py-1 font-mono text-[11px] capitalize text-muted-foreground disabled:opacity-30", layer === l && "bg-primary text-primary-foreground")}
                >
                  {l}
                </button>
              ))}
              <Button size="sm" variant="ghost" disabled={!url} onClick={() => url && downloadLayer(url, source.name, layer)} aria-label="Download layer">
                <Download className="h-4 w-4" />
              </Button>
            </>
          }
        >
          <div className="checker flex max-h-[70vh] min-h-[360px] items-center justify-center overflow-auto rounded-md">
            {url && <img src={url} alt={`${layer} layer`} className="max-h-[68vh] max-w-full object-contain" style={{ imageRendering: "auto" }} />}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
            <Metric label="dimensions" value={`${source.raster.width}×${source.raster.height}`} />
            <Metric label="mean entropy" value={enhancement ? `${enhancement.meanEntropy.toFixed(2)} b` : "—"} tone="accent" />
            <Metric label="active" value={enhancement ? `${enhancement.activePercent.toFixed(1)}%` : "—"} />
            <Metric label="clipped px" value={enhancement ? enhancement.clippedPixels.toLocaleString() : "—"} tone="signal" />
            <Metric label="file sha-256" value={<span className="text-xs">{source.fileHash.slice(0, 12)}…</span>} />
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Automated mode" kicker="auto">
            <div className="space-y-2">
              <Button className="w-full justify-start" disabled={!!busy} onClick={() => ws.runAll().then(() => setLayer("enhanced"))}>
                <Zap className="h-4 w-4" /> One-click full run
              </Button>
              <p className="text-xs text-muted-foreground">Auto-tune → enhance → KELD, lane & quantization probes → recorded in receipt.</p>
              <Button variant="secondary" className="w-full justify-start" disabled={!!busy} onClick={ws.runAutoTune}>
                <Wand2 className="h-4 w-4" /> Auto-tune settings only
              </Button>
              {tune && <p className="rounded-md border bg-card p-2 text-xs text-muted-foreground">{tune.rationale}</p>}
            </div>
          </Panel>

          <Panel title="Recipe" kicker="manual" actions={stale ? <span className="font-mono text-[10px] text-signal">changed · rerun</span> : null}>
            <label className="flex justify-between font-mono text-xs"><span>entropy threshold</span><span className="text-accent">{threshold.toFixed(1)} bits</span></label>
            <Slider className="mt-2" min={0} max={6.3} step={0.1} value={[threshold]} onValueChange={([v]) => ws.setThreshold(v ?? 0)} />
            <label className="mt-5 flex justify-between font-mono text-xs"><span>sharpen strength</span><span className="text-accent">{strength.toFixed(2)}×</span></label>
            <Slider className="mt-2" min={1} max={3} step={0.05} value={[strength]} onValueChange={([v]) => ws.setStrength(v ?? 1)} />
            <div className="mt-5 flex gap-2">
              <Button className="flex-1" variant="outline" disabled={!!busy} onClick={() => ws.runEnhance().then(() => setLayer("enhanced"))}>
                <Play className="h-4 w-4" /> Run enhancement
              </Button>
              <Button variant="ghost" onClick={ws.reset} aria-label="Remove image"><RotateCcw className="h-4 w-4" /></Button>
            </div>
          </Panel>

          <Panel title="AI suggestions" kicker="assist">
            <Button variant="secondary" className="w-full justify-start" disabled={aiBusy} onClick={askAi}>
              <Sparkles className={cn("h-4 w-4 text-primary", aiBusy && "animate-pulse")} /> {aiBusy ? "Analyzing image…" : "Analyze & suggest settings"}
            </Button>
            {ai && (
              <div className="mt-3 space-y-2 text-sm">
                <p>{ai.summary}</p>
                {ai.observations.length > 0 && (
                  <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                    {ai.observations.map((o, i) => <li key={i}>{o}</li>)}
                  </ul>
                )}
                {ai.threshold !== null && ai.strength !== null && (
                  <Button size="sm" variant="outline" onClick={() => { ws.setThreshold(ai.threshold!); ws.setStrength(ai.strength!); ws.runEnhance({ threshold: ai.threshold!, strength: ai.strength! }).then(() => setLayer("enhanced")); }}>
                    Apply {ai.threshold} bits · {ai.strength}×
                  </Button>
                )}
              </div>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">Sends a small preview of this image to AI. Suggestions are advisory.</p>
          </Panel>
        </div>
      </div>
    </>
  );
}
