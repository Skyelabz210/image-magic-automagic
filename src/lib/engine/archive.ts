import { Zip, ZipPassThrough } from "fflate";

/** Streams already compressed PNGs into a stored ZIP, one file at a time. */
export async function archiveBlobs(entries: { name: string; blob: Blob }[]): Promise<Blob> {
  if (
    !entries.length ||
    entries.some((entry) => !entry.name || entry.name.startsWith("/") || entry.name.includes(".."))
  )
    throw new Error("Archive entries need safe relative names.");
  const total = entries.reduce((size, entry) => size + entry.blob.size, 0);
  if (total > 1_000_000_000) throw new Error("Archive exceeds 1 GB. Export smaller batches.");
  return new Promise<Blob>((resolve, reject) => {
    const chunks: ArrayBuffer[] = [];
    let finished = false;
    const zip = new Zip((error, data, final) => {
      if (finished) return;
      if (error) {
        finished = true;
        reject(error);
        return;
      }
      chunks.push(Uint8Array.from(data).buffer as ArrayBuffer);
      if (final) {
        finished = true;
        resolve(new Blob(chunks, { type: "application/zip" }));
      }
    });
    void (async () => {
      for (const entry of entries) {
        const file = new ZipPassThrough(entry.name);
        zip.add(file);
        const reader = entry.blob.stream().getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          file.push(value, false);
        }
        file.push(new Uint8Array(0), true);
      }
      zip.end();
    })().catch((error: unknown) => {
      if (!finished) {
        finished = true;
        reject(error);
      }
    });
  });
}
