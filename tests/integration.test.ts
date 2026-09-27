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
