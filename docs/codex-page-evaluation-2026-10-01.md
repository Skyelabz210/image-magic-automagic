# Codex manuscript page evaluation

The supplied World Digital Library PDF contains 78 raster pages with one embedded 684 × 1350 JPEG per PDF page. This trial extracted the original JPEGs from PDF pages 54, 55 and 56 using `pdfimages -f 54 -l 56 -j`; it did not enlarge or resample them. Page numbers here are **PDF page numbers**, which may differ from manuscript folio labels.

## Reproducible commands

```sh
pdfimages -f 54 -l 56 -j input.pdf pages/page
npm run cli -- pipeline pages/page-000.jpg --output page-54-pipeline.png
npm run cli -- tool pages/page-000.jpg --tool manuscript --amount 100 --output page-54-reading.png
# Repeat with page-001 (PDF page 55) and page-002 (PDF page 56).
```

The new `manuscript` tool estimates a local alpha-weighted background and applies a smooth, bounded contrast curve. It runs through the shared RGBA8 tool engine in the browser worker and CLI. The output is a derived reading view; the imported JPEG remains available for checking faint or ambiguous marks.

## Measurements

The comparison uses the same central field in each image, x=100..589 and y=160..1189 (490 × 1030 pixels). `p90−p10` is the luminance span in 8-bit levels; `edge mean` is the mean absolute horizontal luminance step; `limit %` counts pixels where any RGB channel reaches exactly 0 or 255. The last column is mean absolute RGB change from the decoded JPEG. These are descriptive measurements on three pages, not a transcription accuracy score.

| PDF page | View               | p90−p10 | Edge mean | Limit % | Mean RGB change |
| -------- | ------------------ | ------: | --------: | ------: | --------------: |
| 54       | Original           |   132.9 |     11.72 |    0.08 |               0 |
| 54       | Auto pipeline      |   138.7 |     14.99 |    0.65 |             3.4 |
| 54       | Manuscript reading |   140.7 |     11.56 |    0.00 |            28.5 |
| 55       | Original           |   132.0 |     12.16 |    0.23 |               0 |
| 55       | Auto pipeline      |   136.1 |     14.28 |    0.73 |             2.4 |
| 55       | Manuscript reading |   144.1 |     11.93 |    0.00 |            23.2 |
| 56       | Original           |   123.8 |     13.12 |    0.05 |               0 |
| 56       | Auto pipeline      |   131.7 |     16.82 |    0.69 |             3.8 |
| 56       | Manuscript reading |   135.3 |     13.25 |    0.00 |            24.2 |

At full-page scale, the auto pipeline makes a subtle change. The manuscript reading view visibly lifts the paper and separates the red and black marks from uneven substrate tone. Its smoother horizontal step metric suggests less amplification of high-frequency paper texture than the auto pipeline in this field, although the metric also includes real line edges. A stronger hard-clipped prototype exceeded 11% channel-limit pixels and was rejected. The shipped smooth curve reached 0% in these fields.

Review weak glyph interiors and abraded edges alongside the original at native pixels. Contrast normalization can brighten faded pigment and textured paper together; it cannot reconstruct lost ink or raise the JPEG's captured resolution. Quantitative recognition gains require independent transcriptions or annotated mark masks, ideally from multiple Codex images rather than this single scan set.

### SHA-256 source bindings

| PDF page | Embedded JPEG SHA-256                                              | Reading PNG SHA-256                                                |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 54       | `a8b0e164fa2ee7c80e44e8150323c3a1d9d37cad3a26a209fc0754501c19029a` | `c817e70db688206693aa05bb639acf3961b219a85ab25804f65b3321430f8397` |
| 55       | `b9fc568d9b541192230be83a7c0c8192524dc214c984baba9ed9a1aa1807521f` | `29d59df8d575e4a7ddc51c631a2dd62b7981bfaa58138edfaad2c504683ed2b8` |
| 56       | `b8f569d312b9728c0728ecbd7a4e13c8fada9b2f30413fc60764cd0569e05a53` | `046b5bf313068b7a1450b545b9d87bfd861249e8fae893d5f34fa43625015a80` |
