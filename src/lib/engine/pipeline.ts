import type { AutoTune, Channel, Enhancement, Probe, ProbeType, Raster } from "./processing";
import { ALGORITHM_VERSION } from "./processing";
import { rasterToBlob, runWorker } from "./image-io";
import { rasterDigest, sha256 } from "./provenance";
import type { ToolOptions } from "./tools";

const clone = (r: Raster): Raster => ({
  width: r.width,
  height: r.height,
  data: new Uint8ClampedArray(r.data),
});

export async function workerEnhance(
  raster: Raster,
  threshold: number,
  strength: number,
  signal: AbortSignal,
) {
  const res = await runWorker(
    { kind: "enhance", source: clone(raster), threshold, strength },
    signal,
  );
  if (!("kind" in res) || res.kind !== "enhance") throw new Error("Unexpected worker response.");
  return res.result;
}
export async function workerProbe(
  raster: Raster,
  type: ProbeType,
  channel: Channel,
  signal: AbortSignal,
) {
  const res = await runWorker(
    { kind: "probe", source: clone(raster), probe: type, channel },
    signal,
  );
  if (!("kind" in res) || res.kind !== "probe") throw new Error("Unexpected worker response.");
  return res.result;
}
export async function workerAutoTune(raster: Raster, signal: AbortSignal) {
  const res = await runWorker({ kind: "autotune", source: clone(raster) }, signal);
  if (!("kind" in res) || res.kind !== "autotune") throw new Error("Unexpected worker response.");
  return res.result;
}
export async function workerTool(raster: Raster, options: ToolOptions, signal: AbortSignal) {
  const res = await runWorker({ kind: "tool", source: clone(raster), options }, signal);
  if (!("kind" in res) || res.kind !== "tool") throw new Error("Unexpected worker response.");
  return res.result;
}

export async function pngHash(raster: Raster) {
  const blob = await rasterToBlob(raster);
  return { blob, hash: await sha256(await blob.arrayBuffer()) };
}

export type PipelineResult = {
  tune: AutoTune;
  enhancement: Enhancement;
  probes: Record<ProbeType, Probe>;
  hashes: { raster: string; enhancedPng: string };
  enhancedBlob: Blob;
};

export const PROBES: ProbeType[] = ["keld", "lane", "quantization"];

/** Auto-tune → enhance → all three probes on one channel. */
export async function runFullPipeline(
  raster: Raster,
  channel: Channel,
  signal: AbortSignal,
  onStep?: (step: string) => void,
  override?: { threshold: number; strength: number },
): Promise<PipelineResult> {
  onStep?.("Auto-tuning settings");
  const tune = await workerAutoTune(raster, signal);
  const threshold = override?.threshold ?? tune.threshold;
  const strength = override?.strength ?? tune.strength;
  onStep?.("Enhancing");
  const enhancement = await workerEnhance(raster, threshold, strength, signal);
  const probes = {} as Record<ProbeType, Probe>;
  for (const p of PROBES) {
    onStep?.(`Probe: ${p}`);
    probes[p] = await workerProbe(raster, p, channel, signal);
  }
  onStep?.("Hashing outputs");
  const [rasterHash, png] = await Promise.all([
    rasterDigest(raster),
    pngHash(enhancement.enhanced),
  ]);
  return {
    tune,
    enhancement,
    probes,
    hashes: { raster: rasterHash, enhancedPng: png.hash },
    enhancedBlob: png.blob,
  };
}

export { ALGORITHM_VERSION };
