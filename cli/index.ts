#!/usr/bin/env node
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import sharp from "sharp";
import {
  autoTune,
  enhance,
  probe,
  validateDimensions,
  MAX_FILE_BYTES,
  type Channel,
  type ProbeType,
  type Raster,
} from "../src/lib/engine/processing";
import {
  applyTool,
  applyRecipe,
  RECIPES,
  TOOL_NAMES,
  type ToolName,
  type ToolOptions,
} from "../src/lib/engine/tools";
import { rasterDigest, sha256 } from "../src/lib/engine/provenance";
import { requestSuggestion } from "../src/lib/ai-providers.server";
import { measureRegion } from "../src/lib/engine/region";
import { inspectJpeg } from "../src/lib/engine/jpeg";
import { stressReport } from "./reliability";
import { inspectCredentialsNode } from "./credentials";

const HELP = `ENHANCE! CLI — local pixel operations; AI is opt-in
Usage: npm run cli -- COMMAND INPUT [INPUT...] [options]
Commands: inspect, credentials, jpeg-structure, stress, region, mask-region, tune, enhance, probe, pipeline, tool, recipe, batch, suggest
Options:
  --output PATH        PNG path; report JSON path for stress; directory for batch
  --threshold N        Enhancement threshold, 0–6.3
  --strength N         Enhancement strength, 1–3
  --probe NAME         keld | lane | quantization
                      quantization measures decoded pixel-step GCD, not JPEG DCT/DQT
  --channel NAME       red | green | blue (default green)
  --tool NAME          ${TOOL_NAMES.join(" | ")}
  --recipe NAME        ${Object.keys(RECIPES).join(" | ")}
  --steps LIST         Ordered tool[:amount] steps, e.g. median,contrast:20,edges
  --amount N           Integer for brightness (-255..255), contrast (0..100), threshold (0..255)
                      manuscript reading strength (0..100; default 100)
  --ai-provider NAME   gemini | lovable (suggest only; default gemini)
  --region X,Y,W,H     Native pixel rectangle for the region command
  --mask PATH          Exact-size white-on-black or transparent segmentation mask (mask-region)
  --credentials        Also validate original bytes during inspect
  --help               Show this help
Examples:
  npm run cli -- inspect photo.jpg
  npm run cli -- region photo.jpg --region 120,80,64,64
  npm run cli -- mask-region photo.jpg --mask segment.png
  npm run cli -- jpeg-structure photo.jpg
  npm run cli -- credentials photo.jpg
  npm run cli -- inspect photo.jpg --credentials
  npm run cli -- stress photo.jpg --output stress.json
  npm run cli -- pipeline photo.jpg --output result.png
  npm run cli -- batch a.jpg b.png --output ./results
  npm run cli -- tool photo.jpg --tool median --output denoised.png
  npm run cli -- tool codex-page.jpg --tool manuscript --amount 100 --output reading.png
  npm run cli -- recipe codex-page.jpg --recipe ink-fade-recovery --output faded-ink.png
  GEMINI_API_KEY=... npm run cli -- suggest photo.jpg
`;

type Options = { [key: string]: string };
function parse(argv: string[]) {
  const [command, ...rest] = argv;
  const inputs: string[] = [],
    options: Options = {};
  const allowed = new Set([
    "output",
    "threshold",
    "strength",
    "probe",
    "channel",
    "tool",
    "recipe",
    "steps",
    "amount",
    "ai-provider",
    "region",
    "mask",
    "credentials",
  ]);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--help") return { command: "help", inputs, options };
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (key === "credentials") {
        options.credentials = "true";
        continue;
      }
      const value = rest[++i];
      if (!allowed.has(key) || !value || value.startsWith("--"))
        throw new Error(`Invalid option: ${arg}`);
      options[key] = value;
    } else inputs.push(arg);
  }
  return { command, inputs, options };
}
function numeric(value: string | undefined, fallback: number, min: number, max: number) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(n) || n < min || n > max)
    throw new Error(`Use a number between ${min} and ${max}.`);
  return n;
}
function select<T extends string>(
  value: string | undefined,
  choices: readonly T[],
  fallback: T,
): T {
  const selected = value ?? fallback;
  if (!choices.includes(selected as T)) throw new Error(`Choose one of: ${choices.join(", ")}.`);
  return selected as T;
}
const CHANNELS = ["red", "green", "blue"] as const;
const PROBES = ["keld", "lane", "quantization"] as const;
function channel(options: Options): Channel {
  return CHANNELS.indexOf(select(options.channel, CHANNELS, "green")) as Channel;
}

