# Third-party notices

## CRAM-DSP browser probe ports

The KELD, lane-comb, block-GCD, and background-step algorithms in
`artifacts/digisl-image-processing/src/lib/processing.ts` are adapted from
`cram_dsp/core.py` and `cram_dsp/forensics.py` in the CRAM-DSP archive supplied
with this repository. Author: Anthony Diaz, HackFate Research.

The browser port selects an existing RGB channel, inspects only fully opaque
8-bit samples, and includes partial edge blocks. These adaptations are
specified in the README and recorded in receipts.

MIT License

Copyright (c) 2026 Anthony Diaz (HackFate Research)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Archimedes reference imagery

The existing PNGs under `artifacts/digisl-image-processing/public/reference/`
are displayed as reference outputs. The source archive identifies the
Archimedes Palimpsest digital release as CC BY 3.0: the Owner of the
Archimedes Palimpsest, with imaging by W. A. Christens-Barry,
R. L. Easton Jr., and K. T. Knox. Source mirror: https://mirrors.rit.edu/archie/.
License: https://creativecommons.org/licenses/by/3.0/.
Reference processing and renderings: Anthony Diaz, HackFate Research.
These PNGs are derived visualizations, rather than the original sensor arrays.
