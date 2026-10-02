import type { LedgerEntry } from "./provenance";
import type { RegionMeasurements } from "./region";

const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
export type AuditInput = {
  source: {
    name: string;
    fileHash: string;
    rasterHash: string;
    width: number;
    height: number;
  } | null;
  originalPreview?: string | undefined;
  derivedPreview?: string | undefined;
  outputHash?: string | undefined;
  ledger: LedgerEntry[];
  verified: boolean;
  regions: { name: string; metrics: RegionMeasurements }[];
  exportedAt: string;
};

/** Printable, self-contained HTML; image previews are derived and never evidence bytes. */
export function auditHtml(input: AuditInput): string {
  const { source, ledger, regions } = input;
  const images = [input.originalPreview, input.derivedPreview]
    .map((url, index) =>
      url
        ? `<figure><img src="${escape(url)}" alt="${index ? "Derived" : "Original"} preview"><figcaption>${index ? "Derived preview" : "Original preview"}</figcaption></figure>`
        : "",
    )
    .join("");
  const rows = ledger
    .map(
      (entry) =>
        `<tr><td>${entry.sequence}</td><td>${escape(entry.timestamp)}</td><td>${escape(entry.operation)}</td><td><code>${escape(JSON.stringify(entry.parameters))}</code></td><td><code>${escape(entry.previous)}</code></td><td><code>${escape(entry.chain)}</code></td><td>${input.verified ? "✓ verified" : "unverified"}</td></tr>`,
    )
    .join("");
  const regionRows = regions
    .map(
      ({ name, metrics }) =>
        `<tr><td>${escape(name)}</td><td>${metrics.region.x}, ${metrics.region.y}, ${metrics.region.width} × ${metrics.region.height}</td><td>${metrics.opaquePixels}</td><td>${metrics.channels.map((channel) => channel.entropy?.toFixed(3) ?? "—").join(" / ")}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ENHANCE! forensic audit</title><style>
  :root{font-family:system-ui,sans-serif;color:#162334;background:#f5f7f9}body{max-width:1100px;margin:2rem auto;padding:0 1.5rem}h1{color:#174776}header,.card{background:white;border:1px solid #d6dce3;border-radius:8px;padding:1rem;margin:1rem 0}small,.muted{color:#526273}.badge{display:inline-block;padding:.3rem .6rem;border-radius:4px;background:${input.verified ? "#d8f1e4" : "#ffdedb"};color:${input.verified ? "#17633e" : "#9c291c"};font-weight:700}.images{display:flex;gap:1rem;flex-wrap:wrap}figure{margin:0;flex:1;min-width:230px}img{max-width:100%;max-height:360px;object-fit:contain;border:1px solid #ddd}figcaption{font-size:.8rem;color:#526273}table{width:100%;border-collapse:collapse;font-size:.8rem}th,td{padding:.45rem;border-bottom:1px solid #d6dce3;text-align:left;vertical-align:top}code{overflow-wrap:anywhere}td:last-child{max-width:240px}section{overflow-x:auto}@media print{body{margin:0;padding:0;background:white}.card,header{break-inside:avoid}tr{break-inside:avoid}}</style></head><body>
  <header><h1>ENHANCE! forensic audit</h1><p>Exported ${escape(input.exportedAt)} · <span class="badge">${input.verified ? "Hash chain verified at export" : "Hash chain FAILED verification"}</span></p><p class="muted">A SHA-256 chain detects alterations to the exported ledger when independently rechecked. It does not authenticate the source, certify findings, or prove a scene is real. The HTML report itself is editable.</p></header>
  <section class="card"><h2>Source and output</h2><p><strong>${escape(source?.name ?? "No active source")}</strong> ${source ? `(${source.width} × ${source.height})` : ""}</p><p>Original file SHA-256: <code>${escape(source?.fileHash ?? "—")}</code><br>Decoded raster SHA-256: <code>${escape(source?.rasterHash ?? "—")}</code><br>Derived PNG SHA-256: <code>${escape(input.outputHash ?? "—")}</code></p><div class="images">${images}</div><small>Previews are reduced visual references; verify the original and exported PNG bytes against their hashes.</small></section>
  <section class="card"><h2>Regional measurements</h2>${regions.length ? `<table><thead><tr><th>Name</th><th>Native coordinates</th><th>Opaque pixels</th><th>RGB entropy (bits)</th></tr></thead><tbody>${regionRows}</tbody></table>` : "<p>No measured regions in this session.</p>"}</section>
  <section class="card"><h2>Operation chain</h2><p>Genesis: <code>ENHANCE-SHA256-V2</code><br>Head: <code>${escape(ledger.at(-1)?.chain ?? "—")}</code></p><table><thead><tr><th>#</th><th>Time (UTC)</th><th>Operation</th><th>Parameters and findings</th><th>Previous</th><th>SHA-256 chain</th><th>Check</th></tr></thead><tbody>${rows}</tbody></table></section><p class="muted">Print this page to PDF from your browser. The JSON receipt contains the machine-readable ledger for independent verification.</p></body></html>`;
}
