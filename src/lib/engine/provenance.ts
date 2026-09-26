import type { Raster } from "./processing";

export const RECEIPT_KEY = "enhance-session-ledger-v2";
export const LEGACY_RECEIPT_KEY = "enhance-session-ledger";
export type Parameters = Record<string, string | number | boolean>;
export type LedgerEntry = {
  id: string;
  sequence: number;
  operation: string;
  parameters: Parameters;
  timestamp: string;
  previous: string;
  chain: string;
};
export const GENESIS = "ENHANCE-SHA256-V2";

export async function sha256(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new Error(
      "Secure hashing requires HTTPS or localhost. Open the app in a secure context.",
    );
  const buffer =
    bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}

export const hashText = (text: string) =>
  sha256(new TextEncoder().encode(text));

export async function rasterDigest(raster: Raster) {
  return hashText(
    JSON.stringify({
      format: "decoded-srgb-rgba8",
      width: raster.width,
      height: raster.height,
      pixels: await sha256(
        new Uint8Array(
          raster.data.buffer,
          raster.data.byteOffset,
          raster.data.byteLength,
        ),
      ),
    }),
  );
}

function canonical(entry: Omit<LedgerEntry, "chain">) {
  return JSON.stringify({
    id: entry.id,
    sequence: entry.sequence,
    operation: entry.operation,
    parameters: Object.fromEntries(
      Object.entries(entry.parameters).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    ),
    timestamp: entry.timestamp,
    previous: entry.previous,
  });
}

export async function addEntry(
  entries: LedgerEntry[],
  operation: string,
  parameters: Parameters,
) {
  const entry = {
    id: crypto.randomUUID(),
    sequence: entries.length + 1,
    operation,
    parameters: { ...parameters },
    timestamp: new Date().toISOString(),
    previous: entries.at(-1)?.chain ?? GENESIS,
  };
  return [...entries, { ...entry, chain: await hashText(canonical(entry)) }];
}

export async function verifyLedger(value: unknown): Promise<LedgerEntry[]> {
  if (!Array.isArray(value))
    throw new Error("Stored receipt data must be an array.");
  let previous = GENESIS;
  const ids = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const e = value[i] as LedgerEntry | null;
    if (
      !e ||
      typeof e.id !== "string" ||
      ids.has(e.id) ||
      e.sequence !== i + 1 ||
      typeof e.operation !== "string" ||
      typeof e.timestamp !== "string" ||
      !Number.isFinite(Date.parse(e.timestamp)) ||
      !e.parameters ||
      typeof e.parameters !== "object" ||
      Array.isArray(e.parameters) ||
      !Object.values(e.parameters).every(
        (v) =>
          typeof v === "string" ||
          typeof v === "boolean" ||
          (typeof v === "number" && Number.isFinite(v)),
      ) ||
      e.previous !== previous ||
      typeof e.chain !== "string" ||
      e.chain !== (await hashText(canonical(e)))
    ) {
      throw new Error(
        `Receipt verification failed at operation ${i + 1}. The stored data has been preserved.`,
      );
    }
    ids.add(e.id);
    previous = e.chain;
  }
  return value as LedgerEntry[];
}

export function readSetting(
  storage: Pick<Storage, "getItem">,
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  try {
    const raw = storage.getItem(key);
    if (raw === null || raw.trim() === "") return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= min && value <= max
      ? value
      : fallback;
  } catch {
    return fallback;
  }
}
