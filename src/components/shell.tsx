import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { useWorkspace } from "@/lib/workspace";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Enhance", k: "01" },
  { to: "/evidence", label: "Evidence Lab", k: "02" },
  { to: "/tools", label: "Image Tools", k: "03" },
  { to: "/batch", label: "Batch", k: "04" },
  { to: "/spectral", label: "Spectral Lab", k: "05" },
  { to: "/receipts", label: "Provenance", k: "06" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { busy, cancel, source, ledger } = useWorkspace();
  return (
    <div className="min-h-screen grid-backdrop">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="spectrum-bar h-0.5" />
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link to="/" className="font-mono text-lg font-bold tracking-tight">
            ENHANCE<span className="text-primary">!</span>
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              digital image processing
            </span>
          </Link>
          <nav className="-mx-1 flex w-full gap-1 overflow-x-auto px-1 pb-1 md:w-auto md:flex-wrap md:overflow-visible md:pb-0">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                activeOptions={{ exact: true }}
                className="shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                activeProps={{ className: "bg-secondary !text-foreground" }}
              >
                <span className="mr-1.5 text-primary">{n.k}</span>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 font-mono text-xs text-muted-foreground">
            {busy ? (
              <span className="flex items-center gap-2 text-accent">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {busy}
                <button
                  onClick={cancel}
                  aria-label="Cancel"
                  className="rounded p-0.5 hover:bg-secondary"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : (
              <span>{source ? source.name : "no source"}</span>
            )}
            <span className="rounded border px-2 py-0.5">{ledger.length} ops</span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-4 py-6">{children}</main>
    </div>
  );
}

export function Panel({
  title,
  kicker,
  actions,
  className,
  children,
}: {
  title: string;
  kicker?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("rounded-lg border bg-panel/95", className)}>
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        {kicker && (
          <span className="font-mono text-[10px] uppercase tracking-widest text-primary">
            {kicker}
          </span>
        )}
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "primary" | "accent" | "signal";
}) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 font-mono text-base",
          tone === "primary" && "text-primary",
          tone === "accent" && "text-accent",
          tone === "signal" && "text-signal",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function PageTitle({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="font-mono text-xs text-primary">{kicker}</div>
      <h1 className="mt-1 text-2xl font-bold md:text-3xl">{title}</h1>
      {children && <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}
