import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Download, FileJson, Play, Square, Trash2, Archive, Table } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dropzone } from "@/components/dropzone";
import { PageTitle, Panel } from "@/components/shell";
import { useWorkspace } from "@/lib/workspace";
import { validateFile, type Channel } from "@/lib/engine/processing";
import { downloadBlob, isAbort, outputName, rasterToBlob, readRaster } from "@/lib/engine/image-io";
import { runFullPipeline } from "@/lib/engine/pipeline";
import { sha256 } from "@/lib/engine/provenance";
import { cn } from "@/lib/utils";
import { openPdf, rasterizePage } from "@/lib/engine/pdf";
import { rasterDigest } from "@/lib/engine/provenance";
import { toast } from "sonner";
import { archiveBlobs } from "@/lib/engine/archive";

export const Route = createFileRoute("/batch")({
  head: () => ({
    meta: [
      { title: "Batch — ENHANCE!" },
      {
        name: "description",
        content:
          "Drop many images and run auto-tune, enhancement, and all forensic probes on each, with a combined receipt.",
      },
      { property: "og:title", content: "Batch — ENHANCE!" },
      {
        property: "og:description",
        content: "Run the full auto-tuned pipeline across many images at once.",
      },
    ],
  }),
  component: BatchPage,
});

type Item = {
  id: string;
  file: File;
  page?: number;
  status: "queued" | "running" | "done" | "error";
  step?: string | undefined;
  error?: string | undefined;
  thumb?: string;
  out?: string;
  blob?: Blob;
  maps?: Record<string, Blob>;
  summary?: {
    threshold: number;
    strength: number;
    meanEntropy: number;
    active: number;
    clipped: number;
    bands: number;
    laneSteps: number;
    flagged: number;
    fileHash: string;
    outHash: string;
    width: number;
    height: number;
    rasterHash: string;
  };
};

