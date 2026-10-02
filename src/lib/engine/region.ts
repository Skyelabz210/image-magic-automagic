import { gcd, keldBand, laneUnitStep, validateDimensions, type Raster } from "./processing";

export type Region = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };
export type ChannelMeasurements = {
  min: number | null;
  max: number | null;
  mean: number | null;
  entropy: number | null;
  occupiedKeldBands: number;
  adjacentStepGcd: number;
  unitSteps: number;
};
export type RegionMeasurements = {
  region: Region;
  opaquePixels: number;
  excludedPixels: number;
  channels: [ChannelMeasurements, ChannelMeasurements, ChannelMeasurements];
  histograms: [number[], number[], number[], number[]];
  localEntropy: (number | null)[];
};

/** Native-coordinate hard masks; white opaque pixels are selected. */
export function makeSelectionMask(
  width: number,
  height: number,
  points: Point[],
  mode: "polygon" | "brush",
  radius = 12,
): { mask: Raster; region: Region } {
  validateDimensions(width, height);
  if (
    points.length < (mode === "polygon" ? 3 : 1) ||
    points.length > 4096 ||
    !Number.isInteger(radius) ||
    radius < 1 ||
    radius > 256 ||
    points.some(
      ({ x, y }) =>
        !Number.isSafeInteger(x) ||
        !Number.isSafeInteger(y) ||
        x < 0 ||
        y < 0 ||
        x >= width ||
        y >= height,
    )
  )
    throw new Error("Selection points must be within the image (3+ for a polygon; up to 4096).");
  const margin = mode === "brush" ? radius : 0;
  const x0 = Math.max(0, Math.min(...points.map((p) => p.x)) - margin),
    y0 = Math.max(0, Math.min(...points.map((p) => p.y)) - margin);
  const x1 = Math.min(width - 1, Math.max(...points.map((p) => p.x)) + margin),
    y1 = Math.min(height - 1, Math.max(...points.map((p) => p.y)) + margin);
  const data = new Uint8ClampedArray(width * height * 4);
  const mark = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 255;
  };
  if (mode === "polygon") {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const a = points[i]!,
            b = points[j]!;
          if (
            a.y > y + 0.5 !== b.y > y + 0.5 &&
            x + 0.5 < ((b.x - a.x) * (y + 0.5 - a.y)) / (b.y - a.y) + a.x
          )
            inside = !inside;
        }
        if (inside) mark(x, y);
      }
  } else
    for (let k = 0; k < points.length; k++) {
      const a = points[Math.max(0, k - 1)]!,
        b = points[k]!;
      const steps = Math.max(
        1,
        Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, radius / 2)),
      );
      for (let s = 0; s <= steps; s++) {
        const cx = a.x + ((b.x - a.x) * s) / steps,
          cy = a.y + ((b.y - a.y) * s) / steps;
        for (
          let y = Math.max(y0, Math.ceil(cy - radius));
          y <= Math.min(y1, Math.floor(cy + radius));
          y++
        )
          for (
            let x = Math.max(x0, Math.ceil(cx - radius));
            x <= Math.min(x1, Math.floor(cx + radius));
            x++
          )
            if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) mark(x, y);
      }
    }
  return {
    mask: { width, height, data },
    region: { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 },
  };
}

