import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { applyTool } from "../src/lib/engine/tools";
import { requestSuggestion } from "../src/lib/ai-providers.server";
import { measureRegion } from "../src/lib/engine/region";
import { stressReport } from "../cli/reliability";

test("pixel tools preserve alpha, dimensions and input; median removes a hot pixel", () => {
  const data = new Uint8ClampedArray(3 * 3 * 4);
  for (let p = 0; p < 9; p++) {
    data[p * 4] = p === 4 ? 255 : 0;
    data[p * 4 + 1] = 90;
    data[p * 4 + 2] = 170;
    data[p * 4 + 3] = 255;
  }
  data[3] = 0;
  const src = { width: 3, height: 3, data };
  const out = applyTool(src, { name: "median" });
  assert.equal(out.data[4 * 4], 0);
  assert.deepEqual(Array.from(out.data.slice(4 * 4, 4 * 4 + 3)), [0, 90, 170]);
  assert.equal(out.data[3], 0);
  assert.equal(src.data[4 * 4], 255);
  assert.deepEqual([out.width, out.height], [3, 3]);
  assert.throws(() => applyTool(src, { name: "brightness", amount: 256 }), /integer/);
});

test("manuscript reading lifts uneven paper, separates ink and preserves source pixels", () => {
  const width = 48,
    height = 32;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const paper = 175 + Math.round((x / (width - 1)) * 30);
      data.set([paper, paper - 5, paper - 12, 255], i);
    }
  const black = (16 * width + 16) * 4;
  const red = (16 * width + 32) * 4;
  data.set([70, 65, 62, 255], black);
  data.set([133, 55, 48, 255], red);
  data.set([17, 89, 240, 0], 0);
  const source = { width, height, data };
  const snapshot = new Uint8ClampedArray(data);
  const output = applyTool(source, { name: "manuscript" });
  const paper = (16 * width + 18) * 4;
  assert.ok(output.data[paper]! - output.data[black]! > data[paper]! - data[black]!);
  assert.ok(output.data[red]! > output.data[red + 1]!);
  assert.deepEqual(Array.from(output.data.slice(0, 4)), Array.from(data.slice(0, 4)));
  assert.deepEqual(data, snapshot);
  assert.deepEqual(applyTool(source, { name: "manuscript", amount: 0 }).data, data);
  assert.throws(() => applyTool(source, { name: "manuscript", amount: 101 }), /Manuscript/);
});

test("regional counts use native coordinates and exclude partially transparent samples", () => {
  const data = new Uint8ClampedArray([
    0, 80, 170, 255, 1, 80, 170, 128, 2, 80, 170, 255, 3, 80, 170, 255,
  ]);
  const raster = { width: 2, height: 2, data };
  const row = measureRegion(raster, { x: 0, y: 1, width: 2, height: 1 });
  assert.equal(row.opaquePixels, 2);
  assert.equal(row.channels[0].mean, 2.5);
  assert.equal(row.channels[0].adjacentStepGcd, 1);
  assert.equal(row.channels[0].unitSteps, 1);
  assert.equal(row.channels[1].entropy, 0);
  const whole = measureRegion(raster, { x: 0, y: 0, width: 2, height: 2 });
  assert.equal(whole.excludedPixels, 1);
  assert.throws(() => measureRegion(raster, { x: 1, y: 1, width: 2, height: 2 }), /within/);
});

test("segmentation mask selects exact pixels and rejects mismatched geometry", () => {
  const source = {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([
      10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255, 40, 40, 40, 255,
    ]),
  };
  const mask = {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([
      255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 0, 255, 255, 255, 255,
    ]),
  };
  const measured = measureRegion(source, { x: 0, y: 0, width: 2, height: 2 }, mask);
  assert.equal(measured.opaquePixels, 2);
  assert.equal(measured.channels[0].mean, 25);
  assert.equal(measured.channels[0].adjacentStepGcd, 0);
  assert.throws(
    () =>
      measureRegion(
        source,
        { x: 0, y: 0, width: 2, height: 2 },
        { width: 1, height: 4, data: mask.data },
      ),
    /Mask dimensions/,
  );
});