async function readBounded(path: string) {
  const info = await stat(path);
  if (!info.isFile() || !info.size || info.size > MAX_FILE_BYTES)
    throw new Error("Input must be nonempty and at most 50 MB.");
  const bytes = await readFile(path);
  if (!bytes.length || bytes.length > MAX_FILE_BYTES)
    throw new Error("Input must be nonempty and at most 50 MB.");
  return bytes;
}
async function load(path: string) {
  const file = await readBounded(path);
  const image = sharp(file, { limitInputPixels: 16_000_000, failOn: "error" })
    .rotate()
    .toColourspace("srgb")
    .ensureAlpha();
  const metadata = await image.metadata();
  if (!["jpeg", "png", "webp", "bmp"].includes(metadata.format))
    throw new Error("Choose a PNG, JPEG, WebP, or BMP image.");
  validateDimensions(
    metadata.autoOrient?.width ?? metadata.width!,
    metadata.autoOrient?.height ?? metadata.height!,
  );
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  validateDimensions(info.width, info.height);
  const raster: Raster = {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data),
  };
  return { raster, bytes: file, format: metadata.format, fileSha256: await sha256(file) };
}
async function png(raster: Raster, path: string) {
  const bytes = await sharp(Buffer.from(raster.data), {
    raw: { width: raster.width, height: raster.height, channels: 4 },
  })
    .png()
    .toBuffer();
  await writeFile(path, bytes);
  return await sha256(bytes);
}
async function run(command: string, path: string, options: Options) {
  if (command === "jpeg-structure") {
    const original = await readBounded(path);
    const structure = inspectJpeg(original);
    return {
      command,
      input: path,
      fileSha256: await sha256(original),
      width: structure.width,
      height: structure.height,
      structure,
    };
  }
  const { raster, bytes, format, fileSha256 } = await load(path);
  const record: Record<string, unknown> = {
    command,
    input: path,
    width: raster.width,
    height: raster.height,
    fileSha256,
    rasterSha256: await rasterDigest(raster),
  };
  if (command === "credentials") {
    record.credentials = await inspectCredentialsNode(bytes, format!);
    return record;
  }
  if (command === "inspect") {
    if (options.credentials) record.credentials = await inspectCredentialsNode(bytes, format!);
    record.channels = ["red", "green", "blue"].map((label, c) => {
      let min = 255,
        max = 0,
        total = 0,
        visible = 0;
      for (let i = 0; i < raster.data.length; i += 4)
        if (raster.data[i + 3] === 255) {
          const v = raster.data[i + c]!;
          min = Math.min(min, v);
          max = Math.max(max, v);
          total += v;
          visible++;
        }
      return {
        label,
        min: visible ? min : null,
        max: visible ? max : null,
        mean: visible ? total / visible : null,
      };
    });
    return record;
  }
  if (command === "stress") {
    record.reliability = await stressReport(raster);
    if (options.output) {
      if (resolve(options.output) === resolve(path))
        throw new Error("Output must differ from the input image.");
      record.output = options.output;
      await writeFile(options.output, `${JSON.stringify(record, null, 2)}\n`);
    }
    return record;
  }
  if (command === "tune") {
    record.tune = autoTune(raster);
    return record;
  }
  if (command === "region") {
    const fields = (options.region ?? "").split(",");
    if (fields.length !== 4 || fields.some((v) => !/^\d+$/.test(v)))
      throw new Error("Use --region X,Y,W,H with positive integer dimensions.");
    const [x, y, width, height] = fields.map(Number);
    record.measurements = measureRegion(raster, { x: x!, y: y!, width: width!, height: height! });
    return record;
  }
  if (command === "mask-region") {
    if (!options.mask) throw new Error("--mask PATH is required for mask-region.");
    const mask = await load(options.mask);
    record.mask = { path: options.mask, fileSha256: mask.fileSha256, threshold: 128 };
    record.measurements = measureRegion(
      raster,
      {
        x: 0,
        y: 0,
        width: raster.width,
        height: raster.height,
      },
      mask.raster,
    );
    return record;
  }
  if (command === "suggest") {
    const provider = select(options["ai-provider"], ["gemini", "lovable"] as const, "gemini");
    const preview = await sharp(bytes)
      .rotate()
      .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    record.provider = provider;
    record.suggestion = await requestSuggestion({
      provider,
      image: `data:image/jpeg;base64,${preview.toString("base64")}`,
      metrics: { width: raster.width, height: raster.height },
    });
    return record;
  }
  const output = options.output;
  if (!output) throw new Error(`--output PATH is required for ${command}.`);
  if (resolve(output) === resolve(path))
    throw new Error("Output must differ from the input image.");
  let result: Raster;
  if (command === "tool") {
    const name = select(options.tool, TOOL_NAMES, "grayscale") as ToolName;
    const amount = numeric(
      options.amount,
      name === "threshold" ? 128 : name === "manuscript" ? 100 : 0,
      name === "brightness" ? -255 : 0,
      name === "contrast" || name === "manuscript" ? 100 : 255,
    );
    if (!Number.isInteger(amount)) throw new Error("Tool amount must be an integer.");
    result = applyTool(raster, { name, amount, channel: channel(options) });
    record.tool = { name, amount, channel: CHANNELS[channel(options)] };
  } else if (command === "recipe") {
    if (!!options.steps === !!options.recipe)
      throw new Error("Choose exactly one of --recipe NAME or --steps LIST.");
    const steps: ToolOptions[] = options.recipe
      ? (RECIPES[options.recipe]?.steps ??
        (() => {
          throw new Error(`Choose a recipe: ${Object.keys(RECIPES).join(", ")}.`);
        })())
      : options.steps!.split(",").map((part) => {
          const [tool, raw, ...extra] = part.split(":");
          if (!tool || extra.length) throw new Error("Use --steps tool[:amount],tool[:amount].");
          const name = select(tool, TOOL_NAMES, "grayscale");
          const amount = raw === undefined ? undefined : Number(raw);
          if (raw !== undefined && (!Number.isInteger(amount) || !Number.isFinite(amount)))
            throw new Error("Step amounts must be integers.");
          return { name, ...(amount !== undefined ? { amount } : {}), channel: channel(options) };
        });
    result = applyRecipe(raster, steps);
    record.recipe = { preset: options.recipe ?? null, steps };
  } else if (command === "probe") {
    const kind: ProbeType = select(options.probe, PROBES, "keld");
    const analysis = probe(raster, kind, channel(options));
    result = analysis.map;
    record.probe = {
      type: kind,
      channel: CHANNELS[channel(options)],
      count: analysis.count,
      metrics: analysis.metrics,
      summary: analysis.summary,
    };
  } else if (command === "enhance" || command === "pipeline") {
    const tune = command === "pipeline" ? autoTune(raster) : null;
    const threshold = numeric(options.threshold, tune?.threshold ?? 3.5, 0, 6.3);
    const strength = numeric(options.strength, tune?.strength ?? 1.8, 1, 3);
    const analysis = enhance(raster, threshold, strength);
    result = analysis.enhanced;
    record.enhancement = {
      threshold,
      strength,
      meanEntropy: analysis.meanEntropy,
      activePercent: analysis.activePercent,
      clippedPixels: analysis.clippedPixels,
    };
    if (tune) {
      record.tune = tune;
      record.probes = Object.fromEntries(
        PROBES.map((p) => [p, probe(raster, p, channel(options)).count]),
      );
    }
  } else throw new Error(`Unknown command: ${command}.`);
  record.output = output;
  record.outputSha256 = await png(result, output);
  return record;
}

