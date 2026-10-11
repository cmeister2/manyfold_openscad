# Renderer feasibility and validation

The plugin is implemented as a mounted Rails engine against Manyfold 0.150.0.
It registers the existing model-menu hook and appends its migration directory.
The host needs no source change. Manyfold's Docker startup runs
`db:prepare:with_data`, which includes the plugin's migrations. Installation
requires an application/job-process restart; non-Docker installations need to
run the database preparation task before restarting.

## Locked engine and offline packaging

The engine is **OpenSCAD-2025.03.25.wasm24456**, source revision
`ce5039f8a9545ad5a8cf197b3ca11c0939bc67f1`. The official archive's published
SHA256 was verified before extraction. Metadata export to `.param` and STL export
with Manifold were verified using the actual checked-in WASM, rather than a
replacement parser or mocked renderer. See [the renderer lock and acquisition
instructions](../vendor/openscad/README.md).

The roughly 9.2 MiB WASM, 124 KiB glue module, 740 KiB font, application modules,
styles, licenses and documentation ship in the release ZIP. The engine-owned
asset endpoint supplies JavaScript, WASM and font MIME types through a fixed
allowlist. Page and worker CSP permit `wasm-unsafe-eval`; ordinary pages retain
the host policy. Browser checks block every request outside the local test
installation, including worker requests. No runtime library download is enabled.

The pinned CLI closes its runtime after `callMain`. Discovery and generation
therefore use fresh instances; each operation owns one worker, which is
terminated on completion, cancellation, timeout and page disposal.

## Fixtures and coverage

[simple_box.scad](../test/fixtures/simple_box.scad) is the primary geometry
fixture: three dimensions followed by `cube([width, depth, height])`. Its default
bounds are 100 × 80 × 40 mm; changing width produces 150 × 80 × 40 mm, with the
source bytes unchanged. The browser downloads and parses that actual STL, saves
it through Manyfold, retrieves its manifest and reopens its typed settings.

[customizer_box.scad](../test/fixtures/customizer_box.scad) separately covers
captions, Dimensions/Appearance groups, hidden fields, booleans, string and
numeric choices, numeric vectors, ranges, steps, quoted strings and reset.
Additional actual-engine fixtures cover empty output, malformed sources,
warnings with successful geometry, unavailable dependencies, local text/font
geometry and limits. Original defaults outside the documented step lattice
remain valid on load/reset, while edited values obey the documented steps.

Rails integration tests use a clean SQLite database and filesystem library in a
network-isolated host container, against both the checkout and extracted release
ZIP. They cover current source/output policies, permission revocation, CSRF,
digest mismatches, filenames and collisions, typed metadata, manifests/reopen,
idempotent requests, cached-upload promotion and recovery after a lost cache.
Browser coverage also exercises a lost successful save response, retry without
regeneration, stale output, preview rotation, no exposed parameters, unsupported
browsers, cancellation, timeout/recovery and persistent warnings.

Object-storage source reading is exercised through an actual Shrine Memory
storage adapter, proving that it does not depend on a filesystem path. A real
S3-compatible deployment has not been exercised here; verify source reads,
attachment promotion and processing in that deployment before adopting it.

## Measurements and operating limits

Measurements on 11 October 2026 used Chromium on Linux with an AMD Ryzen 7 PRO
7840U. They measure small fixtures, rather than general CAD compatibility.
The browser suite prints timings to make local reproduction straightforward.
In the final clean-container run, desktop page-to-controls startup took
**821 ms**; generating and enabling the preview/download took **334 ms**.
With Chromium's **4× CPU throttle**, worker metadata discovery took **144 ms**
and generation **263 ms**; a binary cube STL was **684 bytes**.
Worker timings exclude page navigation, UI setup and worker startup overhead.
CPU throttling is an approximation of a slower client, not a measurement on a
physical low-memory device.

These fixture measurements leave substantial headroom under the configurable
defaults: **1 MiB source, 32 MiB output and 120 seconds per worker operation**.
The preview limits itself to 300,000 triangles and explains when a valid STL is
too large to preview; download and saving remain available. These byte limits
do not cap intermediate WASM allocations. Browser memory cannot be bounded
reliably. Memory/startup failure classification, termination and a fresh-attempt
recovery path are tested, but physical low-memory testing and larger-model
measurements remain deployment checks.

The verified browser is Chromium. Other current desktop browser engines need
verification; mobile support is not claimed. Model-relative includes, imported assets and shared libraries remain
the explicitly deferred next increment.
