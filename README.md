# ENHANCE! Digital Image Processing

A browser image workspace based on [Digisl-Image-Processing-App](https://github.com/Skyelabz210/Digisl-Image-Processing-App), connected to [Lovable](https://lovable.dev/projects/118ebc09-4302-4708-a04f-45dfa5f99648). [Live app](https://image-magic-automagic.lovable.app).

## What is included

| Area           | Available tools                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| Enhance        | Native resolution 9×9 Shannon entropy, thresholded luminance enhancement, mask and entropy map, auto tuning, full run |
| Evidence Lab   | KELD STAR8 band map, 7/11/13 lane comb unit steps, 16×16 quantization fingerprints, interactive region inspection     |
| Image Tools    | Invert, grayscale, signed brightness, contrast, channel isolation, threshold, Sobel edge map, 3×3 median filter       |
| Batch          | Multiple images, automatic enhancement, probe counts, per image report                                                |
| Spectral Lab   | Seven spectral reference illustrations with method notes                                                              |
| Provenance     | Local SHA-256 chained receipt ledger, original and exported PNG hashes                                                |
| AI suggestions | Choose Lovable AI or Google Gemini; small preview sent only after requesting a suggestion                             |
| CLI            | Inspect, native-pixel region, tune, enhance, probe, pipeline, tool, batch and opt-in suggest                          |

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
npm run cli -- enhance photo.jpg --threshold 3.5 --strength 1.8 --output enhanced.png
npm run cli -- probe photo.jpg --probe quantization --channel green --output blocks.png
npm run cli -- pipeline photo.jpg --output enhanced.png
npm run cli -- tool photo.jpg --tool median --output median.png
npm run cli -- tool photo.jpg --tool brightness --amount -25 --output darker.png
npm run cli -- batch a.jpg b.png --output ./results
```

Commands write a JSON report to stdout; image commands write PNGs. Batch keeps going on individual errors and exits with code 1 if any image failed. Input is limited to 50 MB, 16 million pixels and 8,192 pixels per side. `sharp` reads common formats including JPEG, PNG, WebP and BMP. The CLI applies EXIF orientation and converts to sRGB before processing; browser and CLI decoding may still differ slightly by platform. PNG hashes describe the exported file and can differ between encoders; raster hashes describe decoded RGBA8 pixels.

## AI providers

The browser defaults to Lovable AI. To use Gemini, configure `GEMINI_API_KEY` as a **server-side secret** in the deployment environment and select **Google Gemini** in the AI suggestions panel. Locally, put the secret in your shell environment or an untracked `.env.local`. Optional `GEMINI_MODEL` defaults to `gemini-3.8-flash`. Lovable continues using server-side `LOVABLE_API_KEY`.

```sh
GEMINI_API_KEY=your-key npm run cli -- suggest photo.jpg
# Or, with a configured Lovable environment:
npm run cli -- suggest photo.jpg --ai-provider lovable
```

Only `suggest` calls a remote provider. The browser sends a downscaled preview and measurements, while the CLI sends a downscaled JPEG. No key is sent to the browser or written to receipts or reports. Gemini uses the Interactions API with `store: false`; review the provider's own data handling policies before submitting private images.

## Next enhancements

The research-backed issue collection orders independent work by value and validation effort:

1. [C2PA credential verification](https://github.com/Skyelabz210/image-magic-automagic/issues/2): validate the original file, show signer trust and ingredient lineage beside local receipts. The C2PA 2.4 spec and browser/Node SDKs provide an implementation path.
2. [Reliability Lab](https://github.com/Skyelabz210/image-magic-automagic/issues/3): measure probe behavior under JPEG recompression, resampling and multi-step edits before adding confidence language. HSIM/RITA and ForensicHub provide benchmark candidates.
3. [Optional learned restoration](https://github.com/Skyelabz210/image-magic-automagic/issues/4): compare PixRestore and current enhancement using paired images, latency and artifact inspection; gate optional WebGPU support on a measured runtime budget.
4. [Interactive analyst workflow](https://github.com/Skyelabz210/image-magic-automagic/issues/5): multi-region comparison, grounded questions through the configured AI provider, and an optional licensed SAM 3 mask adapter.

The region inspector in Evidence Lab and the `cli region` command are the first step in this workflow. Additional needs include reversible edit history, complete pipeline export manifests and batch memory cleanup.

The repository is synced to Lovable. Preserve published Git history when contributing.
