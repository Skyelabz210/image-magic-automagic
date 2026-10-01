import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dropzone } from "@/components/dropzone";
import { PageTitle, Panel } from "@/components/shell";
import { downloadBlob, rasterToBlob } from "@/lib/engine/image-io";
import { workerTool } from "@/lib/engine/pipeline";
import { sha256 } from "@/lib/engine/provenance";
import { TOOL_NAMES, type ToolName } from "@/lib/engine/tools";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/tools")({
  component: ToolsPage,
  head: () => ({ meta: [{ title: "Image Tools — ENHANCE!" }] }),
});

function ToolsPage() {
  const ws = useWorkspace();
  const [name, setName] = useState<ToolName>("grayscale");
  const [amount, setAmount] = useState(128);
  const [channel, setChannel] = useState<0 | 1 | 2>(0);
  const [result, setResult] = useState<{ url: string; blob: Blob; hash: string } | null>(null);
  const [running, setRunning] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result.url);
    },
    [result],
  );
  useEffect(() => {
    setResult(null);
    setRunning(false);
    return () => controllerRef.current?.abort();
  }, [ws.source]);
  const invalidate = () => {
    controllerRef.current?.abort();
    setRunning(false);
    setResult(null);
  };
  const run = async () => {
    if (!ws.source) return;
    const current = ws.source;
    const options = {
      name,
      amount:
        name === "brightness"
          ? amount - 128
          : name === "contrast" || name === "manuscript"
            ? Math.min(100, amount)
            : amount,
      channel,
    };
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setRunning(true);
    try {
      const raster = await workerTool(current.raster, options, controller.signal);
      const blob = await rasterToBlob(raster);
      const hash = await sha256(await blob.arrayBuffer());
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(blob);
      setResult({ url, blob, hash });
      await ws.record(`tool:${name}`, {
        sourceSha256: current.rasterHash,
        outputSha256: hash,
        amount: options.amount,
        channel,
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
        Apply a tool to the original image at full resolution. Outputs are PNGs with a SHA-256
        receipt.
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
                if (event.target.value === "manuscript") setAmount(100);
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
              name === "manuscript") && (
              <label className="mt-4 block text-sm" htmlFor="amount">
                {name === "brightness"
                  ? "Brightness (−128 to +127)"
                  : name === "contrast"
                    ? "Contrast (0–100%)"
                    : name === "manuscript"
                      ? "Reading contrast (0–100%)"
                      : "Threshold (0–255)"}
                <input
                  id="amount"
                  type="range"
                  min="0"
                  max={name === "contrast" || name === "manuscript" ? 100 : 255}
                  value={Math.min(amount, name === "contrast" || name === "manuscript" ? 100 : 255)}
                  onChange={(event) => {
                    setAmount(Number(event.target.value));
                    invalidate();
                  }}
                  className="mt-2 w-full"
                />
                <span className="font-mono text-xs">
                  {name === "brightness"
                    ? amount - 128
                    : Math.min(amount, name === "contrast" || name === "manuscript" ? 100 : 255)}
                </span>
              </label>
            )}
            {name === "manuscript" && (
              <p className="mt-2 text-xs text-muted-foreground">
                A derived reading view for uneven manuscript backgrounds. Compare faint marks with
                the original before transcribing; the receipt records the output hash.
              </p>
            )}
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
              {running ? "Processing…" : "Apply to original"}
            </Button>
            {result && (
              <Button
                className="mt-2 w-full"
                variant="outline"
                onClick={() =>
                  downloadBlob(
                    result.blob,
                    `${ws.source!.name.replace(/\.[^.]+$/, "")}-${name}.png`,
                  )
                }
              >
                Download PNG
              </Button>
            )}
          </Panel>
          <Panel title="Preview" kicker={result ? result.hash.slice(0, 12) : "original"}>
            <div className={result ? "grid gap-3 md:grid-cols-2" : ""}>
              <div>
                <p className="mb-2 font-mono text-xs text-muted-foreground">Original</p>
                <div className="checker flex min-h-[360px] items-center justify-center rounded-md">
                  <img
                    src={ws.source.url}
                    alt="Original imported image"
                    className="max-h-[70vh] max-w-full object-contain"
                  />
                </div>
              </div>
              {result && (
                <div>
                  <p className="mb-2 font-mono text-xs text-muted-foreground">Derived: {name}</p>
                  <div className="checker flex min-h-[360px] items-center justify-center rounded-md">
                    <img
                      src={result.url}
                      alt={`${name} output`}
                      className="max-h-[70vh] max-w-full object-contain"
                    />
                  </div>
                </div>
              )}
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
