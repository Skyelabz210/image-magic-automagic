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
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export type ToolOptions = { name: ToolName; amount?: number; channel?: 0 | 1 | 2 };

/** Same RGBA8 transformations in the browser worker and the CLI. Alpha is preserved. */
export function applyTool(source: Raster, options: ToolOptions): Raster {
  validateDimensions(source.width, source.height);
  if (source.data.length !== source.width * source.height * 4)
    throw new Error("Invalid RGBA pixel buffer.");
  if (!TOOL_NAMES.includes(options.name)) throw new Error("Unknown image tool.");
  const { name } = options;
  const amount = options.amount ?? (name === "threshold" ? 128 : 0);
  if (!Number.isInteger(amount) || amount < (name === "brightness" ? -255 : 0) || amount > 255)
    throw new Error("Tool amount must be an integer in range.");
  if (name === "contrast" && amount > 100) throw new Error("Contrast must be between 0 and 100.");
  const channel = options.channel ?? 0;
  if (![0, 1, 2].includes(channel)) throw new Error("Channel must be red, green, or blue.");
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
