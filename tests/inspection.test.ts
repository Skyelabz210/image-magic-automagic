import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { inspectJpeg } from "../src/lib/engine/jpeg";
import { inspectCredentials, summarizeManifest } from "../src/lib/engine/credentials";

test("original-byte JPEG DQT parser reads real encodings and safely reports truncation", async () => {
  const jpg = await sharp({ create: { width: 32, height: 24, channels: 3, background: "#c86939" } })
    .jpeg({ quality: 65 })
    .toBuffer();
  const structure = inspectJpeg(jpg);
  assert.deepEqual([structure.width, structure.height, structure.complete], [32, 24, true]);
  assert.ok(structure.scans > 0);
  assert.ok(structure.quantizationTables.length > 0);
  assert.ok(
    structure.quantizationTables.every(
      (t) => t.zigzag.length === 64 && t.zigzag.every((v) => v > 0),
    ),
  );
  const dqt = structure.quantizationTables[0]!;
  assert.equal(dqt.precision, 8);
  assert.equal(
    structure.markers.some((m) => m.name === "DQT"),
    true,
  );
  assert.equal(inspectJpeg(jpg.subarray(0, dqt.offset + 5)).complete, false);
  assert.match(inspectJpeg(jpg.subarray(0, dqt.offset + 5)).warnings.join(" "), /truncated|EOI/i);
  assert.throws(() => inspectJpeg(new Uint8Array([1, 2, 3, 4])), /SOI/);
});

test("JPEG parser handles 16-bit DQT values and stuffed scan bytes", () => {
  const values = Array.from({ length: 64 }, (_, i) => [
    Math.floor((i + 300) / 256),
    (i + 300) % 256,
  ]).flat();
  const stream = Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xdb,
    0,
    131,
    0x10,
    ...values,
    0xff,
    0xc0,
    0,
    11,
    8,
    0,
    1,
    0,
    1,
    1,
    1,
    0x11,
    0,
    0xff,
    0xda,
    0,
    8,
    1,
    1,
    0,
    0,
    63,
    0,
    12,
    0xff,
    0,
    13,
    0xff,
    0xd9,
  ]);
  const report = inspectJpeg(stream);
  assert.equal(report.complete, true);
  assert.equal(report.scans, 1);
  assert.equal(report.quantizationTables[0]?.precision, 16);
  assert.deepEqual(
    [report.quantizationTables[0]?.zigzag[0], report.quantizationTables[0]?.zigzag[63]],
    [300, 363],
  );
});

test("manifest summary distinguishes absent, invalid, valid, trusted and unknown", async () => {
  assert.equal(summarizeManifest(null).state, "absent");
  const report = summarizeManifest({
    active_manifest: "a",
    validation_state: "Valid",
    manifests: {
      a: {
        title: "example",
        signature_info: { common_name: "signer" },
        ingredients: [{ title: "source" }],
      },
    },
  });
  assert.deepEqual(
    [report.state, report.signer, report.ingredients[0]],
    ["valid", "signer", "source"],
  );
  assert.equal(summarizeManifest({ validation_state: "Invalid" }).state, "invalid");
  assert.equal(summarizeManifest({ validation_state: "Trusted" }).state, "trusted");
  assert.equal(summarizeManifest({}).state, "unresolved");
  assert.equal(
    (await inspectCredentials(new Blob(["BM"], { type: "image/bmp" }))).state,
    "unsupported",
  );
});

test("stress report keeps original dimensions and reports measurable perturbations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "enhance-stress-"));
  try {
    const path = join(dir, "sample.jpg");
    const values = Buffer.alloc(32 * 32 * 3);
    for (let i = 0; i < values.length; i++) values[i] = (i * 37 + Math.floor(i / 33) * 9) % 256;
    await writeFile(
      path,
      await sharp(values, { raw: { width: 32, height: 32, channels: 3 } })
        .jpeg({ quality: 95 })
        .toBuffer(),
    );
    const json = execFileSync(
      process.execPath,
      ["--import", "tsx", "cli/index.ts", "stress", path],
      { encoding: "utf8" },
    );
    const report = JSON.parse(json).reliability;
    assert.equal(report.variants.length, 6);
    assert.deepEqual(report.dimensions, { width: 32, height: 32 });
    assert.equal(report.variants[0].meanAbsoluteRgbDifference, 0);
    assert.ok(report.variants[2].meanAbsoluteRgbDifference > 0);
    const structure = JSON.parse(
      execFileSync(process.execPath, ["--import", "tsx", "cli/index.ts", "jpeg-structure", path], {
        encoding: "utf8",
      }),
    );
    assert.equal(structure.structure.complete, true);
    const broken = join(dir, "broken.jpg");
    await writeFile(broken, Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0, 130, 0]));
    const partial = JSON.parse(
      execFileSync(
        process.execPath,
        ["--import", "tsx", "cli/index.ts", "jpeg-structure", broken],
        { encoding: "utf8" },
      ),
    );
    assert.equal(partial.structure.complete, false);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("CLI mask-region measures only selected pixels and binds the mask hash", async () => {
  const dir = await mkdtemp(join(tmpdir(), "enhance-mask-"));
  try {
    const input = join(dir, "source.png"),
      mask = join(dir, "mask.png");
    await writeFile(
      input,
      await sharp(
        Buffer.from([10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255, 40, 40, 40, 255]),
        { raw: { width: 2, height: 2, channels: 4 } },
      )
        .png()
        .toBuffer(),
    );
    await writeFile(
      mask,
      await sharp(Buffer.from([255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]), {
        raw: { width: 2, height: 2, channels: 4 },
      })
        .png()
        .toBuffer(),
    );
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        ["--import", "tsx", "cli/index.ts", "mask-region", input, "--mask", mask],
        { encoding: "utf8" },
      ),
    );
    assert.equal(result.measurements.opaquePixels, 1);
    assert.equal(result.measurements.channels[0].mean, 10);
    assert.equal(result.mask.fileSha256.length, 64);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
