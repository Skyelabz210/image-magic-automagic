// Ported verbatim from upstream (strict index checks disabled for this numeric module).
// @ts-nocheck
/** Browser raster algorithms. CRAM probe ports: see THIRD_PARTY_NOTICES.md. */
export type Raster = { width: number; height: number; data: Uint8ClampedArray };
export type ProbeType = "keld" | "lane" | "quantization";
export type Channel = 0 | 1 | 2;
export const MAX_PIXELS = 16_000_000;
export const MAX_DIMENSION = 8192;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const ALGORITHM_VERSION = "enhance-browser-v2";

export function validateDimensions(width: number, height: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new Error("The image has invalid dimensions.");
  }
  if (width * height > MAX_PIXELS || Math.max(width, height) > MAX_DIMENSION) {
    throw new Error(
      "Choose an image up to 16 million pixels and 8,192 pixels per side. Full resolution is preserved.",
    );
  }
}

export function validateFile(file: {
  size: number;
  type: string;
  name: string;
}) {
  if (file.size === 0)
    throw new Error(
      "This file is empty. Choose a PNG, JPEG, WebP, or BMP image.",
    );
  if (file.size > MAX_FILE_BYTES)
    throw new Error("This file exceeds the 50 MB limit.");
  const supported = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/bmp",
    "image/x-ms-bmp",
  ];
  if (!(
    supported.includes(file.type) ||
    (!file.type && /\.(png|jpe?g|webp|bmp)$/i.test(file.name))
  )) {
    throw new Error("Choose a PNG, JPEG, WebP, or BMP image.");
  }
}

function validateRaster(source: Raster) {
  validateDimensions(source.width, source.height);
  if (source.data.length !== source.width * source.height * 4)
    throw new Error("Invalid RGBA pixel buffer.");
}

function blank(source: Raster): Raster {
  return {
    width: source.width,
    height: source.height,
    data: new Uint8ClampedArray(source.data.length),
  };
}

function reflect(index: number, size: number) {
  while (index < 0 || index >= size)
    index = index < 0 ? -index - 1 : 2 * size - index - 1;
  return index;
}

export type Enhancement = {
  enhanced: Raster;
  entropy: Raster;
  mask: Raster;
  meanEntropy: number;
  activePercent: number;
  clippedPixels: number;
  threshold: number;
  strength: number;
};

/** Shannon entropy in bits, 9×9 reflected windows; alpha-zero samples are excluded.
 * Histogram updates make each horizontal step O(window width), not O(256 bins).
 * This visual enhancement uses floating-point entropy and clamped 8-bit output.
 * The CRAM probes below operate directly on integer channel samples.
 */
export function enhance(
  source: Raster,
  threshold: number,
  strength: number,
): Enhancement {
  validateRaster(source);
  if (
    !Number.isFinite(threshold) ||
    threshold < 0 ||
    threshold > Math.log2(81) ||
    !Number.isFinite(strength) ||
    strength < 1 ||
    strength > 3
  ) {
    throw new Error(
      "Use an entropy threshold from 0 to 6.3 bits and strength from 1 to 3.",
    );
  }
  const { width, height, data } = source;
  const enhanced = { width, height, data: new Uint8ClampedArray(data) };
  const entropy = blank(source),
    mask = blank(source);
  const gray = new Uint8Array(width * height);
  for (let p = 0; p < gray.length; p++) {
    const i = p * 4;
    gray[p] = (77 * data[i] + 150 * data[i + 1] + 29 * data[i + 2] + 128) >> 8;
  }
  const nlogn = Array.from({ length: 82 }, (_, n) =>
    n === 0 ? 0 : n * Math.log2(n),
  );
  let totalEntropy = 0,
    active = 0,
    visible = 0,
    clippedPixels = 0;
  for (let y = 0; y < height; y++) {
    const histogram = new Uint8Array(256);
    let samples = 0,
      sum = 0;
    const change = (x: number, yy: number, delta: number) => {
      const p = reflect(yy, height) * width + reflect(x, width);
      if (data[p * 4 + 3] === 0) return;
      const value = gray[p],
        before = histogram[value],
        after = before + delta;
      histogram[value] = after;
      sum += nlogn[after] - nlogn[before];
      samples += delta;
    };
    for (let yy = y - 4; yy <= y + 4; yy++)
      for (let xx = -4; xx <= 4; xx++) change(xx, yy, 1);
    for (let x = 0; x < width; x++) {
      if (x > 0)
        for (let yy = y - 4; yy <= y + 4; yy++) {
          change(x - 5, yy, -1);
          change(x + 4, yy, 1);
        }
      const p = y * width + x,
        i = p * 4;
      if (data[i + 3] === 0) continue;
      const bits =
        samples > 0 ? Math.max(0, Math.log2(samples) - sum / samples) : 0;
      // Stabilize comparisons to slider precision against accumulated roundoff.
      const selected = bits + 1e-10 >= threshold;
      totalEntropy += bits;
      visible++;
      if (selected) active++;
      const heat = Math.round((bits * 255) / Math.log2(81));
      entropy.data.set(
        [heat, Math.max(24, 120 - (heat >> 2)), 205 - (heat >> 1), data[i + 3]],
        i,
      );
      mask.data.set(
        selected ? [60, 204, 183, data[i + 3]] : [22, 22, 22, data[i + 3]],
        i,
      );
      const neighbors = [
        y * width + Math.max(0, x - 1),
        y * width + Math.min(width - 1, x + 1),
        Math.max(0, y - 1) * width + x,
        Math.min(height - 1, y + 1) * width + x,
      ];
      let neighborSum = 0,
        neighborWeight = 0;
      for (const n of neighbors) {
        neighborSum += gray[n] * data[n * 4 + 3];
        neighborWeight += data[n * 4 + 3];
      }
      const localMean = neighborWeight ? neighborSum / neighborWeight : gray[p];
      const boost = selected
        ? (gray[p] - localMean) * (strength - 1) * 0.68
        : 0;
      let clipped = false;
      for (let c = 0; c < 3; c++) {
        const value = data[i + c] + boost;
        clipped ||= value < 0 || value > 255;
        enhanced.data[i + c] = Math.round(Math.max(0, Math.min(255, value)));
      }
      if (clipped) clippedPixels++;
    }
  }
  return {
    enhanced,
    entropy,
    mask,
    threshold,
    strength,
    clippedPixels,
    meanEntropy: visible ? totalEntropy / visible : 0,
    activePercent: visible ? (active * 100) / visible : 0,
  };
}

