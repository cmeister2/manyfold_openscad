# Pinned local OpenSCAD renderer

These files are upstream assets, not a copy of the hosted Playground UI.
`openscad.js` and `openscad.wasm` are the official web build
`OpenSCAD-2025.03.25.wasm24456`. The engine embeds source revision
`ce5039f8a9545ad5a8cf197b3ca11c0939bc67f1`.

The selected engine is the build named in [OpenSCAD Playground's configuration](https://github.com/openscad/openscad-playground/blob/012111f06bb6d8dac2b8d30318512494d87d6932/libs-config.json).
Its archive checksum matches [the checksum published by OpenSCAD](https://files.openscad.org/playground/OpenSCAD-2025.03.25.wasm24456-WebAssembly-web.zip.sha256).
The adapter calls OpenSCAD's real `.param` exporter, then renders with the
Manifold backend and binary STL output. Hidden fields are omitted by the exporter.
Parameter choices, groups, captions, bounds, steps and numeric vectors are taken
from that JSON, never reconstructed from source lines.

`DejaVuSans.ttf` is unmodified DejaVu Sans from the upstream 2.37 release.
The worker configures Fontconfig using only its local `/fonts` directory.
Additional fonts and shared SCAD libraries are outside this MVP. Fontconfig can
substitute DejaVu Sans when a source names another family; authors should inspect
text geometry before saving.

OpenSCAD is distributed under GPL-2.0-or-later, with its CGAL linking exception;
see `COPYING`. Font licensing and copyright notices are in `FONT-LICENSE`.
The corresponding [OpenSCAD source and build scripts](https://github.com/openscad/openscad/tree/ce5039f8a9545ad5a8cf197b3ca11c0939bc67f1)
are identified by the pinned revision in `build.lock.json`; retain that source
availability and upstream third-party notices when redistributing the renderer.
For source builds, use upstream's `scripts/wasm-base-docker-run.sh` and the WASM
build configuration in `.circleci/config.yml` at that revision.
This repository pins and verifies the official prebuilt bytes; it does not claim
that recompiling a newer toolchain produces a byte-identical WASM file.

Run `bin/build-renderer --verify` to check all packaged bytes offline.
Run `bin/build-renderer --download` to reacquire exactly the locked engine,
license and font files. All downloads are verified before replacing local files.
The lock specifies each extracted file's SHA256, upstream URLs and source revision.
After installation, the browser requests only the local plugin asset endpoint.
The engine has no external source filesystem, dependency mount, CDN, or library
fetcher. `include`, `use`, `import`, `surface` and legacy DXF file queries are
rejected outside comments and string literals.

Run `node --test test/renderer*_test.mjs` to exercise the actual packaged engine
and adapter lifecycle. The fixture verifies a width edit from 100 to 150 mm by
reading the STL vertices, metadata fields, literal strings, vectors, warnings,
local text geometry, failure recovery, output/source limits, cancellation and
timeout handling. Browser checks must additionally verify local asset MIME,
page CSP, worker startup, offline generation and preview interaction.

The pinned CLI exits its runtime after each `callMain`; metadata discovery and
rendering use fresh instances. Each operation runs inside one short-lived Web
Worker. Cancellation, timeout, completion and page disposal terminate that worker.
The browser cannot enforce a strict WASM memory ceiling. Source and output limits
bound uploaded/downloaded bytes, not intermediate geometry memory. Defaults are
1 MiB source, 32 MiB STL and 120 seconds per operation.
