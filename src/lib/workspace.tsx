import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import type { AutoTune, Channel, Enhancement, Probe, ProbeType, Raster } from "./engine/processing";
import { ALGORITHM_VERSION, validateFile } from "./engine/processing";
import type { RegionMeasurements } from "./engine/region";
import { downloadBlob, isAbort, outputName, rasterToBlob, readRaster } from "./engine/image-io";
import {
  addEntry,
  hashText,
  rasterDigest,
  RECEIPT_KEY,
  sha256,
  verifyLedger,
  type LedgerEntry,
  type Parameters,
} from "./engine/provenance";
import {
  pngHash,
  runFullPipeline,
  workerAutoTune,
  workerEnhance,
  workerProbe,
} from "./engine/pipeline";

export type Layer = "original" | "enhanced" | "entropy" | "mask";
export type SavedRegion = {
  id: string;
  name: string;
  metrics: RegionMeasurements;
  masked?: boolean;
};
export type Source = {
  name: string;
  size: number;
  type: string;
  url: string;
  raster: Raster;
  fileHash: string;
  rasterHash: string;
};

type Ctx = {
  source: Source | null;
  threshold: number;
  strength: number;
  channel: Channel;
  setThreshold: (n: number) => void;
  setStrength: (n: number) => void;
  setChannel: (c: Channel) => void;
  enhancement: Enhancement | null;
  enhancedFor: string | null;
  layerUrls: Partial<Record<Layer, string>>;
  probe: { type: ProbeType; channel: Channel; result: Probe; url: string } | null;
  tune: AutoTune | null;
  busy: string | null;
  ledger: LedgerEntry[];
  savedRegions: SavedRegion[];
  setSavedRegions: Dispatch<SetStateAction<SavedRegion[]>>;
  loadFile: (f: File) => Promise<void>;
  reset: () => void;
  runEnhance: (p?: { threshold: number; strength: number }) => Promise<void>;
  runProbe: (type: ProbeType, channel?: Channel) => Promise<void>;
  runAutoTune: () => Promise<AutoTune | null>;
  runAll: () => Promise<void>;
  cancel: () => void;
  record: (op: string, params: Parameters) => Promise<void>;
  exportReceipt: () => Promise<void>;
  clearLedger: () => void;
};

// Reuse one context across hot reloads so the provider and its readers never get out of sync.
const store = globalThis as unknown as { __enhanceWorkspace?: import("react").Context<Ctx | null> };
const WorkspaceContext = (store.__enhanceWorkspace ??= createContext<Ctx | null>(null));
export const useWorkspace = () => {
  const c = useContext(WorkspaceContext);
  if (!c) throw new Error("useWorkspace outside provider");
  return c;
};