const mod = (value: number, modulus: number) =>
  ((value % modulus) + modulus) % modulus;

/** K = (v36 − v37) mod 37, from CRAM-DSP STAR8; valid on [0, 1332). */
export function keldBand(sample: number) {
  if (!Number.isInteger(sample) || sample < 0 || sample >= 1332)
    throw new Error("KELD sample is outside the STAR8 range.");
  return mod((sample % 36) - (sample % 37), 37);
}

/** Independent lanes distinguish ±1 for every 8-bit step; product 1001 > 2×255. */
export function laneUnitStep(a: number, b: number) {
  return [1, -1].some((target) =>
    [7, 11, 13].every(
      (lane) => mod((b % lane) - (a % lane), lane) === mod(target, lane),
    ),
  );
}

export function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

export function estimateBackgroundStep(fingerprints: number[]) {
  const nonflat = fingerprints.filter((n) => n > 0);
  if (!nonflat.length) return 1;
  let best = 1;
  const max = nonflat.reduce((a, b) => Math.max(a, b), 1);
  for (let step = 2; step <= max; step++) {
    if (nonflat.filter((n) => n % step === 0).length * 2 >= nonflat.length)
      best = step;
  }
  return best;
}

export type Probe = {
  map: Raster;
  count: number;
  summary: string;
  metrics: { label: string; value: string }[];
};

