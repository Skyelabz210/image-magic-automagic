import sharp from "sharp";
import { probe, type Raster } from "../src/lib/engine/processing";
import { measureRegion } from "../src/lib/engine/region";

/** Deterministic stress conditions. All variants share the source's pixel geometry. */
export async function stressReport(source: Raster) {
  if (source.width * source.height > 2_000_000)
    throw new Error("Stress mode is limited to 2 million pixels. Resize a copy first.");
  const raw = Buffer.from(source.data);
  const image = () =>
    sharp(raw, { raw: { width: source.width, height: source.height, channels: 4 } });
  const base = await image().jpeg({ quality: 85, chromaSubsampling: "4:2:0" }).toBuffer();
  const lower = await image().jpeg({ quality: 60, chromaSubsampling: "4:2:0" }).toBuffer();
  const twice = await sharp(base).jpeg({ quality: 60, chromaSubsampling: "4:2:0" }).toBuffer();
  const reduced = await image()
    .resize({
      width: Math.max(1, Math.floor(source.width / 2)),
      height: Math.max(1, Math.floor(source.height / 2)),
      fit: "fill",
    })
    .png()
    .toBuffer();
  const scaled = await sharp(reduced)
    .resize(source.width, source.height, { fit: "fill" })
    .png()
    .toBuffer();
  const blurred = await image().blur(1.5).png().toBuffer();
  const all: [string, Buffer | null][] = [
    ["source", null],
    ["jpeg-q85", base],
    ["jpeg-q60", lower],
    ["jpeg-q85-then-q60", twice],
    ["half-size-then-upscale", scaled],
    ["gaussian-blur-1.5", blurred],
  ];
  const center = {
    x: Math.floor(source.width / 4),
    y: Math.floor(source.height / 4),
    width: Math.max(1, Math.floor(source.width / 2)),
    height: Math.max(1, Math.floor(source.height / 2)),
  };
  const variants = [];
  for (const [name, bytes] of all) {
    const raster = bytes
      ? await (async (): Promise<Raster> => {
          const decoded = await sharp(bytes)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
          return {
            width: decoded.info.width,
            height: decoded.info.height,
            data: new Uint8ClampedArray(decoded.data),
          };
        })()
      : source;
    const counts = Object.fromEntries(
      (["keld", "lane", "quantization"] as const).map((kind) => [
        kind,
        probe(raster, kind, 1).count,
      ]),
    );
    const region = measureRegion(raster, center);
    let totalDifference = 0;
    for (let i = 0; i < raster.data.length; i += 4)
      for (let c = 0; c < 3; c++)
        totalDifference += Math.abs(source.data[i + c]! - raster.data[i + c]!);
    variants.push({
      name,
      counts,
      centerGreenEntropy: region.channels[1].entropy,
      centerGreenStepGcd: region.channels[1].adjacentStepGcd,
      meanAbsoluteRgbDifference: totalDifference / (raster.width * raster.height * 3),
    });
  }
  return {
    method:
      "Descriptive stress run on this one image. JPEG uses sharp/libvips, then each image is decoded back to RGBA8. Pixel probes use green channel. No ground-truth labels or manipulation confidence are inferred.",
    dimensions: { width: source.width, height: source.height },
    center,
    variants,
  };
}
