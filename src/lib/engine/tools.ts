import { validateDimensions, type Raster } from "./processing";

export const TOOL_NAMES = [
  "invert",
  "grayscale",
  "brightness",
  "contrast",
  "channel",
  "threshold",
  "edges",
  "median",
  "manuscript",
  "undertext",
  "ink-fade",
  "parchment",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export type ToolOptions = { name: ToolName; amount?: number; channel?: 0 | 1 | 2 };
export const RECIPES: Record<string, { label: string; steps: ToolOptions[] }> = {
  "undertext-isolation": {
    label: "Undertext exploration",
    steps: [
      { name: "grayscale" },
      { name: "undertext", amount: 35 },
      { name: "contrast", amount: 10 },
    ],
  },
  "ink-fade-recovery": {
    label: "Faded ink reading",
    steps: [
      { name: "parchment", amount: 35 },
      { name: "ink-fade", amount: 25 },
    ],
  },
  "parchment-flattening": {
    label: "Parchment flattening",
    steps: [
      { name: "parchment", amount: 45 },
      { name: "contrast", amount: 10 },
    ],
  },
  "denoise-edges": {
    label: "Denoise and edges",
    steps: [{ name: "median" }, { name: "contrast", amount: 20 }, { name: "edges" }],
  },
};

/** Sequential, deterministic RGBA8 operations; the input raster is never mutated. */
export function applyRecipe(source: Raster, steps: ToolOptions[]): Raster {
  if (!steps.length || steps.length > 12) throw new Error("Recipe needs 1–12 steps.");
  return steps.reduce((current, step) => applyTool(current, step), source);
}

function localPaper(
  source: Raster,
  mode: "undertext" | "ink-fade" | "parchment",
  amount: number,
): Raster {
  const { width, height, data } = source;
  if (amount === 0 && mode !== "ink-fade")
    return { width, height, data: new Uint8ClampedArray(data) };
  // 16M RGBA8 pixels × 255 < 2^32, so unsigned integral sums stay exact.
  const integral = new Uint32Array((width + 1) * (height + 1));
  const count = new Uint32Array(integral.length);
  const stride = width + 1;
  for (let y = 1; y <= height; y++)
    for (let x = 1; x <= width; x++) {
      const i = ((y - 1) * width + x - 1) * 4;
      const a = data[i + 3] === 255 ? 1 : 0;
      const lum = (77 * data[i]! + 150 * data[i + 1]! + 29 * data[i + 2]! + 128) >> 8;
      const p = y * stride + x;
      integral[p] = lum * a + integral[p - 1]! + integral[p - stride]! - integral[p - stride - 1]!;
      count[p] = a + count[p - 1]! + count[p - stride]! - count[p - stride - 1]!;
    }
  const radius = Math.max(8, Math.min(96, Math.round(Math.min(width, height) * 0.025)));
  const output = new Uint8ClampedArray(data);
  const area = (
    table: Float64Array | Uint32Array,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ) =>
    table[y1 * stride + x1]! -
    table[y0 * stride + x1]! -
    table[y1 * stride + x0]! +
    table[y0 * stride + x0]!;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] !== 255) continue;
      const x0 = Math.max(0, x - radius),
        y0 = Math.max(0, y - radius);
      const x1 = Math.min(width, x + radius + 1),
        y1 = Math.min(height, y + radius + 1);
      const n = area(count, x0, y0, x1, y1);
      const paper = n ? area(integral, x0, y0, x1, y1) / n : 255;
      const lum = (77 * data[i]! + 150 * data[i + 1]! + 29 * data[i + 2]!) / 256;
      if (mode === "ink-fade") {
        const value = lum < paper - amount ? 0 : 255;
        output[i] = output[i + 1] = output[i + 2] = value;
      } else if (mode === "undertext") {
        const value = Math.max(0, Math.min(255, 128 + ((paper - lum) * amount) / 25));
        output[i] = output[i + 1] = output[i + 2] = value;
      } else
        for (let c = 0; c < 3; c++) output[i + c] = data[i + c]! + ((220 - paper) * amount) / 100;
    }
  return { width, height, data: output };
}

/**
 * Derived reading view for photographs of ink on uneven paper. A local,
 * alpha-weighted background is estimated with two sliding box passes.
 * The smooth tone curve raises ink-to-paper contrast without hard clipping.
 * Original bytes and raster are never changed.
 */
