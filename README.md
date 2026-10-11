# OpenSCAD Customizer for Manyfold

Change the size of a box, turn a lid on or off, or tweak any settings a model's author has exposed. This plugin brings OpenSCAD's Customizer into Manyfold, so you can preview your changes and save or download an STL without editing the SCAD file.

Rendering happens in your browser. OpenSCAD comes bundled with the plugin, so it works without an internet connection.

## Install

This plugin requires **Manyfold 0.150.0 or newer** and has been tested with 0.150.0. Back up your database before installing or upgrading.

1. Upload `manyfold_openscad.zip` under **Settings > Plugins**. Keep the same ZIP filename when updating.
2. Restart Manyfold and its background workers. In Docker, Manyfold runs the plugin's database migrations automatically during startup.

For a non-Docker installation, run `bundle exec rails db:prepare:with_data` from your Manyfold installation before restarting the application and its workers.

You can also extract the ZIP into `$PLUGINS_PATH/manyfold_openscad/` before restarting. See [Manyfold's plugin guide](https://manyfold.app/sysadmin/plugins) for that setup.

## Customize a model

Open a model's menu and choose **Customize**, then pick a `.scad` file. Change its settings and click **Generate STL**. Drag the preview to rotate it, or use the mouse wheel to zoom. **Reset** puts the settings back to the author's defaults.

Choose **Download STL** to keep a local copy, or **Save variant** to add it to the model in Manyfold. Saving requires permission to edit that model and a new filename. Your original SCAD file stays untouched.

If you change a setting, generate again before downloading or saving. You can cancel a slow render and try again. After saving, Manyfold may take a little time to process the new file; the page shows its progress.

Saved variants remember their settings. Use **Reopen** to pick up where you left off, or **Download manifest** to get a JSON record of how the variant was made. If the source SCAD file has changed, the page will tell you before restoring the old settings.

## What works today

Models need to fit in a single, self-contained SCAD file. `include`, `use`, `import` and `surface` aren't supported yet.

Controls come from OpenSCAD's usual Customizer settings, including checkboxes, numbers, text, dropdowns and numeric vectors. Groups, labels, bounds and steps carry through, and hidden settings stay hidden. Text geometry uses the bundled DejaVu Sans font.

This plugin has been tested in Chromium. Other browsers, mobile devices and large models still need more testing. Large renders can use a lot of browser memory. Cancel a slow render, or try a smaller model if rendering fails.

The default limits are:

| Limit | Default | Environment variable |
| --- | --- | --- |
| SCAD file size | 1 MiB | `OPENSCAD_MAX_SOURCE_BYTES` |
| Generated STL size | 32 MiB | `OPENSCAD_MAX_OUTPUT_BYTES` |
| Time per operation | 120 seconds | `OPENSCAD_GENERATION_TIMEOUT_MS` |

Set these variables before restarting Manyfold if you need different limits. See the [validation notes](docs/renderer-validation.md) for the checks and measurements so far.

## Try it in Docker

From a checkout of this repository, start the development instance:

```sh
docker compose up --build -d --wait
docker compose exec manyfold bundle exec rails runner /plugins/manyfold_openscad/docker/load-examples.rb
```

Open [Manyfold on localhost:3216](http://localhost:3216). The setup creates a local administrator and a library, and the example loader adds two boxes:

- [Simple box](http://localhost:3216/manyfold_openscad/models/openscadbox/customize) — just width, depth and height ([SCAD](test/fixtures/simple_box.scad)).
- [Featureful box](http://localhost:3216/manyfold_openscad/models/openscadcontrols/customize) — more controls to try ([SCAD](test/fixtures/customizer_box.scad)).

The loader leaves existing example files alone. Development data stays in the Docker volume. Set `OPENSCAD_PORT` to use another port, and restart after code changes.

## Development

You'll need Node 24.15+ and Python 3. Docker provides Ruby and Manyfold; you don't need to install OpenSCAD separately.

```sh
npm ci --ignore-scripts
bin/test
npx playwright install chromium
npm run test:browser
```

`bin/test` covers the browser code, real OpenSCAD renders, release tools, and packaging. It also tests the Rails integration from both the checkout and a built ZIP, using disposable containers. Set `OPENSCAD_TEST_IMAGE` to use a compatible cached Manyfold image.

To build the plugin ZIP:

```sh
python3 bin/package 0.1.0
```

You'll find it at `dist/manyfold_openscad.zip`, with both example SCAD files included. Releases use Conventional Commits. The [renderer notes](vendor/openscad/README.md) explain how to verify or download the pinned OpenSCAD files.

## License

Copyright (C) 2026 Max Dymond. This plugin's code is licensed under **AGPL-3.0-only**; see [LICENSE](LICENSE). Bundled OpenSCAD and DejaVu Sans keep their own licenses. The [licensing notes](docs/licensing.md) have the details and links to the renderer's source.