/** Native pixel coordinates; only fully opaque samples participate in forensic counts. */
export function measureRegion(source: Raster, region: Region, mask?: Raster): RegionMeasurements {
  validateDimensions(source.width, source.height);
  if (source.data.length !== source.width * source.height * 4)
    throw new Error("Invalid RGBA pixel buffer.");
  if (
    mask &&
    (mask.width !== source.width ||
      mask.height !== source.height ||
      mask.data.length !== source.data.length)
  )
    throw new Error("Mask dimensions must match the original image exactly.");
  const { x, y, width, height } = region;
  if (
    [x, y, width, height].some((n) => !Number.isSafeInteger(n)) ||
    x < 0 ||
    y < 0 ||
    width < 1 ||
    height < 1 ||
    x + width > source.width ||
    y + height > source.height
  )
    throw new Error("Region must have positive integer dimensions within the original image.");

  const histograms = Array.from({ length: 3 }, () => new Uint32Array(256));
  const luminance = new Uint32Array(256);
  const local = Array.from({ length: 64 }, () => new Uint32Array(256));
  const localCount = new Uint32Array(64);
  const sums = [0, 0, 0],
    steps = [0, 0, 0],
    unitSteps = [0, 0, 0];
  const bands = Array.from({ length: 3 }, () => new Set<number>());
  const { data } = source;
  let opaque = 0;
  for (let yy = y; yy < y + height; yy++)
    for (let xx = x; xx < x + width; xx++) {
      const i = (yy * source.width + xx) * 4;
      // A segmentation mask may use either opaque white on black or white on
      // transparency. Partial alpha and soft grayscale are thresholded at 128.
      if (
        mask &&
        (mask.data[i + 3]! < 128 ||
          (mask.data[i]! + mask.data[i + 1]! + mask.data[i + 2]!) / 3 < 128)
      )
        continue;
      if (data[i + 3] !== 255) continue;
      opaque++;
      const lum = (77 * data[i]! + 150 * data[i + 1]! + 29 * data[i + 2]! + 128) >> 8;
      luminance[lum] = luminance[lum]! + 1;
      const tile =
        Math.min(7, Math.floor(((yy - y) * 8) / height)) * 8 +
        Math.min(7, Math.floor(((xx - x) * 8) / width));
      local[tile]![lum] = local[tile]![lum]! + 1;
      localCount[tile] = localCount[tile]! + 1;
      for (let c = 0; c < 3; c++) {
        const v = data[i + c]!;
        histograms[c]![v] = histograms[c]![v]! + 1;
        sums[c]! += v;
        bands[c]!.add(keldBand(v));
        for (const n of [xx > x ? i - 4 : -1, yy > y ? i - source.width * 4 : -1]) {
          if (
            n < 0 ||
            data[n + 3] !== 255 ||
            (mask &&
              (mask.data[n + 3]! < 128 ||
                (mask.data[n]! + mask.data[n + 1]! + mask.data[n + 2]!) / 3 < 128))
          )
            continue;
          steps[c] = gcd(steps[c]!, Math.abs(v - data[n + c]!));
          if (laneUnitStep(data[n + c]!, v)) unitSteps[c]!++;
        }
      }
    }
  const channels = histograms.map((hist, c): ChannelMeasurements => {
    if (!opaque)
      return {
        min: null,
        max: null,
        mean: null,
        entropy: null,
        occupiedKeldBands: 0,
        adjacentStepGcd: 0,
        unitSteps: 0,
      };
    let min = 0,
      max = 255,
      entropy = 0;
    while (!hist[min]) min++;
    while (!hist[max]) max--;
    for (const count of hist)
      if (count) {
        const p = count / opaque;
        entropy -= p * Math.log2(p);
      }
    return {
      min,
      max,
      mean: sums[c]! / opaque,
      entropy,
      occupiedKeldBands: bands[c]!.size,
      adjacentStepGcd: steps[c]!,
      unitSteps: unitSteps[c]!,
    };
  });
  return {
    region: { x, y, width, height },
    opaquePixels: opaque,
    excludedPixels: width * height - opaque,
    channels: channels as RegionMeasurements["channels"],
    histograms: [
      ...histograms.map((h) => Array.from(h)),
      Array.from(luminance),
    ] as RegionMeasurements["histograms"],
    localEntropy: local.map((h, i) => {
      if (!localCount[i]) return null;
      let e = 0;
      for (const count of h)
        if (count) {
          const p = count / localCount[i]!;
          e -= p * Math.log2(p);
        }
      return e;
    }),
  };
}
