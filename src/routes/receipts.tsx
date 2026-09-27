import { createFileRoute } from "@tanstack/react-router";
import { FileJson, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { inspectCredentials, type CredentialReport } from "@/lib/engine/credentials";
import { Button } from "@/components/ui/button";
import { PageTitle, Panel } from "@/components/shell";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/receipts")({
  head: () => ({
    meta: [
      { title: "Provenance — ENHANCE!" },
      {
        name: "description",
        content:
          "Hash-chained SHA-256 ledger binding sources, methods, parameters, and outputs. Export verifiable receipts.",
      },
      { property: "og:title", content: "Provenance — ENHANCE!" },
      {
        property: "og:description",
        content: "Hash-chained SHA-256 ledger with exportable, verifiable receipts.",
      },
    ],
  }),
  component: ReceiptsPage,
});

function ReceiptsPage() {
  const { ledger, exportReceipt, clearLedger, source } = useWorkspace();
  const [credentials, setCredentials] = useState<CredentialReport | null>(null);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  useEffect(() => {
    setCredentials(null);
    setCredentialError(null);
  }, [source?.fileHash]);
  const inspect = async () => {
    if (!source) return;
    setReading(true);
    setCredentialError(null);
    try {
      const response = await fetch(source.url);
      if (!response.ok) throw new Error("Original file is no longer available.");
      const blob = await response.blob();
      const report = await inspectCredentials(blob);
      setCredentials(report);
    } catch (error) {
      setCredentialError(error instanceof Error ? error.message : "Credential inspection failed.");
    } finally {
      setReading(false);
    }
  };
  return (
    <>
      <PageTitle kicker="05 / PROVENANCE" title="Every operation, chained.">
        Each entry's SHA-256 covers its parameters and the previous entry, so any edit breaks the
        chain. Settings and receipts stay on this device.
      </PageTitle>
      <Panel title="Content Credentials" kicker="original file">
        <p className="mb-3 text-xs text-muted-foreground">
          Check the original bytes with the C2PA verifier. A valid manifest describes signed claims
          and file association; it does not prove the scene is real. No manifest does not imply an
          edit.
        </p>
        <Button size="sm" variant="secondary" disabled={!source || reading} onClick={inspect}>
          {reading ? "Validating…" : "Validate original file"}
        </Button>
        {!source && <p className="mt-2 text-xs text-muted-foreground">Import an image first.</p>}
        {credentialError && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            Verifier unavailable: {credentialError}
          </p>
        )}
        {credentials && (
          <div className="mt-3 space-y-1 rounded border p-3 text-xs">
            <p className="font-semibold capitalize">{credentials.state}</p>
            <p>{credentials.note}</p>
            {credentials.title && <p>Title: {credentials.title}</p>}
            {credentials.signer && <p>Signer: {credentials.signer}</p>}
            {credentials.issuer && <p>Issuer: {credentials.issuer}</p>}
            {credentials.ingredients.length > 0 && (
              <p>Ingredients: {credentials.ingredients.join(", ")}</p>
            )}
            {credentials.statusCodes.length > 0 && (
              <p>Status codes: {credentials.statusCodes.join(", ")}</p>
            )}
          </div>
        )}
      </Panel>
      <Panel
        title="Session ledger"
        kicker={`${ledger.length} entries`}
        actions={
          <>
            <Button size="sm" onClick={exportReceipt} disabled={!ledger.length}>
              <FileJson className="h-4 w-4" /> Export receipt
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => confirm("Clear the local ledger?") && clearLedger()}
              disabled={!ledger.length}
              aria-label="Clear ledger"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        }
      >
        {ledger.length === 0 ? (
          <p className="text-sm text-muted-foreground">No operations yet.</p>
        ) : (
          <ol className="space-y-2">
            {[...ledger].reverse().map((e) => (
              <li key={e.id} className="rounded-md border bg-card p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs">
                  <span className="text-primary">#{e.sequence}</span>
                  <span className="text-sm font-semibold">{e.operation}</span>
                  <span className="text-muted-foreground">
                    {new Date(e.timestamp).toLocaleString()}
                  </span>
                  <span className="ml-auto text-accent" title={e.chain}>
                    {e.chain.slice(0, 16)}…
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(e.parameters).map(([k, v]) => (
                    <span
                      key={k}
                      className="max-w-full truncate rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                      title={String(v)}
                    >
                      {k}:{" "}
                      <span className="text-foreground">
                        {String(v).length > 20 ? `${String(v).slice(0, 20)}…` : String(v)}
                      </span>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </>
  );
}