const blobUrl = async (r: Raster) => URL.createObjectURL(await rasterToBlob(r));

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<Source | null>(null);
  const [threshold, setThresholdS] = useState(3.5);
  const [strength, setStrengthS] = useState(1.8);
  const [channel, setChannel] = useState<Channel>(1);
  const [enhancement, setEnhancement] = useState<Enhancement | null>(null);
  const [enhancedFor, setEnhancedFor] = useState<string | null>(null);
  const [layerUrls, setLayerUrls] = useState<Partial<Record<Layer, string>>>({});
  const [probe, setProbe] = useState<Ctx["probe"]>(null);
  const [tune, setTune] = useState<AutoTune | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [savedRegions, setSavedRegions] = useState<SavedRegion[]>([]);
  const ledgerRef = useRef<LedgerEntry[]>([]);
  const ledgerReady = useRef<Promise<void>>(Promise.resolve());
  const recordQueue = useRef<Promise<void>>(Promise.resolve());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const t = Number(localStorage.getItem("enhance-threshold"));
    const s = Number(localStorage.getItem("enhance-strength"));
    if (t >= 0 && t <= 6.3 && localStorage.getItem("enhance-threshold")) setThresholdS(t);
    if (s >= 1 && s <= 3) setStrengthS(s);
    const raw = localStorage.getItem(RECEIPT_KEY);
    if (raw)
      ledgerReady.current = (async () => {
        try {
          const entries = await verifyLedger(JSON.parse(raw));
          ledgerRef.current = entries;
          setLedger(entries);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Receipt data could not be read.");
        }
      })();
  }, []);

  const setThreshold = (n: number) => {
    setThresholdS(n);
    localStorage.setItem("enhance-threshold", String(n));
  };
  const setStrength = (n: number) => {
    setStrengthS(n);
    localStorage.setItem("enhance-strength", String(n));
  };

  const record = useCallback(async (op: string, params: Parameters) => {
    const pending = recordQueue.current.then(async () => {
      await ledgerReady.current;
      const next = await addEntry(ledgerRef.current, op, params);
      ledgerRef.current = next;
      setLedger(next);
      localStorage.setItem(RECEIPT_KEY, JSON.stringify(next));
    });
    recordQueue.current = pending.catch(() => {});
    await pending;
  }, []);

  const begin = (label: string) => {
    abortRef.current?.abort();
    const c = new AbortController();
    abortRef.current = c;
    setBusy(label);
    return c.signal;
  };
  const end = (signal: AbortSignal, err?: unknown) => {
    if (abortRef.current?.signal !== signal) return;
    abortRef.current = null;
    setBusy(null);
    if (err && !isAbort(err))
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
  };

  const clearOutputs = () => {
    setEnhancement(null);
    setEnhancedFor(null);
    setProbe(null);
    setTune(null);
    setLayerUrls((u) => {
      Object.entries(u).forEach(([k, v]) => k !== "original" && v && URL.revokeObjectURL(v));
      return {};
    });
  };

  const loadFile = async (file: File) => {
    const signal = begin("Decoding image");
    let url: string | null = null;
    try {
      validateFile(file);
      url = URL.createObjectURL(file);
      const raster = await readRaster(url, signal);
      const [fileHash, rasterHash] = await Promise.all([
        sha256(await file.arrayBuffer()),
        rasterDigest(raster),
      ]);
      signal.throwIfAborted();
      if (source) URL.revokeObjectURL(source.url);
      clearOutputs();
      setSavedRegions([]);
      setSource({
        name: file.name,
        size: file.size,
        type: file.type,
        url,
        raster,
        fileHash,
        rasterHash,
      });
      setLayerUrls({ original: url });
      url = null;
      await record("import", {
        file: file.name,
        bytes: file.size,
        width: raster.width,
        height: raster.height,
        fileSha256: fileHash,
        rasterSha256: rasterHash,
      });
      end(signal);
    } catch (e) {
      if (url) URL.revokeObjectURL(url);
      end(signal, e);
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    if (source) URL.revokeObjectURL(source.url);
    clearOutputs();
    setSavedRegions([]);
    setSource(null);
    setBusy(null);
  };

  const doEnhance = async (
    raster: Raster,
    t: number,
    s: number,
    signal: AbortSignal,
    ready?: Enhancement,
    readyHash?: string,
  ) => {
    const result = ready ?? (await workerEnhance(raster, t, s, signal));
    const [enh, ent, mask] = await Promise.all([
      blobUrl(result.enhanced),
      blobUrl(result.entropy),
      blobUrl(result.mask),
    ]);
    if (signal.aborted) {
      [enh, ent, mask].forEach(URL.revokeObjectURL);
      signal.throwIfAborted();
    }
    setEnhancement(result);
    setEnhancedFor(`${t}|${s}`);
    setLayerUrls((u) => {
      [u.enhanced, u.entropy, u.mask].forEach((v) => v && URL.revokeObjectURL(v));
      return { ...(u.original ? { original: u.original } : {}), enhanced: enh, entropy: ent, mask };
    });
    const hash = readyHash ?? (await pngHash(result.enhanced)).hash;
    await record("enhance", {
      algorithm: ALGORITHM_VERSION,
      threshold: t,
      strength: s,
      meanEntropy: +result.meanEntropy.toFixed(4),
      activePercent: +result.activePercent.toFixed(2),
      clippedPixels: result.clippedPixels,
      outputSha256: hash,
    });
  };

  const runEnhance = async (p?: { threshold: number; strength: number }) => {
    if (!source) return;
    const t = p?.threshold ?? threshold,
      s = p?.strength ?? strength;
    const signal = begin("Enhancing");
    try {
      await doEnhance(source.raster, t, s, signal);
      end(signal);
    } catch (e) {
      end(signal, e);
    }
  };

  const doProbe = async (raster: Raster, type: ProbeType, ch: Channel, signal: AbortSignal) => {
    const result = await workerProbe(raster, type, ch, signal);
    const url = await blobUrl(result.map);
    if (signal.aborted) {
      URL.revokeObjectURL(url);
      signal.throwIfAborted();
    }
    setProbe((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return { type, channel: ch, result, url };
    });
    const png = await pngHash(result.map);
    await record(`probe:${type}`, {
      channel: ["red", "green", "blue"][ch]!,
      count: result.count,
      outputSha256: png.hash,
    });
  };

  const runProbe = async (type: ProbeType, ch?: Channel) => {
    if (!source) return;
    const signal = begin(`Running ${type} probe`);
    try {
      await doProbe(source.raster, type, ch ?? channel, signal);
      end(signal);
    } catch (e) {
      end(signal, e);
    }
  };

  const runAutoTune = async () => {
    if (!source) return null;
    const signal = begin("Auto-tuning");
    try {
      const t = await workerAutoTune(source.raster, signal);
      signal.throwIfAborted();
      setTune(t);
      setThreshold(t.threshold);
      setStrength(t.strength);
      await record("autotune", {
        threshold: t.threshold,
        strength: t.strength,
        predictedClipPercent: t.predictedClipPercent,
      });
      end(signal);
      return t;
    } catch (e) {
      end(signal, e);
      return null;
    }
  };

  const runAll = async () => {
    if (!source) return;
    const signal = begin("Auto-tuning");
    try {
      const r = await runFullPipeline(source.raster, channel, signal, (s) => {
        if (abortRef.current?.signal === signal) setBusy(s);
      });
      signal.throwIfAborted();
      setTune(r.tune);
      setThreshold(r.tune.threshold);
      setStrength(r.tune.strength);
      await record("autotune", {
        threshold: r.tune.threshold,
        strength: r.tune.strength,
        predictedClipPercent: r.tune.predictedClipPercent,
      });
      setBusy("Rendering layers");
      await doEnhance(
        source.raster,
        r.tune.threshold,
        r.tune.strength,
        signal,
        r.enhancement,
        r.hashes.enhancedPng,
      );
      const probeTypes: ProbeType[] = ["keld", "lane", "quantization"];
      const probeHashes = await Promise.all(probeTypes.map((p) => pngHash(r.probes[p].map)));
      for (const [i, p] of probeTypes.entries()) {
        await record(`probe:${p}`, {
          channel: ["red", "green", "blue"][channel]!,
          count: r.probes[p].count,
          outputSha256: probeHashes[i]!.hash,
        });
      }
      const url = await blobUrl(r.probes.quantization.map);
      if (signal.aborted) {
        URL.revokeObjectURL(url);
        signal.throwIfAborted();
      }
      setProbe((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { type: "quantization", channel, result: r.probes.quantization, url };
      });
      end(signal);
      toast.success("Full run complete: enhanced, probed, and recorded.");
    } catch (e) {
      end(signal, e);
    }
  };

  const exportReceipt = async () => {
    const body = {
      format: "enhance-receipt-v2",
      exportedAt: new Date().toISOString(),
      source: source
        ? {
            name: source.name,
            bytes: source.size,
            fileSha256: source.fileHash,
            rasterSha256: source.rasterHash,
          }
        : null,
      ledger: ledgerRef.current,
      ledgerHead: ledgerRef.current.at(-1)?.chain ?? null,
    };
    const text = JSON.stringify(body, null, 2);
    const digest = await hashText(text);
    downloadBlob(
      new Blob([text], { type: "application/json" }),
      `${(source?.name ?? "session").replace(/\.[^.]+$/, "")}-receipt-${digest.slice(0, 8)}.json`,
    );
  };

  const clearLedger = () => {
    ledgerRef.current = [];
    setLedger([]);
    localStorage.removeItem(RECEIPT_KEY);
  };

  return (
    <WorkspaceContext.Provider
      value={{
        source,
        threshold,
        strength,
        channel,
        setThreshold,
        setStrength,
        setChannel,
        enhancement,
        enhancedFor,
        layerUrls,
        probe,
        tune,
        busy,
        ledger,
        savedRegions,
        setSavedRegions,
        loadFile,
        reset,
        runEnhance,
        runProbe,
        runAutoTune,
        runAll,
        cancel: () => {
          abortRef.current?.abort();
          setBusy(null);
        },
        record,
        exportReceipt,
        clearLedger,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export async function downloadLayer(url: string, name: string, layer: string) {
  const blob = await (await fetch(url)).blob();
  downloadBlob(blob, outputName(name, layer));
}

/** Small JPEG data URL for AI analysis. */
export function previewDataUrl(r: Raster, max = 768) {
  const scale = Math.min(1, max / Math.max(r.width, r.height));
  const src = document.createElement("canvas");
  src.width = r.width;
  src.height = r.height;
  src
    .getContext("2d")!
    .putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(r.width * scale));
  out.height = Math.max(1, Math.round(r.height * scale));
  out.getContext("2d")!.drawImage(src, 0, 0, out.width, out.height);
  return out.toDataURL("image/jpeg", 0.85);
}