async function main() {
  const { command, inputs, options } = parse(process.argv.slice(2));
  if (!command || command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (
    ![
      "inspect",
      "credentials",
      "jpeg-structure",
      "stress",
      "region",
      "mask-region",
      "tune",
      "enhance",
      "probe",
      "pipeline",
      "tool",
      "recipe",
      "batch",
      "suggest",
    ].includes(command)
  )
    throw new Error(`Unknown command: ${command}.`);
  if (!inputs.length || (command !== "batch" && inputs.length !== 1))
    throw new Error("Provide one input image (or multiple for batch).");
  if (options.credentials && command !== "inspect" && command !== "credentials")
    throw new Error("--credentials is only supported with inspect or credentials.");
  if (command === "batch") {
    const directory = options.output;
    if (!directory) throw new Error("--output DIRECTORY is required for batch.");
    await mkdir(directory, { recursive: true });
    if (!(await stat(directory)).isDirectory())
      throw new Error("Batch output must be a directory.");
    const items = [];
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i]!;
      const name = basename(input, extname(input)).replace(/[^a-zA-Z0-9_-]+/g, "_") || "image";
      const output = join(resolve(directory), `${String(i + 1).padStart(3, "0")}-${name}.png`);
      try {
        items.push(await run("pipeline", input, { ...options, output }));
      } catch (error) {
        items.push({ input, error: error instanceof Error ? error.message : "Processing failed." });
      }
    }
    process.stdout.write(`${JSON.stringify({ command, items }, null, 2)}\n`);
    if (items.some((x) => "error" in x)) process.exitCode = 1;
  } else
    process.stdout.write(`${JSON.stringify(await run(command, inputs[0]!, options), null, 2)}\n`);
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unexpected error.");
  process.exitCode = 1;
});
