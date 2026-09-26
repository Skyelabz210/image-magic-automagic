import { validateDimensions, type Raster } from "./processing.ts";
import type { Request, Response } from "./processing.worker.ts";

export function decodeImage(
  url: string,
  signal?: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      image.src = "";
      reject(new DOMException("Operation cancelled.", "AbortError"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(
        new Error(
          "This image could not be decoded. Try a valid PNG, JPEG, WebP, or BMP.",
        ),
      );
    };
    image.src = url;
  });
}

export async function readRaster(
  url: string,
  signal?: AbortSignal,
): Promise<Raster> {
  const image = await decodeImage(url, signal);
  signal?.throwIfAborted();
  const width = image.naturalWidth,
    height = image.naturalHeight;
  validateDimensions(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", {
    willReadFrequently: true,
    colorSpace: "srgb",
  });
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, width, height);
  canvas.width = 0;
  canvas.height = 0;
  return { width, height, data: pixels.data };
}

export function runWorker(
  request: Request,
  signal: AbortSignal,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(
      new URL("./processing.worker.ts", import.meta.url),
      { type: "module" },
    );
    const cleanup = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Operation cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<Response>) => {
      cleanup();
      if ("error" in data) reject(new Error(data.error));
      else resolve(data);
    };
    worker.onerror = () => {
      cleanup();
      reject(
        new Error(
          "The processing worker could not complete. Try a smaller image or reload the app.",
        ),
      );
    };
    worker.onmessageerror = () => {
      cleanup();
      reject(new Error("The processing result could not be read."));
    };
    try {
      worker.postMessage(request, [request.source.data.buffer]);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export function rasterToBlob(raster: Raster): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = raster.width;
    canvas.height = raster.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Canvas export is unavailable."));
      return;
    }
    ctx.putImageData(
      new ImageData(
        new Uint8ClampedArray(raster.data),
        raster.width,
        raster.height,
      ),
      0,
      0,
    );
    canvas.toBlob((blob) => {
      canvas.width = 0;
      canvas.height = 0;
      if (blob) resolve(blob);
      else reject(new Error("PNG encoding failed."));
    }, "image/png");
  });
}

export function downloadUrl(url: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const outputName = (name: string, layer: string) =>
  `${name.replace(/\.[^.]+$/, "") || "image"}-${layer}.png`;
export const isAbort = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";
