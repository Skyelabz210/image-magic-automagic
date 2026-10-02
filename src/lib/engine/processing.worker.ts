import {
  autoTune,
  enhance,
  probe,
  type AutoTune,
  type Channel,
  type Enhancement,
  type Probe,
  type ProbeType,
  type Raster,
} from "./processing";
import { applyTool, applyRecipe, type ToolOptions } from "./tools";
import { measureRegion, type Region, type RegionMeasurements } from "./region";

export type Request = { source: Raster } & (
  | { kind: "enhance"; threshold: number; strength: number }
  | { kind: "probe"; probe: ProbeType; channel: Channel }
  | { kind: "autotune" }
  | { kind: "tool"; options: ToolOptions }
  | { kind: "recipe"; steps: ToolOptions[] }
  | { kind: "difference"; derived: Raster }
  | { kind: "region"; region: Region; mask?: Raster }
);
export type Response =
  | { kind: "enhance"; result: Enhancement }
  | { kind: "probe"; result: Probe }
  | { kind: "autotune"; result: AutoTune }
  | { kind: "tool"; result: Raster }
  | { kind: "recipe"; result: Raster }
  | { kind: "difference"; result: Raster }
  | { kind: "region"; result: RegionMeasurements }
  | { error: string };

const scope = self as unknown as {
  onmessage: (event: MessageEvent<Request>) => void;
  postMessage: (message: Response, transfer?: Transferable[]) => void;
};
scope.onmessage = ({ data }) => {
  try {
    if (data.kind === "enhance") {
      const result = enhance(data.source, data.threshold, data.strength);
      scope.postMessage({ kind: "enhance", result }, [
        result.enhanced.data.buffer,
        result.entropy.data.buffer,
        result.mask.data.buffer,
      ] as ArrayBuffer[]);
    } else if (data.kind === "autotune") {
      scope.postMessage({ kind: "autotune", result: autoTune(data.source) });
    } else if (data.kind === "tool") {
      const result = applyTool(data.source, data.options);
      scope.postMessage({ kind: "tool", result }, [result.data.buffer] as ArrayBuffer[]);
    } else if (data.kind === "recipe") {
      const result = applyRecipe(data.source, data.steps);
      scope.postMessage({ kind: "recipe", result }, [result.data.buffer] as ArrayBuffer[]);
    } else if (data.kind === "difference") {
      const { source, derived } = data;
      if (
        source.width !== derived.width ||
        source.height !== derived.height ||
        source.data.length !== derived.data.length
      )
        throw new Error("Difference layers must have matching dimensions.");
      const output = new Uint8ClampedArray(source.data.length);
      for (let i = 0; i < output.length; i += 4) {
        const delta = Math.min(
          255,
          Math.round(
            ((Math.abs(source.data[i]! - derived.data[i]!) +
              Math.abs(source.data[i + 1]! - derived.data[i + 1]!) +
              Math.abs(source.data[i + 2]! - derived.data[i + 2]!)) *
              4) /
              3,
          ),
        );
        output[i] = delta;
        output[i + 1] = Math.round(delta * 0.35);
        output[i + 2] = 0;
        output[i + 3] = Math.max(source.data[i + 3]!, derived.data[i + 3]!);
      }
      scope.postMessage(
        {
          kind: "difference",
          result: { width: source.width, height: source.height, data: output },
        },
        [output.buffer],
      );
    } else if (data.kind === "region") {
      scope.postMessage({
        kind: "region",
        result: measureRegion(data.source, data.region, data.mask),
      });
    } else {
      const result = probe(data.source, data.probe, data.channel);
      scope.postMessage({ kind: "probe", result }, [result.map.data.buffer] as ArrayBuffer[]);
    }
  } catch (error) {
    scope.postMessage({
      error: error instanceof Error ? error.message : "Pixel processing failed.",
    });
  }
};
