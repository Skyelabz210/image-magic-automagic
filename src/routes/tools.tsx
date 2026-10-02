import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dropzone } from "@/components/dropzone";
import { PageTitle, Panel } from "@/components/shell";
import { downloadBlob, rasterToBlob } from "@/lib/engine/image-io";
import { workerTool } from "@/lib/engine/pipeline";
import { workerRecipe, workerDifference } from "@/lib/engine/pipeline";
import { sha256 } from "@/lib/engine/provenance";
import { RECIPES, TOOL_NAMES, type ToolName, type ToolOptions } from "@/lib/engine/tools";
import { useWorkspace } from "@/lib/workspace";
import { InspectionViewer } from "@/components/inspection-viewer";
import type { Raster } from "@/lib/engine/processing";

export const Route = createFileRoute("/tools")({
  component: ToolsPage,
  head: () => ({ meta: [{ title: "Image Tools — ENHANCE!" }] }),
});

function previewRaster(source: Raster): Raster {
  const scale = Math.min(1, 1024 / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const original =
        (Math.min(source.height - 1, Math.floor((y + 0.5) / scale)) * source.width +
          Math.min(source.width - 1, Math.floor((x + 0.5) / scale))) *
        4;
      data.set(source.data.subarray(original, original + 4), (y * width + x) * 4);
    }
  return { width, height, data };
}

