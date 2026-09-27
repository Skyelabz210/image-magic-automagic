import type { ManifestStore } from "@contentauth/c2pa-types";

export type CredentialReport = {
  state: "absent" | "invalid" | "valid" | "trusted" | "unresolved" | "unsupported";
  activeLabel: string | null;
  title: string | null;
  signer: string | null;
  issuer: string | null;
  ingredients: string[];
  statusCodes: string[];
  note: string;
};

/** Interpret SDK validation state without promoting a missing state to valid. */
export function summarizeManifest(store: ManifestStore | null): CredentialReport {
  if (!store)
    return {
      state: "absent",
      activeLabel: null,
      title: null,
      signer: null,
      issuer: null,
      ingredients: [],
      statusCodes: [],
      note: "No embedded C2PA manifest was found in the original file.",
    };
  const activeLabel = store.active_manifest ?? null;
  const active = activeLabel ? store.manifests?.[activeLabel] : undefined;
  const activeCodes = store.validation_results?.activeManifest;
  const statusCodes = [
    ...new Set(
      [
        ...(store.validation_status ?? []),
        ...(activeCodes?.failure ?? []),
        ...(activeCodes?.informational ?? []),
        ...(activeCodes?.success ?? []),
      ].map((status) => status.code),
    ),
  ];
  const state =
    store.validation_state === "Trusted"
      ? "trusted"
      : store.validation_state === "Valid"
        ? "valid"
        : store.validation_state === "Invalid"
          ? "invalid"
          : "unresolved";
  return {
    state,
    activeLabel,
    title: active?.title ?? null,
    signer: active?.signature_info?.common_name ?? null,
    issuer: active?.signature_info?.issuer ?? null,
    ingredients: (active?.ingredients ?? []).map((item) => item.title ?? "Untitled ingredient"),
    statusCodes,
    note:
      state === "trusted"
        ? "Manifest validated and signer trusted by the SDK trust configuration."
        : state === "valid"
          ? "Manifest validated; signer trust was not established."
          : state === "invalid"
            ? "Manifest validation failed; inspect status codes."
            : "A manifest was found, but validation did not return a definitive state.",
  };
}

/** Loads the relatively large SDK only after an explicit user request. */
export async function inspectCredentials(blob: Blob): Promise<CredentialReport> {
  if (/^image\/(?:bmp|x-ms-bmp)$/i.test(blob.type))
    return {
      ...summarizeManifest(null),
      state: "unsupported",
      note: "BMP is not supported by this C2PA verifier; no credential conclusion was reached.",
    };
  const [{ createC2pa, Reader, Context }, { default: wasmSrc }] = await Promise.all([
    import("@contentauth/c2pa-web"),
    import("@contentauth/c2pa-web/resources/c2pa.wasm?url"),
  ]);
  const c2pa = await createC2pa({ wasmSrc });
  const reader = await Reader.fromBlob(
    c2pa,
    blob.type || undefined,
    blob,
    new Context({ verify: { verifyTrust: true } }),
  );
  if (!reader) return summarizeManifest(null);
  try {
    return summarizeManifest(await reader.manifestStore());
  } finally {
    await reader.free();
  }
}