function BatchPage() {
  const ws = useWorkspace();
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [channel, setChannel] = useState<Channel>(1);
  const [pdfScale, setPdfScale] = useState(1);
  const abort = useRef<AbortController | null>(null);

  const patch = (id: string, p: Partial<Item>) =>
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const label = (item: Item) =>
    item.page
      ? `${item.file.name.replace(/\.pdf$/i, "")}-page-${String(item.page).padStart(3, "0")}`
      : item.file.name;
  const add = async (files: File[]) => {
    setImporting(true);
    try {
      for (const file of files) {
        if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
          const pdf = await openPdf(file);
          const pages = pdf.numPages;
          await pdf.destroy();
          setItems((xs) => [
            ...xs,
            ...Array.from({ length: pages }, (_, i) => ({
              id: crypto.randomUUID(),
              file,
              page: i + 1,
              status: "queued" as const,
            })),
          ]);
        } else {
          validateFile(file);
          setItems((xs) => [
            ...xs,
            { id: crypto.randomUUID(), file, status: "queued", thumb: URL.createObjectURL(file) },
          ]);
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  const run = async () => {
    const c = new AbortController();
    abort.current = c;
    setRunning(true);
    const documents = new Map<File, Awaited<ReturnType<typeof openPdf>>>();
    const hashes = new Map<File, string>();
    for (const it of items.filter((x) => x.status === "queued" || x.status === "error")) {
      if (c.signal.aborted) break;
      patch(it.id, { status: "running", step: "Decoding", error: undefined });
      try {
        const pdf = it.page ? (documents.get(it.file) ?? (await openPdf(it.file))) : null;
        if (pdf) documents.set(it.file, pdf);
        const raster = pdf
          ? await rasterizePage(pdf, it.page!, c.signal, pdfScale)
          : await readRaster(it.thumb!, c.signal);
        const fileHash = hashes.get(it.file) ?? (await sha256(await it.file.arrayBuffer()));
        hashes.set(it.file, fileHash);
        const r = await runFullPipeline(raster, channel, c.signal, (step) =>
          patch(it.id, { step }),
        );
        const summary = {
          threshold: r.tune.threshold,
          strength: r.tune.strength,
          meanEntropy: r.enhancement.meanEntropy,
          active: r.enhancement.activePercent,
          clipped: r.enhancement.clippedPixels,
          bands: r.probes.keld.count,
          laneSteps: r.probes.lane.count,
          flagged: r.probes.quantization.count,
          fileHash,
          outHash: r.hashes.enhancedPng,
          width: raster.width,
          height: raster.height,
          rasterHash: r.hashes.raster,
        };
        const maps = Object.fromEntries(
          await Promise.all(
            Object.entries(r.probes).map(async ([name, probe]) => [
              name,
              await rasterToBlob(probe.map),
            ]),
          ),
        );
        await ws.record("batch:pipeline", {
          file: label(it),
          fileSha256: fileHash,
          rasterSha256: r.hashes.raster,
          ...(it.page ? { pdfPage: it.page } : {}),
          channel: ["red", "green", "blue"][channel]!,
          threshold: summary.threshold,
          strength: summary.strength,
          keldBands: summary.bands,
          laneSteps: summary.laneSteps,
          flaggedBlocks: summary.flagged,
          outputSha256: summary.outHash,
        });
        patch(it.id, {
          status: "done",
          step: undefined,
          blob: r.enhancedBlob,
          maps,
          out: URL.createObjectURL(r.enhancedBlob),
          summary,
        });
      } catch (e) {
        if (isAbort(e)) {
          patch(it.id, { status: "queued", step: undefined });
          break;
        }
        patch(it.id, {
          status: "error",
          step: undefined,
          error: e instanceof Error ? e.message : "Failed",
        });
      }
    }
    await Promise.all([...documents.values()].map((pdf) => pdf.destroy()));
    setRunning(false);
  };

  const done = items.filter((x) => x.status === "done");

  const exportReport = () => {
    const rows = done.map((x) => ({ file: label(x), page: x.page ?? null, ...x.summary }));
    downloadBlob(
      new Blob(
        [
          JSON.stringify(
            {
              format: "enhance-batch-v1",
              exportedAt: new Date().toISOString(),
              channel: ["red", "green", "blue"][channel]!,
              items: rows,
              ledgerHead: ws.ledger.at(-1)?.chain ?? null,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      "enhance-batch-report.json",
    );
  };
  const csv = () => {
    const columns = [
      "file",
      "pdfPage",
      "sourceSha256",
      "rasterSha256",
      "width",
      "height",
      "threshold",
      "strength",
      "meanEntropy",
      "activePercent",
      "clippedPixels",
      "keldBands",
      "laneSteps",
      "flaggedBlocks",
      "outputSha256",
    ];
    const quote = (value: unknown) => {
      const raw = String(value ?? "");
      const safe = typeof value === "string" && /^[=+@\-\t\r\n]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    const lines = done.map((x) => {
      const s = x.summary!;
      return [
        label(x),
        x.page ?? "",
        s.fileHash,
        s.rasterHash,
        s.width,
        s.height,
        s.threshold,
        s.strength,
        s.meanEntropy,
        s.active,
        s.clipped,
        s.bands,
        s.laneSteps,
        s.flagged,
        s.outHash,
      ]
        .map(quote)
        .join(",");
    });
    return [columns.join(","), ...lines].join("\r\n") + "\r\n";
  };
  const exportZip = async () => {
    setExporting(true);
    try {
      const files: { name: string; blob: Blob }[] = [
        { name: "manifest.csv", blob: new Blob([csv()], { type: "text/csv" }) },
        {
          name: "batch-report.json",
          blob: new Blob(
            [
              JSON.stringify(
                {
                  format: "enhance-batch-v2",
                  exportedAt: new Date().toISOString(),
                  ledgerHead: ws.ledger.at(-1)?.chain ?? null,
                  items: done.map((x) => ({ file: label(x), page: x.page ?? null, ...x.summary })),
                },
                null,
                2,
              ),
            ],
            { type: "application/json" },
          ),
        },
      ];
      for (const [index, item] of done.entries()) {
        const folder = `${String(index + 1).padStart(3, "0")}-${label(item).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        files.push({ name: `${folder}/enhanced.png`, blob: item.blob! });
        for (const [name, blob] of Object.entries(item.maps ?? {}))
          files.push({ name: `${folder}/${name}.png`, blob });
      }
      downloadBlob(await archiveBlobs(files), "enhance-batch.zip");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ZIP export failed.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageTitle kicker="03 / BATCH" title="Many images, one pass.">
        Each image is auto-tuned, enhanced, and probed with KELD, lane comb, and quantization. Every
        result is added to the provenance ledger. PDFs are decomposed into pages locally at 1× by
        default (16 MP per page).
      </PageTitle>
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Panel title="Queue" kicker={`${items.length} files`}>
          <Dropzone
            multiple
            compact
            accept="image/png,image/jpeg,image/webp,image/bmp,application/pdf,.pdf"
            onFiles={(files) => void add(files)}
          />
          {importing && <p className="mt-2 text-xs">Reading PDF page count…</p>}
          <div className="mt-4 font-mono text-xs text-muted-foreground">probe channel</div>
          <div className="mt-1 flex gap-1">
            {(["Red", "Green", "Blue"] as const).map((c, i) => (
              <button
                key={c}
                disabled={running}
                onClick={() => setChannel(i as Channel)}
                className={cn(
                  "flex-1 rounded border px-2 py-1 font-mono text-xs",
                  channel === i && "border-accent bg-secondary text-accent",
                )}
              >
                {c}
              </button>
            ))}
          </div>
          <label className="mt-3 block text-xs" htmlFor="pdf-scale">
            PDF render detail
          </label>
          <select
            id="pdf-scale"
            disabled={running}
            value={pdfScale}
            onChange={(e) => setPdfScale(Number(e.target.value))}
            className="mt-1 w-full rounded border bg-background p-2 text-xs"
          >
            <option value={1}>1× · document page size (recommended)</option>
            <option value={1.5}>1.5× · larger pixels</option>
            <option value={2}>2× · highest detail and memory use</option>
          </select>
          <div className="mt-4 flex flex-col gap-2">
            {running ? (
              <Button variant="destructive" onClick={() => abort.current?.abort()}>
                <Square className="h-4 w-4" /> Stop
              </Button>
            ) : (
              <Button
                onClick={run}
                disabled={
                  importing || !items.some((x) => x.status === "queued" || x.status === "error")
                }
              >
                <Play className="h-4 w-4" /> Run batch
              </Button>
            )}
            <Button variant="secondary" onClick={exportReport} disabled={!done.length}>
              <FileJson className="h-4 w-4" /> Export batch report
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                downloadBlob(
                  new Blob([csv()], { type: "text/csv;charset=utf-8" }),
                  "enhance-batch-manifest.csv",
                )
              }
              disabled={!done.length}
            >
              <Table className="h-4 w-4" /> Export CSV manifest
            </Button>
            <Button
              variant="secondary"
              onClick={exportZip}
              disabled={!done.length || exporting || running}
            >
              <Archive className="h-4 w-4" /> {exporting ? "Packing…" : "Download ZIP with maps"}
            </Button>
            <Button
              variant="ghost"
              disabled={running || !items.length}
              onClick={() => {
                items.forEach((x) => {
                  if (x.thumb) URL.revokeObjectURL(x.thumb);
                  if (x.out) URL.revokeObjectURL(x.out);
                });
                setItems([]);
              }}
            >
              <Trash2 className="h-4 w-4" /> Clear queue
            </Button>
          </div>
        </Panel>
        <Panel title="Results" kicker={`${done.length}/${items.length} done`}>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add images to start.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map((x) => (
                <div
                  key={x.id}
                  className={cn(
                    "overflow-hidden rounded-md border bg-card",
                    x.status === "running" && "border-accent",
                    x.status === "error" && "border-destructive",
                  )}
                >
                  <div className="checker aspect-video">
                    {x.out || x.thumb ? (
                      <img
                        src={x.out ?? x.thumb}
                        alt={label(x)}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                        PDF page {x.page}
                      </div>
                    )}
                  </div>
                  <div className="space-y-1 p-3">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-xs">{label(x)}</span>
                      <span
                        className={cn(
                          "ml-auto rounded px-1.5 py-0.5 font-mono text-[10px] uppercase",
                          x.status === "done"
                            ? "bg-accent text-accent-foreground"
                            : x.status === "error"
                              ? "bg-destructive text-destructive-foreground"
                              : "bg-secondary text-muted-foreground",
                        )}
                      >
                        {x.step ?? x.status}
                      </span>
                    </div>
                    {x.error && <p className="text-xs text-destructive">{x.error}</p>}
                    {x.summary && (
                      <>
                        <div className="grid grid-cols-3 gap-1 font-mono text-[11px] text-muted-foreground">
                          <span>
                            thr <b className="text-foreground">{x.summary.threshold}</b>
                          </span>
                          <span>
                            str <b className="text-foreground">{x.summary.strength}</b>
                          </span>
                          <span>
                            ent{" "}
                            <b className="text-foreground">{x.summary.meanEntropy.toFixed(2)}</b>
                          </span>
                          <span>
                            bands <b className="text-foreground">{x.summary.bands}</b>
                          </span>
                          <span>
                            ±1 <b className="text-foreground">{x.summary.laneSteps}</b>
                          </span>
                          <span>
                            flag{" "}
                            <b className={x.summary.flagged ? "text-signal" : "text-foreground"}>
                              {x.summary.flagged}
                            </b>
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-1 w-full"
                          onClick={() =>
                            x.blob && downloadBlob(x.blob, outputName(label(x), "enhanced"))
                          }
                        >
                          <Download className="h-3.5 w-3.5" /> Enhanced PNG
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