function ToolsPage() {
  const ws = useWorkspace();
  const [name, setName] = useState<ToolName>("grayscale");
  const [amount, setAmount] = useState(128);
  const [channel, setChannel] = useState<0 | 1 | 2>(0);
  const [steps, setSteps] = useState<ToolOptions[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<{
    url: string;
    diff: string;
    blob: Blob;
    hash: string;
  } | null>(null);
  const [running, setRunning] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      if (result) {
        URL.revokeObjectURL(result.url);
        URL.revokeObjectURL(result.diff);
      }
    },
    [result],
  );
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );
  useEffect(() => {
    setResult(null);
    setPreviewUrl(null);
    setRunning(false);
    return () => controllerRef.current?.abort();
  }, [ws.source]);
  const invalidate = () => {
    controllerRef.current?.abort();
    setRunning(false);
    setResult(null);
    setPreviewUrl(null);
  };
  useEffect(() => {
    if (!ws.source || !steps.length || result || running) return;
    const source = ws.source;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const raster = await workerRecipe(previewRaster(source.raster), steps, controller.signal);
        const blob = await rasterToBlob(raster);
        controller.signal.throwIfAborted();
        setPreviewUrl(URL.createObjectURL(blob));
      } catch (error) {
        if (!controller.signal.aborted)
          toast.error(error instanceof Error ? error.message : "Live preview failed.");
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [ws.source, steps, result, running, name, amount, channel]);
  const option = (): ToolOptions => ({
    name,
    amount:
      name === "brightness"
        ? amount - 128
        : ["contrast", "manuscript", "undertext", "parchment"].includes(name)
          ? Math.min(100, amount)
          : amount,
    channel,
  });
  const run = async () => {
    if (!ws.source) return;
    const current = ws.source;
    const options = option();
    const applied = steps.length ? steps : [options];
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setRunning(true);
    try {
      const raster = steps.length
        ? await workerRecipe(current.raster, applied, controller.signal)
        : await workerTool(current.raster, options, controller.signal);
      const diffRaster = await workerDifference(current.raster, raster, controller.signal);
      const blob = await rasterToBlob(raster);
      const diffBlob = await rasterToBlob(diffRaster);
      const hash = await sha256(await blob.arrayBuffer());
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(blob);
      setResult({ url, diff: URL.createObjectURL(diffBlob), blob, hash });
      setPreviewUrl(null);
      await ws.record(steps.length ? "tool:recipe" : `tool:${name}`, {
        sourceSha256: current.rasterHash,
        outputSha256: hash,
        steps: JSON.stringify(applied),
      });
    } catch (error) {
      if (!controller.signal.aborted)
        toast.error(error instanceof Error ? error.message : "Tool failed.");
    } finally {
      if (controllerRef.current === controller) setRunning(false);
    }
  };
  return (
    <>
      <PageTitle kicker="03 / TOOLS" title="Pixel tools">
        Build a sequence of tools or apply one to the original image. Outputs are PNGs with a
        SHA-256 receipt.
      </PageTitle>
      {!ws.source ? (
        <Dropzone onFiles={(files) => files[0] && ws.loadFile(files[0])} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <Panel title="Transform" kicker="RGBA8">
            <label className="block text-sm" htmlFor="tool">
              Tool
            </label>
            <select
              id="tool"
              value={name}
              onChange={(event) => {
                setName(event.target.value as ToolName);
                setAmount(
                  (
                    {
                      manuscript: 100,
                      undertext: 65,
                      "ink-fade": 12,
                      parchment: 70,
                      contrast: 20,
                      threshold: 128,
                      brightness: 128,
                    } as Record<string, number>
                  )[event.target.value] ?? 0,
                );
                invalidate();
              }}
              className="mt-1 w-full rounded border bg-background p-2 text-sm"
            >
              {TOOL_NAMES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            {(name === "brightness" ||
              name === "contrast" ||
              name === "threshold" ||
              name === "manuscript" ||
              name === "undertext" ||
              name === "ink-fade" ||
              name === "parchment") && (
              <label className="mt-4 block text-sm" htmlFor="amount">
                {name === "brightness"
                  ? "Brightness (−128 to +127)"
                  : name === "contrast"
                    ? "Contrast (0–100%)"
                    : name === "manuscript"
                      ? "Reading contrast (0–100%)"
                      : name === "undertext"
                        ? "High-pass strength (0–100)"
                        : name === "ink-fade"
                          ? "Local ink offset (0–255)"
                          : name === "parchment"
                            ? "Background flattening (0–100%)"
                            : "Threshold (0–255)"}
                <input
                  id="amount"
                  type="range"
                  min="0"
                  max={
                    ["contrast", "manuscript", "undertext", "parchment"].includes(name) ? 100 : 255
                  }
                  value={Math.min(
                    amount,
                    ["contrast", "manuscript", "undertext", "parchment"].includes(name) ? 100 : 255,
                  )}
                  onChange={(event) => {
                    setAmount(Number(event.target.value));
                    invalidate();
                  }}
                  className="mt-2 w-full"
                />
                <span className="font-mono text-xs">
                  {name === "brightness"
                    ? amount - 128
                    : Math.min(
                        amount,
                        ["contrast", "manuscript", "undertext", "parchment"].includes(name)
                          ? 100
                          : 255,
                      )}
                </span>
              </label>
            )}
            {name === "manuscript" && (
              <p className="mt-2 text-xs text-muted-foreground">
                A derived reading view for uneven manuscript backgrounds. Compare faint marks with
                the original before transcribing; the receipt records the output hash.
              </p>
            )}
            <div className="mt-4 border-t pt-3">
              <label className="block text-sm" htmlFor="preset">
                Manuscript recipe
              </label>
              <select
                id="preset"
                value=""
                onChange={(e) => {
                  setSteps(RECIPES[e.target.value]?.steps.map((step) => ({ ...step })) ?? []);
                  invalidate();
                }}
                className="mt-1 w-full rounded border bg-background p-2 text-sm"
              >
                <option value="">Choose a preset…</option>
                {Object.entries(RECIPES).map(([id, preset]) => (
                  <option key={id} value={id}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <Button
                className="mt-2 w-full"
                variant="outline"
                disabled={steps.length >= 12}
                onClick={() => {
                  setSteps((old) => [...old, option()]);
                  invalidate();
                }}
              >
                Add current tool to stack
              </Button>
              {steps.map((step, i) => (
                <div key={i} className="mt-1 flex items-center gap-1 rounded border p-1 text-xs">
                  <span className="min-w-0 flex-1 truncate">
                    {i + 1}. {step.name}
                    {step.amount !== undefined ? ` (${step.amount})` : ""}
                  </span>
                  <button
                    aria-label={`Move step ${i + 1} up`}
                    disabled={i === 0}
                    onClick={() => {
                      setSteps((old) => {
                        const copy = [...old];
                        [copy[i - 1], copy[i]] = [copy[i]!, copy[i - 1]!];
                        return copy;
                      });
                      invalidate();
                    }}
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`Remove step ${i + 1}`}
                    onClick={() => {
                      setSteps((old) => old.filter((_, j) => j !== i));
                      invalidate();
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              {steps.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSteps([]);
                    invalidate();
                  }}
                >
                  Clear stack
                </Button>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                These are exploratory derived views. Inspect the original before drawing conclusions
                about faint marks.
              </p>
            </div>
            {name === "channel" && (
              <select
                value={channel}
                onChange={(event) => {
                  setChannel(Number(event.target.value) as 0 | 1 | 2);
                  invalidate();
                }}
                aria-label="Channel"
                className="mt-4 w-full rounded border bg-background p-2 text-sm"
              >
                <option value="0">Red</option>
                <option value="1">Green</option>
                <option value="2">Blue</option>
              </select>
            )}
            <Button onClick={run} disabled={running || !!ws.busy} className="mt-4 w-full">
              {running
                ? "Processing…"
                : steps.length
                  ? `Run ${steps.length} steps`
                  : "Apply to original"}
            </Button>
            {result && (
              <Button
                className="mt-2 w-full"
                variant="outline"
                onClick={() =>
                  downloadBlob(
                    result.blob,
                    `${ws.source!.name.replace(/\.[^.]+$/, "")}-${steps.length ? "recipe" : name}.png`,
                  )
                }
              >
                Download PNG
              </Button>
            )}
          </Panel>
          <Panel
            title="Preview"
            kicker={result ? result.hash.slice(0, 12) : previewUrl ? "live · reduced" : "original"}
          >
            <InspectionViewer
              original={ws.source.url}
              derived={result?.url ?? previewUrl ?? undefined}
              derivedLabel={result ? (steps.length ? "Recipe" : name) : "Live recipe preview"}
              difference={result?.diff}
            />
            {previewUrl && !result && (
              <p className="mt-2 text-xs text-muted-foreground">
                Live preview is sampled to a 1024px maximum dimension. Run the stack to render and
                hash the full-resolution PNG.
              </p>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
