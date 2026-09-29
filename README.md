# ENHANCE! Digital Image Processing

A browser image workspace based on [Digisl-Image-Processing-App](https://github.com/Skyelabz210/Digisl-Image-Processing-App), connected to [Lovable](https://lovable.dev/projects/118ebc09-4302-4708-a04f-45dfa5f99648). [Live app](https://image-magic-automagic.lovable.app).

## What is included

| Area           | Available tools                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enhance        | Native resolution 9×9 Shannon entropy, thresholded luminance enhancement, mask and entropy map, auto tuning, full run                                                                 |
| Evidence Lab   | KELD STAR8 band map, 7/11/13 lane comb unit steps, 16×16 pixel-step GCD map, JPEG DQT inspection, named region comparison, external segmentation masks and opt-in AI region questions |
| Image Tools    | Invert, grayscale, signed brightness, contrast, channel isolation, threshold, Sobel edge map, 3×3 median filter                                                                       |
| Batch          | Multiple images, automatic enhancement, probe counts, per image report                                                                                                                |
| Spectral Lab   | Seven spectral reference illustrations with method notes                                                                                                                              |
| Provenance     | Local SHA-256 chained receipt ledger, original and exported PNG hashes, on-demand browser C2PA Content Credentials validation                                                         |
| AI suggestions | Choose Lovable AI or Google Gemini; small preview sent only after requesting a suggestion                                                                                             |
| CLI            | Inspect, C2PA credentials, JPEG structure, native-pixel rectangle/mask, stress run, tune, enhance, probe, pipeline, tool, batch and opt-in suggest                                    |

The browser worker and CLI import the same RGBA8 pixel algorithms. Pixel transformations can change visual evidence; keep the source and receipt if the result will be reviewed. The visual probes report signals, not proof that an image was altered.

## Local development

Requires Node.js 22 or newer. `sharp` installs platform specific binaries for CLI image decoding and PNG writing.

```sh
npm install
npm run dev
npm test
npm run build
```

`bun install` is also supported via the committed `bun.lock`.

## CLI

```sh
npm run cli -- --help
npm run cli -- inspect photo.jpg
npm run cli -- tune photo.jpg
npm run cli -- region photo.jpg --region 120,80,64,64
npm run cli -- mask-region photo.jpg --mask segment.png
npm run cli -- jpeg-structure photo.jpg
npm run cli -- credentials photo.jpg
npm run cli -- inspect photo.jpg --credentials
npm run cli -- stress photo.jpg --output stress.json
npm run cli -- enhance photo.jpg --threshold 3.5 --strength 1.8 --output enhanced.png
npm run cli -- probe photo.jpg --probe quantization --channel green --output blocks.png
npm run cli -- pipeline photo.jpg --output enhanced.png
npm run cli -- tool photo.jpg --tool median --output median.png
npm run cli -- tool photo.jpg --tool brightness --amount -25 --output darker.png
npm run cli -- batch a.jpg b.png --output ./results
```

Commands write a JSON report to stdout; image commands write PNGs. Batch keeps going on individual errors and exits with code 1 if any image failed. Input is limited to 50 MB, 16 million pixels and 8,192 pixels per side. `sharp` reads common formats including JPEG, PNG, WebP and BMP. The CLI applies EXIF orientation and converts to sRGB before processing; browser and CLI decoding may still differ slightly by platform. PNG hashes describe the exported file and can differ between encoders; raster hashes describe decoded RGBA8 pixels.

The `jpeg-structure` command reads original bytes and lists markers, DQT values in encoded zigzag order, frame sampling, scans and APP metadata signatures (JFIF, EXIF orientation, ICC, XMP and APP11 JUMBF). APP11 presence is a structural observation; run credential validation to verify a claim. The command does not extract DCT coefficients or infer double compression. `stress` runs fixed JPEG quality 85/60, double JPEG, half-size and Gaussian blur variants on images up to 2 million pixels; the report gives probe counts and differences for **one input image**. RGB differences use pixels fully opaque in both versions; the report records changes in opacity population, and returns null when no pixels can be compared. The numbers have no ground-truth label, confidence or accuracy meaning.

`mask-region` and the Evidence Lab mask uploader accept an exact-dimension mask exported by a segmenter (for example SAM). White/opaque pixels at or above 128 select source pixels; black or transparent pixels are excluded. Partially transparent source samples are excluded from measurements. The CLI report binds source and mask hashes. The app does not run SAM or PixRestore models; their weights, GPU requirements, licenses and test datasets need a separate deployment and benchmark before claiming on-device support.

Named selections stay in the current workspace while switching pages and reset when a new source is imported. Evidence Lab exports region measurements with both original-file and decoded-raster hashes. Submitting a region question sends a reduced preview and measurements to the chosen provider; the receipt records the question, answer summary, provider, prompt version and source raster hash.

The Provenance page validates Content Credentials in the browser from the imported **original file** using the C2PA WASM SDK, loaded only when requested. The CLI `credentials` and `inspect --credentials` commands use the same C2PA WASM core directly in Node, without a native binary. Results distinguish absent, unsupported, invalid, valid, trusted and unresolved. A valid manifest is a verified signed claim, not a guarantee that the depicted scene is true. The 8.7 MB WASM asset must be hosted with the site. A failed SDK load is shown as unavailable, not as an absent credential. The [official signed test file](tests/fixtures/README.md) verifies as **valid with an untrusted test signer**; flipping a byte in its encoded image produces an invalid data-hash status. A trusted signer fixture and production trust-anchor configuration remain to be tested.

## AI providers

The browser defaults to Lovable AI. To use Gemini, configure `GEMINI_API_KEY` as a **server-side secret** in the deployment environment and select **Google Gemini** in the AI suggestions panel. Locally, put the secret in your shell environment or an untracked `.env.local`. Optional `GEMINI_MODEL` defaults to `gemini-3.8-flash`; when it is busy or rate-limited (free tier: 5 requests/minute) the server retries once with `GEMINI_FALLBACK_MODEL` (default `gemini-3.5-flash-lite`). Gemini is the default provider and can run automatically after each one-click full run. Lovable continues using server-side `LOVABLE_API_KEY`.

```sh
GEMINI_API_KEY=your-key npm run cli -- suggest photo.jpg
# Or, with a configured Lovable environment:
npm run cli -- suggest photo.jpg --ai-provider lovable
```

Only `suggest` calls a remote provider. The browser sends a downscaled preview and measurements, while the CLI sends a downscaled JPEG. No key is sent to the browser or written to receipts or reports. Gemini uses the Interactions API with `store: false`; review the provider's own data handling policies before submitting private images.

## Research and validation backlog

The research-backed issue collection orders independent work by value and validation effort:

1. [C2PA credential verification](https://github.com/Skyelabz210/image-magic-automagic/issues/2): extend the signed/tampered/unsigned fixture set with trusted and revocation cases and test browser verification with production trust anchors.
2. [Reliability Lab](https://github.com/Skyelabz210/image-magic-automagic/issues/3): extend the one-image stress run to labeled public datasets, detector calibration and multi-step provenance chains. HSIM/RITA and ForensicHub provide benchmark candidates.
3. [Optional learned restoration](https://github.com/Skyelabz210/image-magic-automagic/issues/4): compare PixRestore and current enhancement using paired images, latency and artifact inspection; gate optional WebGPU support on a measured runtime budget.
4. [Interactive analyst workflow](https://github.com/Skyelabz210/image-magic-automagic/issues/5): evaluate SAM 3 host and license terms, then optionally connect a hosted segmenter to the existing external mask measurement interface.
5. [JPEG original-byte inspector](https://github.com/Skyelabz210/image-magic-automagic/issues/6): validate DQT/marker parser against malformed and progressive corpora; add a vetted DCT coefficient decoder and labeled forensic test before any double-compression claim.

The region inspector in Evidence Lab and the `cli region` command are the first step in this workflow. Additional needs include reversible edit history, complete pipeline export manifests and batch memory cleanup.

The repository is synced to Lovable. Preserve published Git history when contributing.
