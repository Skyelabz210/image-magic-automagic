import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { expandPdfs } from "@/lib/engine/pdf";

export function Dropzone({
  onFiles,
  multiple,
  compact,
}: {
  onFiles: (f: File[]) => void;
  multiple?: boolean;
  compact?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [converting, setConverting] = useState(false);
  const handle = async (files: File[]) => {
    if (!files.some((f) => /pdf/i.test(f.type) || /\.pdf$/i.test(f.name))) return onFiles(files);
    setConverting(true);
    try {
      onFiles(await expandPdfs(files));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "This PDF could not be read.");
    } finally {
      setConverting(false);
    }
  };
  return (
    <button
      type="button"
      onClick={() => ref.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void handle(Array.from(e.dataTransfer.files));
      }}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center transition-colors hover:border-accent hover:bg-secondary/40",
        compact ? "p-4" : "min-h-[360px] p-10",
        over && "border-accent bg-secondary/60",
      )}
    >
      <Upload className="h-6 w-6 text-accent" />
      <span className="font-mono text-sm">
        {converting
          ? "Converting PDF pages…"
          : multiple
            ? "Drop images or PDFs, or click to choose"
            : "Drop an image or PDF, or click to choose"}
      </span>
      <span className="text-xs text-muted-foreground">
        PNG, JPEG, WebP, BMP, PDF · up to 50 MB · 16 MP · full resolution kept
      </span>
      <input
        ref={ref}
        type="file"
        hidden
        multiple={multiple}
        accept="image/png,image/jpeg,image/webp,image/bmp,application/pdf,.pdf"
        onChange={(e) => {
          void handle(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </button>
  );
}
