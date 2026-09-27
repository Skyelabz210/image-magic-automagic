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
import { applyTool, type ToolOptions } from "./tools";
import { measureRegion, type Region, type RegionMeasurements } from "./region";

export type Request = { source: Raster } & (
  | { kind: "enhance"; threshold: number; strength: number }
  | { kind: "probe"; probe: ProbeType; channel: Channel }
  | { kind: "autotune" }
  | { kind: "tool"; options: ToolOptions }
  | { kind: "region"; region: Region }
);
export type Response =
  | { kind: "enhance"; result: Enhancement }
  | { kind: "probe"; result: Probe }
  | { kind: "autotune"; result: AutoTune }
  | { kind: "tool"; result: Raster }
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
    } else if (data.kind === "region") {
      scope.postMessage({ kind: "region", result: measureRegion(data.source, data.region) });
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
