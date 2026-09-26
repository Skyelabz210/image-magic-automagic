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

export type Request = { source: Raster } & (
  | { kind: "enhance"; threshold: number; strength: number }
  | { kind: "probe"; probe: ProbeType; channel: Channel }
  | { kind: "autotune" }
);
export type Response =
  | { kind: "enhance"; result: Enhancement }
  | { kind: "probe"; result: Probe }
  | { kind: "autotune"; result: AutoTune }
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
