import { MAX_FILE_BYTES, validateDimensions, type Raster } from "./processing";

type Document = Awaited<ReturnType<(typeof import("pdfjs-dist"))["getDocument"]>["promise"]>;

/** PDF bytes stay in the browser. Pages are rasterized on demand for the batch pipeline. */
export async function openPdf(file: File): Promise<Document> {
  if (file.size === 0 || file.size > MAX_FILE_BYTES)
    throw new Error("PDF must be nonempty and at most 50 MB.");
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document = await task.promise;
  if (document.numPages > 150) {
    await document.destroy();
    throw new Error("PDF has more than 150 pages. Split it into smaller batches.");
  }
  return document;
}

export async function rasterizePage(
  pdf: Document,
  pageNumber: number,
  signal?: AbortSignal,
  requestedScale = 1,
): Promise<Raster> {
  signal?.throwIfAborted();
  if (![1, 1.5, 2].includes(requestedScale)) throw new Error("Choose a PDF scale of 1, 1.5, or 2.");
  const page = await pdf.getPage(pageNumber);
  try {
    const base = page.getViewport({ scale: 1 });
    // Render at the requested scale, bounded by the engine limits.
    const scale = Math.min(
      requestedScale,
      8192 / Math.max(base.width, base.height),
      Math.sqrt(16_000_000 / (base.width * base.height)),
    );
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    validateDimensions(canvas.width, canvas.height);
    const context = canvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
    if (!context) throw new Error("Canvas rendering unavailable.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const task = page.render({ canvas, canvasContext: context, viewport });
    const cancel = () => task.cancel();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      await task.promise;
      signal?.throwIfAborted();
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const raster = { width: canvas.width, height: canvas.height, data: pixels.data };
    canvas.width = canvas.height = 0;
    return raster;
  } finally {
    page.cleanup();
  }
}
