import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { Button } from "@/components/ui/button";

/** Both layers share one pixel coordinate system and one pan/zoom transform. */
export function InspectionViewer({
  original,
  derived,
  derivedLabel = "Enhanced",
  difference,
  initialMode = "split",
}: {
  original: string;
  derived?: string | undefined;
  derivedLabel?: string;
  difference?: string | undefined;
  initialMode?: "split" | "difference";
}) {
  const [mode, setMode] = useState<"split" | "side" | "difference">(initialMode);
  const [split, setSplit] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ width: 1, height: 1 });
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [original]);
  useEffect(() => setMode(initialMode), [initialMode]);
  const changeZoom = (next: number) => {
    const value = Math.min(8, Math.max(1, next));
    setZoom(value);
    if (value === 1) setPan({ x: 0, y: 0 });
  };
  const wheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    changeZoom(zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2));
  };
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (zoom === 1 || (event.target as HTMLElement).closest("input,button")) return;
    drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setPan({
      x: drag.current.panX + event.clientX - drag.current.x,
      y: drag.current.panY + event.clientY - drag.current.y,
    });
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const image = (src: string, label: string) => (
    <img
      src={src}
      alt={label}
      draggable={false}
      className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
      style={{ imageRendering: zoom >= 4 ? "pixelated" : "auto" }}
    />
  );
  const scene = (view: "original" | "derived" | "difference") => (
    <div
      className="relative h-full w-full"
      style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
    >
      {image(
        view === "difference" ? difference! : original,
        view === "difference" ? "Absolute pixel difference heatmap" : "Original image",
      )}
      {derived && view === "derived" && image(derived, derivedLabel)}
    </div>
  );
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        {derived && (
          <>
            <Button
              size="sm"
              variant={mode === "split" ? "default" : "outline"}
              onClick={() => setMode("split")}
            >
              Split
            </Button>
            <Button
              size="sm"
              variant={mode === "side" ? "default" : "outline"}
              onClick={() => setMode("side")}
            >
              Side by side
            </Button>
          </>
        )}
        {difference && (
          <Button
            size="sm"
            variant={mode === "difference" ? "default" : "outline"}
            onClick={() => setMode("difference")}
          >
            Difference ×4
          </Button>
        )}
        <span className="ml-auto font-mono text-muted-foreground">{Math.round(zoom * 100)}%</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => changeZoom(zoom / 1.5)}
          aria-label="Zoom out"
        >
          −
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => changeZoom(zoom * 1.5)}
          aria-label="Zoom in"
        >
          +
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            changeZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          Fit
        </Button>
      </div>
      <div
        ref={viewport}
        className="checker relative h-[min(68vh,680px)] min-h-64 overflow-hidden rounded-md touch-none"
        style={{ cursor: zoom > 1 ? "grab" : "default" }}
        onWheel={wheel}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {mode === "side" && derived ? (
          <div className="grid h-full grid-cols-2">
            <div className="relative overflow-hidden">{scene("original")}</div>
            <div className="relative overflow-hidden">{scene("derived")}</div>
          </div>
        ) : mode === "difference" && difference ? (
          scene("difference")
        ) : (
          <>
            {scene("original")}
            {derived && (
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ clipPath: `inset(0 0 0 ${split}%)` }}
              >
                {scene("derived")}
              </div>
            )}
          </>
        )}
        {mode === "split" && derived && (
          <>
            <div
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow"
              style={{ left: `${split}%` }}
            />
            <input
              aria-label="Before and after split position"
              type="range"
              min="0"
              max="100"
              value={split}
              onChange={(e) => setSplit(Number(e.target.value))}
              className="absolute bottom-2 left-[10%] z-10 w-[80%]"
            />
          </>
        )}
        {zoom > 1 && (
          <div
            className="absolute right-2 top-2 h-20 w-28 overflow-hidden rounded border bg-background/90"
            aria-label="Image minimap"
          >
            <img
              src={original}
              alt=""
              className="h-full w-full object-contain"
              onLoad={(e) =>
                setSize({
                  width: e.currentTarget.naturalWidth,
                  height: e.currentTarget.naturalHeight,
                })
              }
            />
            <span
              className="absolute border border-primary bg-primary/20"
              style={{
                width: `${100 / zoom}%`,
                height: `${100 / zoom}%`,
                left: `calc(${(1 - 1 / zoom) * 50}% - ${(pan.x / zoom / (viewport.current?.clientWidth || size.width)) * 100}%)`,
                top: `calc(${(1 - 1 / zoom) * 50}% - ${(pan.y / zoom / (viewport.current?.clientHeight || size.height)) * 100}%)`,
              }}
            />
          </div>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Wheel to zoom up to 800%; drag to pan. Derived pixels are aligned with the original.
      </p>
    </div>
  );
}
