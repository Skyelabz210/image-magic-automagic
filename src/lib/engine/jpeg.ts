/** Structural inspection of the original JPEG bytes. No pixel decoding or DCT inference. */
export type QuantizationTable = {
  id: number;
  precision: 8 | 16;
  /** Values in the order encoded in DQT (JPEG zigzag order). */
  zigzag: number[];
  offset: number;
};
export type JpegStructure = {
  format: "jpeg";
  width: number | null;
  height: number | null;
  frame: string | null;
  components: { id: number; horizontal: number; vertical: number; tableId: number }[];
  scans: number;
  restartInterval: number | null;
  metadata: {
    jfif: boolean;
    exif: boolean;
    exifOrientation: number | null;
    icc: boolean;
    xmp: boolean;
    jumbfApp11: boolean;
    adobe: boolean;
  };
  markers: { name: string; offset: number; length: number }[];
  quantizationTables: QuantizationTable[];
  complete: boolean;
  warnings: string[];
  method: string;
};

const FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
const name = (marker: number) =>
  (
    ({ 0xd8: "SOI", 0xd9: "EOI", 0xda: "SOS", 0xdb: "DQT", 0xdd: "DRI", 0xfe: "COM" }) as Record<
      number,
      string
    >
  )[marker] ??
  (FRAME_MARKERS.has(marker)
    ? `SOF${marker - 0xc0}`
    : marker >= 0xe0 && marker <= 0xef
      ? `APP${marker - 0xe0}`
      : `FF${hex(marker)}`);

