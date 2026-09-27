import { readFile } from "node:fs/promises";
import { Context } from "@contentauth/c2pa-utilities";
import { initSync, WasmReader } from "@contentauth/c2pa-wasm";
import { summarizeManifest, type CredentialReport } from "../src/lib/engine/credentials";

let initialization: Promise<void> | null = null;
function ready() {
  initialization ??= (async () => {
    const bytes = await readFile(new URL(import.meta.resolve("@contentauth/c2pa-wasm/c2pa.wasm")));
    initSync({ module: bytes });
  })().catch((error: unknown) => {
    initialization = null;
    throw error;
  });
  return initialization;
}

/** Validate original asset bytes in Node using the same c2pa-rs WASM core as the browser SDK. */
export async function inspectCredentialsNode(
  bytes: Uint8Array,
  format: string,
): Promise<CredentialReport> {
  if (format === "bmp")
    return {
      ...summarizeManifest(null),
      state: "unsupported",
      note: "BMP is not supported by this C2PA verifier; no credential conclusion was reached.",
    };
  await ready();
  const mime = format === "jpeg" ? "image/jpeg" : `image/${format}`;
  const context = await new Context({ verify: { verifyTrust: true } }).toJson();
  let reader: WasmReader;
  try {
    reader = await WasmReader.fromBytes(mime, bytes, context);
  } catch (error) {
    const message = String(error);
    if (message === "C2pa(JumbfNotFound)") return summarizeManifest(null);
    if (message === "C2pa(UnsupportedType)")
      return {
        ...summarizeManifest(null),
        state: "unsupported",
        note: "This file type is unsupported by the C2PA verifier.",
      };
    throw new Error(`Credential validation failed: ${message}`);
  }
  try {
    return summarizeManifest(reader.manifestStore());
  } finally {
    reader.free();
  }
}
