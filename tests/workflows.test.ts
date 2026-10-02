import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { applyRecipe, applyTool, RECIPES } from "../src/lib/engine/tools";
import { makeSelectionMask, measureRegion } from "../src/lib/engine/region";
import { auditHtml } from "../src/lib/engine/report";
import { addEntry, verifyLedger } from "../src/lib/engine/provenance";
import { archiveBlobs } from "../src/lib/engine/archive";
import { unzipSync } from "fflate";

test("streamed ZIP retains the CSV, PNG bytes and safe entry names", async () => {
  const blob = await archiveBlobs([
    { name: "manifest.csv", blob: new Blob(['file,hash\r\n"page",abc\r\n']) },
    { name: "001-page/enhanced.png", blob: new Blob([Uint8Array.of(137, 80, 78, 71)]) },
  ]);
  const contents = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  assert.match(new TextDecoder().decode(contents["manifest.csv"]), /page/);
  assert.deepEqual([...contents["001-page/enhanced.png"]!], [137, 80, 78, 71]);
  await assert.rejects(() => archiveBlobs([{ name: "../bad", blob: new Blob([]) }]), /safe/);
});

test("polygon and brush masks select exact native pixels and produce honest histograms", () => {
  const width = 12,
    height = 12;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) data.set([p % 256, 70, 90, 255], p * 4);
  const source = { width, height, data };
  const triangle = makeSelectionMask(
    width,
    height,
    [
      { x: 1, y: 1 },
      { x: 9, y: 1 },
      { x: 1, y: 9 },
    ],
    "polygon",
  );
  const result = measureRegion(source, triangle.region, triangle.mask);
  assert.ok(result.opaquePixels > 15 && result.opaquePixels < 45);
  assert.equal(
    result.histograms[0].reduce((a, b) => a + b, 0),
    result.opaquePixels,
  );
  assert.equal(
    result.histograms[3].reduce((a, b) => a + b, 0),
    result.opaquePixels,
  );
  assert.equal(result.localEntropy.length, 64);
  const brush = makeSelectionMask(
    width,
    height,
    [
      { x: 2, y: 5 },
      { x: 9, y: 5 },
    ],
    "brush",
    1,
  );
  const painted = measureRegion(source, brush.region, brush.mask);
  assert.ok(painted.opaquePixels >= 8);
  assert.equal(source.data[3], 255);
  assert.throws(() => makeSelectionMask(width, height, [{ x: 99, y: 1 }], "brush"), /within/);
});

test("recipe stack is ordered, bounded, alpha preserving and identical to CLI output", async () => {
  const width = 24,
    height = 24;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++)
    data.set([p % 211, (p * 7) % 200, 90, p === 0 ? 0 : 255], p * 4);
  const source = { width, height, data };
  const steps = RECIPES["denoise-edges"]!.steps;
  const result = applyRecipe(source, steps);
  const sequential = steps.reduce((raster, step) => applyTool(raster, step), source);
  assert.deepEqual(result.data, sequential.data);
  assert.deepEqual(Array.from(result.data.slice(0, 4)), Array.from(data.slice(0, 4)));
  assert.notDeepEqual(result.data, data);
  assert.throws(() => applyRecipe(source, []), /1–12/);
  const dir = await mkdtemp(join(tmpdir(), "enhance-recipe-"));
  try {
    const input = join(dir, "source.png"),
      output = join(dir, "output.png");
    await writeFile(
      input,
      await sharp(Buffer.from(data), { raw: { width, height, channels: 4 } })
        .png()
        .toBuffer(),
    );
    const report = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "cli/index.ts",
          "recipe",
          input,
          "--steps",
          "median,contrast:20,edges",
          "--output",
          output,
        ],
        { encoding: "utf8" },
      ),
    );
    assert.equal(report.recipe.steps.length, 3);
    assert.equal(report.outputSha256.length, 64);
    assert.ok((await readFile(output)).length > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("printable audit escapes untrusted names and reflects ledger verification", async () => {
  const ledger = await addEntry([], "import", { file: "<script>alert(1)</script>" });
  await verifyLedger(ledger);
  const html = auditHtml({
    source: {
      name: "<script>alert(1)</script>",
      fileHash: "a".repeat(64),
      rasterHash: "b".repeat(64),
      width: 2,
      height: 2,
    },
    ledger,
    verified: true,
    regions: [],
    exportedAt: "2026-10-02T00:00:00.000Z",
  });
  assert.match(html, /Hash chain verified at export/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, new RegExp(ledger[0]!.chain));
  await assert.rejects(() => verifyLedger([{ ...ledger[0]!, operation: "tampered" }]), /failed/);
});