function manuscriptReading(source: Raster, amount: number): Raster {
  const { width, height, data } = source;
  if (amount === 0) return { width, height, data: new Uint8ClampedArray(data) };
  const radius = Math.min(96, Math.max(8, Math.round(Math.min(width, height) * 0.07)));
  const horizontal = new Float32Array(width * height);
  const weights = new Float32Array(width * height);
  const output = new Uint8ClampedArray(data);
  const alpha = (p: number) => data[p * 4 + 3]! / 255;
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      let weighted = 0;
      let weight = 0;
      for (let k = -radius; k <= radius; k++) {
        const p = row + Math.max(0, Math.min(width - 1, k));
        const a = alpha(p);
        weighted += data[p * 4 + c]! * a;
        weight += a;
      }
      for (let x = 0; x < width; x++) {
        horizontal[row + x] = weighted;
        if (c === 0) weights[row + x] = weight;
        const outgoing = row + Math.max(0, x - radius);
        const incoming = row + Math.min(width - 1, x + radius + 1);
        weighted += data[incoming * 4 + c]! * alpha(incoming);
        weighted -= data[outgoing * 4 + c]! * alpha(outgoing);
        weight += alpha(incoming) - alpha(outgoing);
      }
    }
    for (let x = 0; x < width; x++) {
      let weighted = 0;
      let weight = 0;
      for (let k = -radius; k <= radius; k++) {
        const p = Math.max(0, Math.min(height - 1, k)) * width + x;
        weighted += horizontal[p]!;
        weight += weights[p]!;
      }
      for (let y = 0; y < height; y++) {
        const p = y * width + x;
        const i = p * 4;
        if (data[i + 3]) {
          const original = data[i + c]!;
          const background = weight > 1e-6 ? weighted / weight : original;
          const lifted = 0.3 * original + 0.7 * (214 + 1.35 * (original - background));
          const reading = 255 / (1 + Math.exp(-(lifted - 128) / 50));
          output[i + c] = Math.round(original + (reading - original) * (amount / 100));
        }
        const outgoing = Math.max(0, y - radius) * width + x;
        const incoming = Math.min(height - 1, y + radius + 1) * width + x;
        weighted += horizontal[incoming]! - horizontal[outgoing]!;
        weight += weights[incoming]! - weights[outgoing]!;
      }
    }
  }
  return { width, height, data: output };
}

/** Same RGBA8 transformations in the browser worker and the CLI. Alpha is preserved. */
export function applyTool(source: Raster, options: ToolOptions): Raster {
  validateDimensions(source.width, source.height);
  if (source.data.length !== source.width * source.height * 4)
    throw new Error("Invalid RGBA pixel buffer.");
  if (!TOOL_NAMES.includes(options.name)) throw new Error("Unknown image tool.");
  const { name } = options;
  const amount =
    options.amount ??
    (name === "threshold"
      ? 128
      : name === "manuscript"
        ? 100
        : name === "undertext"
          ? 65
          : name === "ink-fade"
            ? 12
            : name === "parchment"
              ? 70
              : 0);
  if (!Number.isInteger(amount) || amount < (name === "brightness" ? -255 : 0) || amount > 255)
    throw new Error("Tool amount must be an integer in range.");
  if (name === "contrast" && amount > 100) throw new Error("Contrast must be between 0 and 100.");
  if (name === "manuscript" && amount > 100)
    throw new Error("Manuscript reading strength must be between 0 and 100.");
  const channel = options.channel ?? 0;
  if (![0, 1, 2].includes(channel)) throw new Error("Channel must be red, green, or blue.");
  if (name === "manuscript") return manuscriptReading(source, amount);
  if (name === "undertext" || name === "ink-fade" || name === "parchment")
    return localPaper(source, name, amount);
  const { width, height, data } = source;
  const output = new Uint8ClampedArray(data);
  const gray = (p: number) => {
    const i = p * 4;
    return (77 * data[i]! + 150 * data[i + 1]! + 29 * data[i + 2]! + 128) >> 8;
  };
  const sample = (x: number, y: number, center: number) => {
    const p = Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x));
    return data[p * 4 + 3] === 0 ? center : gray(p);
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * width + x,
        i = p * 4;
      if (data[i + 3] === 0) continue;
      let value: number | undefined;
      if (name === "grayscale") value = gray(p);
      if (name === "channel") value = data[i + channel];
      if (name === "threshold") value = gray(p) >= amount ? 255 : 0;
      if (name === "edges") {
        const c = gray(p);
        const neighbors = [-1, 0, 1].flatMap((dy) =>
          [-1, 0, 1].map((dx) => sample(x + dx, y + dy, c)),
        );
        const gx =
          -neighbors[0]! +
          neighbors[2]! -
          2 * neighbors[3]! +
          2 * neighbors[5]! -
          neighbors[6]! +
          neighbors[8]!;
        const gy =
          -neighbors[0]! -
          2 * neighbors[1]! -
          neighbors[2]! +
          neighbors[6]! +
          2 * neighbors[7]! +
          neighbors[8]!;
        value = Math.min(255, Math.round(Math.hypot(gx, gy)));
      }
      for (let c = 0; c < 3; c++) {
        if (name === "median") {
          const neighbors = new Uint8Array(9);
          let k = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const nx = Math.max(0, Math.min(width - 1, x + dx));
              const ny = Math.max(0, Math.min(height - 1, y + dy));
              const n = (ny * width + nx) * 4;
              neighbors[k++] = data[n + 3] === 0 ? data[i + c]! : data[n + c]!;
            }
          neighbors.sort();
          output[i + c] = neighbors[4]!;
          continue;
        }
        output[i + c] =
          value ??
          (name === "invert"
            ? 255 - data[i + c]!
            : name === "brightness"
              ? data[i + c]! + amount
              : 128 + ((data[i + c]! - 128) * (100 + amount)) / 100);
      }
    }
  return { width, height, data: output };
}
