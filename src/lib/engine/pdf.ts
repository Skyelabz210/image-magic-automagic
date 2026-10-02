// Turns PDF pages into PNG files in the browser so the rest of the app sees ordinary images.
const MAX_PAGES = 20;
const MAX_SIDE = 4000;

export const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

export async function pdfToImages(file: File): Promise<File[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = (
    await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
  ).default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const base = file.name.replace(/\.pdf$/i, "") || "document";
  const out: File[] = [];
  try {
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
      const page = await doc.getPage(n);
      const unit = page.getViewport({ scale: 1 });
      // Render at ~200 dpi, capped so pages stay within the app's size limits.
      const scale = Math.min(200 / 72, MAX_SIDE / Math.max(unit.width, unit.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      canvas.width = canvas.height = 0;
      if (!blob) throw new Error("A PDF page could not be converted.");
      const name = doc.numPages > 1 ? `${base}-page${n}.png` : `${base}.png`;
      out.push(new File([blob], name, { type: "image/png" }));
    }
  } finally {
    await doc.destroy();
  }
  if (!out.length) throw new Error("This PDF has no pages.");
  return out;
}

/** Expands any PDFs in a file list into one PNG per page. */
export async function expandPdfs(files: File[]): Promise<File[]> {
  const result: File[] = [];
  for (const f of files) result.push(...(isPdf(f) ? await pdfToImages(f) : [f]));
  return result;
}
