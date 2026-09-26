import { createFileRoute } from "@tanstack/react-router";
import { PageTitle } from "@/components/shell";

export const Route = createFileRoute("/spectral")({
  head: () => ({
    meta: [
      { title: "Spectral Lab — ENHANCE!" },
      { name: "description", content: "Full-size Archimedes palimpsest and recovery reference images: KELD, principal components, band ratios." },
      { property: "og:title", content: "Spectral Lab — ENHANCE!" },
      { property: "og:description", content: "Full-size Archimedes palimpsest and recovery reference images." },
    ],
  }),
  component: SpectralPage,
});

const REFS = [
  { file: "archimedes-keld.png", label: "Archimedes KELD map" },
  { file: "archimedes-pc1.png", label: "Archimedes principal component" },
  { file: "archimedes-ratio.png", label: "Archimedes band ratio" },
  { file: "recover-raw.png", label: "Recovery source" },
  { file: "recover-pca.png", label: "Recovery PCA" },
  { file: "recover-undertext.png", label: "Recovery inspection" },
  { file: "proof-panel.png", label: "Comparison panel" },
];

function SpectralPage() {
  return (
    <>
      <PageTitle kicker="04 / SPECTRAL LAB" title="Reference plates.">
        Seven reference PNGs from the Archimedes and recovery studies. Open any plate at full size.
      </PageTitle>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REFS.map((r, i) => (
          <a key={r.file} href={`/reference/${r.file}`} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-lg border bg-panel transition-colors hover:border-accent">
            <div className="checker aspect-[4/3] overflow-hidden">
              <img src={`/reference/${r.file}`} alt={r.label} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
            </div>
            <div className="flex items-center gap-2 px-3 py-2 font-mono text-xs">
              <span className="text-primary">{String(i + 1).padStart(2, "0")}</span>
              {r.label}
            </div>
          </a>
        ))}
      </div>
    </>
  );
}
