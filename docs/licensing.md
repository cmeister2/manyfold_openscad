# Licensing

Copyright (C) 2026 Max Dymond. Original Manyfold OpenSCAD plugin code is licensed under **AGPL-3.0-only**. The license text is in [LICENSE](../LICENSE). This is compatible with the [Manyfold host's AGPLv3 license](https://github.com/manyfold3d/manyfold/blob/v0.150.0/LICENSE.md).

Vendored components retain their own licenses, copyright notices and exceptions:

- **OpenSCAD** is GPL-2.0-or-later with its CGAL linking exception. The GPLv3 option permits combination with AGPLv3; this does not replace OpenSCAD's upstream terms. See [the packaged COPYING](../vendor/openscad/COPYING), [upstream license declaration](https://github.com/openscad/openscad/blob/ce5039f8a9545ad5a8cf197b3ca11c0939bc67f1/resources/html/AboutDialog.html) and [GNU compatibility guidance](https://www.gnu.org/licenses/gpl-faq.en.html#AGPLGPL).
- **DejaVu Sans 2.37** is unmodified and retains the notices in [FONT-LICENSE](../vendor/openscad/FONT-LICENSE).
- OpenSCAD's compiled dependencies retain their upstream terms. The [upstream Playground license inventory](https://github.com/openscad/openscad-playground/blob/main/LICENSE.md) provides useful references; its UI libraries are not bundled by this plugin.

## Renderer source references

The packaged renderer is **OpenSCAD-2025.03.25.wasm24456**, using OpenSCAD revision **ce5039f8a9545ad5a8cf197b3ca11c0939bc67f1**. [build.lock.json](../vendor/openscad/build.lock.json) records the official archive URL and checksums.

- [Pinned OpenSCAD source](https://github.com/openscad/openscad/tree/ce5039f8a9545ad5a8cf197b3ca11c0939bc67f1), including its recursive submodule references.
- [Pinned WASM build configuration](https://github.com/openscad/openscad/blob/ce5039f8a9545ad5a8cf197b3ca11c0939bc67f1/.circleci/config.yml) and [Docker build helper](https://github.com/openscad/openscad/blob/ce5039f8a9545ad5a8cf197b3ca11c0939bc67f1/scripts/wasm-base-docker-run.sh).
- [Official WASM dependency build project](https://github.com/openscad/openscad-wasm).

These references identify the source and upstream build recipes; they do not certify a complete audited source inventory for every compiled dependency. Redistributors must preserve notices and provide the corresponding source required by the applicable licenses. See [GNU source-distribution guidance](https://www.gnu.org/licenses/gpl-faq.en.html#SourceAndBinaryOnDifferentSites).

SCAD inputs and generated STL files do not become GPL merely because OpenSCAD processes them. Their own content and licensing determine their terms. [OpenSCAD GPL, section 0](https://github.com/openscad/openscad/blob/ce5039f8a9545ad5a8cf197b3ca11c0939bc67f1/COPYING)