test("stress differences ignore invisible RGB and expose alpha population shifts", async () => {
  const transparent = {
    width: 4,
    height: 4,
    data: Uint8ClampedArray.from({ length: 64 }, (_, i) => (i % 4 === 3 ? 0 : 255)),
  };
  const report = await stressReport(transparent);
  assert.equal(report.variants[0]?.sourceOpaquePixels, 0);
  assert.equal(report.variants[1]?.comparedOpaquePixels, 0);
  assert.equal(report.variants[1]?.meanAbsoluteRgbDifference, null);
  assert.equal(report.variants[1]?.opacityChangedPixels, 16);
});

test("Gemini sends inline preview and extracts only completed model text", async () => {
  let body: Record<string, unknown> = {};
  const result = await requestSuggestion(
    { provider: "gemini", image: "data:image/jpeg;base64,YWJj", metrics: { width: 3 } },
    {
      env: { GEMINI_API_KEY: "secret" },
      fetch: async (url, init) => {
        assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/interactions");
        assert.equal((init?.headers as Record<string, string>)["x-goog-api-key"], "secret");
        body = JSON.parse(init?.body as string);
        return Response.json({
          status: "completed",
          steps: [
            {
              type: "model_output",
              content: [
                {
                  type: "text",
                  text: '{"threshold":9,"strength":2,"summary":"Check detail","observations":["Edges"]}',
                },
              ],
            },
          ],
        });
      },
    },
  );
  assert.deepEqual(body["input"], [
    { type: "text", text: (body["input"] as { text: string }[])[0]!.text },
    { type: "image", data: "YWJj", mime_type: "image/jpeg" },
  ]);
  assert.equal(body["store"], false);
  assert.equal(result.threshold, 6.3);
  assert.deepEqual(result.observations, ["Edges"]);
  await assert.rejects(
    requestSuggestion(
      { provider: "gemini", image: "data:image/jpeg;base64,YWJj", metrics: {} },
      { env: {} },
    ),
    /server/,
  );
});

test("regional AI answer rejects numerical claims absent from supplied measurements", async () => {
  const metrics = { region1: "Region 1 green mean=42.00, entropy=3.250" };
  const call = (summary: string) =>
    requestSuggestion(
      {
        provider: "gemini",
        image: "data:image/jpeg;base64,YWJj",
        metrics,
        question: "Compare this region",
      },
      {
        env: { GEMINI_API_KEY: "test" },
        fetch: async () =>
          Response.json({
            status: "completed",
            steps: [
              {
                type: "model_output",
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      threshold: null,
                      strength: null,
                      summary,
                      observations: [],
                    }),
                  },
                ],
              },
            ],
          }),
      },
    );
  assert.match((await call("Region 1 has a green mean of 42 and entropy 3.25.")).summary, /42/);
  await assert.rejects(call("Region 1 has a green mean of 99."), /absent/);
});

test("CLI pipeline produces a PNG and measured output hash", async () => {
  const dir = await mkdtemp(join(tmpdir(), "enhance-cli-"));
  try {
    const input = join(dir, "sample.png"),
      output = join(dir, "result.png");
    await writeFile(
      input,
      await sharp({ create: { width: 3, height: 3, channels: 4, background: "#c8c8c8ff" } })
        .png()
        .toBuffer(),
    );
    const raw = execFileSync(
      process.execPath,
      ["--import", "tsx", "cli/index.ts", "pipeline", input, "--output", output],
      { encoding: "utf8" },
    );
    const result = JSON.parse(raw);
    const { width, height } = await sharp(await readFile(output)).metadata();
    assert.equal(result.outputSha256.length, 64);
    assert.deepEqual([width, height], [3, 3]);
    assert.equal(typeof result.probes.keld, "number");
    const region = JSON.parse(
      execFileSync(
        process.execPath,
        ["--import", "tsx", "cli/index.ts", "region", input, "--region", "1,1,1,1"],
        { encoding: "utf8" },
      ),
    );
    assert.equal(region.measurements.opaquePixels, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
