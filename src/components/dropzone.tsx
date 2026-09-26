import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

export function Dropzone({ onFiles, multiple, compact }: { onFiles: (f: File[]) => void; multiple?: boolean; compact?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      onClick={() => ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(Array.from(e.dataTransfer.files)); }}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center transition-colors hover:border-accent hover:bg-secondary/40",
        compact ? "p-4" : "min-h-[360px] p-10",
        over && "border-accent bg-secondary/60",
      )}
    >
      <Upload className="h-6 w-6 text-accent" />
      <span className="font-mono text-sm">{multiple ? "Drop images or click to choose" : "Drop an image or click to choose"}</span>
      <span className="text-xs text-muted-foreground">PNG, JPEG, WebP, BMP · up to 50 MB · 16 MP · full resolution kept</span>
      <input
        ref={ref}
        type="file"
        hidden
        multiple={multiple}
        accept="image/png,image/jpeg,image/webp,image/bmp"
        onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
      />
    </button>
  );
}