export function probe(
  source: Raster,
  type: ProbeType,
  channel: Channel,
): Probe {
  validateRaster(source);
  if (
    ![0, 1, 2].includes(channel) ||
    !["keld", "lane", "quantization"].includes(type)
  )
    throw new Error("Unknown probe or channel.");
  const { width, height, data } = source,
    map = blank(source);
  const opaque = (p: number) => data[p * 4 + 3] === 255;
  const sample = (p: number) => data[p * 4 + channel];
  const paint = (p: number, color: number[]) =>
    map.data.set([...color, 255], p * 4);
  const metrics = [
    { label: "sample channel", value: ["Red", "Green", "Blue"][channel] },
    { label: "native dimensions", value: `${width} × ${height} px` },
  ];
  let count = 0,
    valid = 0,
    summary = "";
  for (let p = 0; p < width * height; p++)
    if (opaque(p)) {
      valid++;
      paint(p, [22, 47, 59]);
    }
  if (type === "keld") {
    const bands = new Set<number>();
    const palette = [
      [29, 48, 67],
      [42, 78, 92],
      [44, 114, 119],
      [76, 146, 138],
      [129, 173, 139],
      [194, 193, 127],
      [225, 162, 91],
      [235, 114, 74],
    ];
    for (let p = 0; p < width * height; p++)
      if (opaque(p)) {
        const k = keldBand(sample(p));
        bands.add(k);
        paint(p, palette[k]);
      }
    count = bands.size;
    summary =
      "Exact STAR8 band indices from residues modulo 36 and 37. Each color identifies one 36-level band in the selected channel.";
    metrics.unshift(
      { label: "occupied bands", value: String(count) },
      {
        label: "band indices",
        value: [...bands].sort((a, b) => a - b).join(", ") || "none",
      },
    );
  } else if (type === "lane") {
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (!opaque(p)) continue;
        // Paint the destination of each horizontal/vertical step, never wrap rows.
        for (const q of [x > 0 ? p - 1 : -1, y > 0 ? p - width : -1]) {
          if (q >= 0 && opaque(q) && laneUnitStep(sample(q), sample(p))) {
            count++;
            paint(p, [220, 198, 101]);
          }
        }
      }
    summary =
      "Signed +1 and −1 transitions selected by independent residues on lanes 7, 11, and 13. Both horizontal and vertical neighbors are inspected.";
    metrics.unshift(
      { label: "unit-step transitions", value: String(count) },
      { label: "lanes", value: "7 · 11 · 13" },
    );
  } else {
    const blocks: { x: number; y: number; step: number }[] = [];
    for (let y = 0; y < height; y += 16)
      for (let x = 0; x < width; x += 16) {
        let step = 0;
        for (let yy = y; yy < Math.min(height, y + 16); yy++)
          for (let xx = x; xx < Math.min(width, x + 16); xx++) {
            const p = yy * width + xx;
            if (!opaque(p)) continue;
            for (const q of [xx > x ? p - 1 : -1, yy > y ? p - width : -1]) {
              if (q >= 0 && opaque(q))
                step = gcd(step, Math.abs(sample(p) - sample(q)));
            }
          }
        blocks.push({ x, y, step });
      }
    const background = estimateBackgroundStep(blocks.map((b) => b.step));
    for (const block of blocks) {
      const flagged = block.step !== 0 && block.step % background !== 0;
      if (flagged) count++;
      const color = flagged
        ? [235, 114, 74]
        : block.step === 0
          ? [55, 60, 65]
          : [70, 150, 135];
      for (let y = block.y; y < Math.min(height, block.y + 16); y++)
        for (let x = block.x; x < Math.min(width, block.x + 16); x++) {
          const p = y * width + x;
          if (opaque(p)) paint(p, color);
        }
    }
    summary =
      "GCD of horizontal and vertical steps in 16×16 blocks, including partial edge blocks. Orange marks non-flat blocks incompatible with the estimated background step; gray marks flat blocks.";
    metrics.unshift(
      { label: "incompatible blocks", value: String(count) },
      { label: "background step", value: String(background) },
      { label: "blocks inspected", value: String(blocks.length) },
    );
  }
  metrics.push({ label: "opaque pixels inspected", value: String(valid) });
  return { map, count, summary, metrics };
}

export type AutoTune = {
  threshold: number;
  strength: number;
  targetActivePercent: number;
  predictedClipPercent: number;
  rationale: string;
};

/** Nearest-neighbour downsample for fast parameter search; never used for output. */
function preview(source: Raster, maxSide: number): Raster {
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  if (scale === 1) return source;
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(source.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(source.width - 1, Math.floor(x / scale));
      data.set(source.data.subarray((sy * source.width + sx) * 4, (sy * source.width + sx) * 4 + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** Pick threshold from the entropy distribution (select the busiest ~45% of the
 * image) and the strongest sharpening that keeps clipping under 0.5%. */
export function autoTune(source: Raster): AutoTune {
  validateRaster(source);
  const small = preview(source, 384);
  const base = enhance(small, 0, 1);
  const heats: number[] = [];
  for (let i = 0; i < base.entropy.data.length; i += 4)
    if (small.data[i + 3] !== 0) heats.push(base.entropy.data[i]);
  heats.sort((a, b) => a - b);
  const maxBits = Math.log2(81);
  const pct = heats.length ? heats[Math.floor(heats.length * 0.55)] : 0;
  const threshold = Math.min(6.3, Math.max(0, Math.round(((pct * maxBits) / 255) * 10) / 10));
  const visible = Math.max(1, heats.length);
  let strength = 1.2;
  let clip = 0;
  for (const s of [2.6, 2.2, 1.9, 1.6, 1.4, 1.2]) {
    const trial = enhance(small, threshold, s);
    clip = (trial.clippedPixels * 100) / visible;
    strength = s;
    if (clip < 0.5) break;
  }
  const flat = base.meanEntropy < 2;
  return {
    threshold,
    strength,
    targetActivePercent: 45,
    predictedClipPercent: Math.round(clip * 100) / 100,
    rationale: `Mean local entropy ${base.meanEntropy.toFixed(2)} bits${flat ? " (low-detail image)" : ""}. Threshold ${threshold} bits selects the busiest ~45% of pixels; strength ${strength} is the strongest setting predicted to clip under 0.5% (${clip.toFixed(2)}%).`,
  };
}
