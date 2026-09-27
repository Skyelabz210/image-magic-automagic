import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { inspectCredentialsNode } from "../cli/credentials";
import { inspectJpeg } from "../src/lib/engine/jpeg";

const file = "tests/fixtures/c2pa-adobe-20220124-C.jpg";

test("official signed fixture verifies, byte tampering fails, unsigned is absent", async () => {
  const original = await readFile(file);
  assert.equal(
    createHash("sha256").update(original).digest("hex"),
    "75a8da33f6eaf1e16bf3b42cd78913b22b2e6a671fda217a508b1ba4230ce864",
  );
  const report = await inspectCredentialsNode(original, "jpeg");
  assert.equal(report.state, "valid");
  assert.equal(report.signer, "C2PA Signer");
  assert.ok(report.statusCodes.includes("signingCredential.untrusted"));
  assert.deepEqual(report.actions, ["c2pa.created", "c2pa.drawing"]);

  const tampered = Buffer.from(original);
  tampered[tampered.length - 10] ^= 1;
  const bad = await inspectCredentialsNode(tampered, "jpeg");
  assert.equal(bad.state, "invalid");
  assert.ok(bad.statusCodes.includes("assertion.dataHash.mismatch"));

  const unsigned = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "#ffffff" },
  })
    .jpeg()
    .toBuffer();
  assert.equal((await inspectCredentialsNode(unsigned, "jpeg")).state, "absent");
  assert.equal((await inspectCredentialsNode(Buffer.from("BM"), "bmp")).state, "unsupported");
});

test("CLI inspect --credentials reports the original signed file", () => {
  const output = JSON.parse(
    execFileSync(
      process.execPath,
      ["--import", "tsx", "cli/index.ts", "inspect", file, "--credentials"],
      { encoding: "utf8" },
    ),
  );
  assert.equal(output.credentials.state, "valid");
  assert.equal(output.width, 2048);
  assert.equal(
    output.fileSha256,
    "75a8da33f6eaf1e16bf3b42cd78913b22b2e6a671fda217a508b1ba4230ce864",
  );
});

test("real signed JPEG exposes APP11 JUMBF as structure, separate from credential validity", async () => {
  const structure = inspectJpeg(await readFile(file));
  assert.equal(structure.complete, true);
  assert.equal(structure.metadata.jumbfApp11, true);
  assert.equal(structure.metadata.jfif, true);
  assert.equal(structure.quantizationTables.length, 2);
});
