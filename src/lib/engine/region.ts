import { gcd, keldBand, laneUnitStep, validateDimensions, type Raster } from "./processing";

export type Region = { x: number; y: number; width: number; height: number };
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
};

/** Native pixel coordinates; only fully opaque samples participate in forensic counts. */
export function measureRegion(source: Raster, region: Region): RegionMeasurements {
  validateDimensions(source.width, source.height);
  if (source.data.length !== source.width * source.height * 4)
    throw new Error("Invalid RGBA pixel buffer.");
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
  const sums = [0, 0, 0],
    steps = [0, 0, 0],
    unitSteps = [0, 0, 0];
  const bands = Array.from({ length: 3 }, () => new Set<number>());
  const { data } = source;
  let opaque = 0;
  for (let yy = y; yy < y + height; yy++)
    for (let xx = x; xx < x + width; xx++) {
      const i = (yy * source.width + xx) * 4;
      if (data[i + 3] !== 255) continue;
      opaque++;
      for (let c = 0; c < 3; c++) {
        const v = data[i + c]!;
        histograms[c]![v] = histograms[c]![v]! + 1;
        sums[c]! += v;
        bands[c]!.add(keldBand(v));
        for (const n of [xx > x ? i - 4 : -1, yy > y ? i - source.width * 4 : -1]) {
          if (n < 0 || data[n + 3] !== 255) continue;
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
  };
}