function exifOrientation(bytes: Uint8Array, begin: number, end: number): number | null {
  const tiff = begin + 6; // Exif\0\0
  if (tiff + 8 > end) return null;
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  if (!little && !(bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d)) return null;
  const u16 = (p: number) =>
    little ? bytes[p]! | (bytes[p + 1]! << 8) : (bytes[p]! << 8) | bytes[p + 1]!;
  const u32 = (p: number) =>
    little
      ? (bytes[p]! | (bytes[p + 1]! << 8) | (bytes[p + 2]! << 16) | (bytes[p + 3]! << 24)) >>> 0
      : ((bytes[p]! << 24) | (bytes[p + 1]! << 16) | (bytes[p + 2]! << 8) | bytes[p + 3]!) >>> 0;
  if (u16(tiff + 2) !== 42) return null;
  const first = tiff + u32(tiff + 4);
  if (first < tiff + 8 || first + 2 > end) return null;
  const count = u16(first);
  if (count > Math.floor((end - first - 2) / 12)) return null;
  for (let i = 0; i < count; i++) {
    const p = first + 2 + i * 12;
    if (u16(p) === 0x0112 && u16(p + 2) === 3 && u32(p + 4) === 1) {
      const value = u16(p + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

export function inspectJpeg(input: Uint8Array): JpegStructure {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8)
    throw new Error("Original file is not a JPEG stream (missing SOI marker).");
  const result: JpegStructure = {
    format: "jpeg",
    width: null,
    height: null,
    frame: null,
    components: [],
    scans: 0,
    restartInterval: null,
    metadata: {
      jfif: false,
      exif: false,
      exifOrientation: null,
      icc: false,
      xmp: false,
      jumbfApp11: false,
      adobe: false,
    },
    markers: [{ name: "SOI", offset: 0, length: 2 }],
    quantizationTables: [],
    complete: false,
    warnings: [],
    method:
      "Original-byte JPEG marker and DQT inspection; no DCT coefficients or recompression verdict.",
  };
  const read16 = (at: number) => (input[at]! << 8) | input[at + 1]!;
  let at = 2;
  let inScan = false;
  while (at < input.length && result.markers.length < 10000) {
    if (input[at] !== 0xff) {
      result.warnings.push(`Expected marker at byte ${at}; stream may be truncated or malformed.`);
      break;
    }
    const start = at;
    while (at < input.length && input[at] === 0xff) at++;
    if (at >= input.length) break;
    const marker = input[at++]!;
    if (marker === 0x00) {
      result.warnings.push(`Unexpected byte-stuffed marker at byte ${start}.`);
      break;
    }
    if (marker === 0xd9) {
      result.markers.push({ name: "EOI", offset: start, length: at - start });
      result.complete = true;
      if (at < input.length) result.warnings.push(`${input.length - at} bytes follow EOI.`);
      break;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      result.markers.push({ name: name(marker), offset: start, length: at - start });
      continue;
    }
    if (at + 2 > input.length) {
      result.warnings.push(`Truncated ${name(marker)} length at byte ${start}.`);
      break;
    }
    const length = read16(at);
    if (length < 2 || at + length > input.length) {
      result.warnings.push(`Invalid or truncated ${name(marker)} segment at byte ${start}.`);
      break;
    }
    const body = at + 2,
      end = at + length;
    result.markers.push({ name: name(marker), offset: start, length: end - start });
    const prefix = (signature: string) =>
      body + signature.length <= end &&
      Array.from(signature).every((char, index) => input[body + index] === char.charCodeAt(0));
    if (marker === 0xe0 && prefix("JFIF\0")) result.metadata.jfif = true;
    if (marker === 0xe1 && prefix("Exif\0\0")) {
      result.metadata.exif = true;
      result.metadata.exifOrientation = exifOrientation(input, body, end);
    }
    if (marker === 0xe1 && prefix("http://ns.adobe.com/xap/1.0/\0")) result.metadata.xmp = true;
    if (marker === 0xe2 && prefix("ICC_PROFILE\0")) result.metadata.icc = true;
    if (marker === 0xeb && prefix("JP")) result.metadata.jumbfApp11 = true;
    if (marker === 0xee && prefix("Adobe\0")) result.metadata.adobe = true;
    if (marker === 0xdb) {
      let p = body;
      while (p < end) {
        const tableOffset = p;
        const descriptor = input[p++]!;
        const precision = descriptor >> 4;
        const size = precision === 0 ? 64 : precision === 1 ? 128 : 0;
        if (!size || p + size > end) {
          result.warnings.push(`Malformed DQT table at byte ${tableOffset}.`);
          break;
        }
        const zigzag = Array.from({ length: 64 }, (_, index) =>
          precision === 0 ? input[p + index]! : read16(p + index * 2),
        );
        result.quantizationTables.push({
          id: descriptor & 15,
          precision: precision === 0 ? 8 : 16,
          zigzag,
          offset: tableOffset,
        });
        p += size;
      }
    } else if (FRAME_MARKERS.has(marker)) {
      if (end - body >= 6) {
        result.frame = name(marker);
        result.height = read16(body + 1);
        result.width = read16(body + 3);
        const count = input[body + 5]!;
        if (end - body !== 6 + count * 3)
          result.warnings.push(`Malformed frame component list at byte ${start}.`);
        else
          result.components = Array.from({ length: count }, (_, index) => {
            const p = body + 6 + index * 3;
            return {
              id: input[p]!,
              horizontal: input[p + 1]! >> 4,
              vertical: input[p + 1]! & 15,
              tableId: input[p + 2]!,
            };
          });
      } else result.warnings.push(`Malformed frame header at byte ${start}.`);
    } else if (marker === 0xdd) {
      if (end - body === 2) result.restartInterval = read16(body);
      else result.warnings.push(`Malformed DRI segment at byte ${start}.`);
    } else if (marker === 0xda) {
      result.scans++;
      inScan = true;
    }
    at = end;
    if (inScan) {
      // Entropy-coded bytes can contain FF00 escapes and restart markers. Only
      // an unescaped, non-restart FF marker ends this scan.
      while (at < input.length) {
        if (input[at++] !== 0xff) continue;
        while (at < input.length && input[at] === 0xff) at++;
        if (at >= input.length) break;
        const next = input[at]!;
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          at++;
          continue;
        }
        at--;
        inScan = false;
        break;
      }
    }
  }
  if (!result.complete) result.warnings.push("EOI was not found; the stream may be truncated.");
  if (!result.scans) result.warnings.push("No SOS scan was found.");
  return result;
}
