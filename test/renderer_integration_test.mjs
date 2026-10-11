import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import OpenSCAD from "../vendor/openscad/openscad.js";
import {runOpenSCAD, ENGINE_BUILD} from "../app/assets/manyfold_openscad/worker.js";
import {normalizeMetadata, createPreset, validateValues, assertSelfContained} from "../app/assets/manyfold_openscad/parameters.js";

const wasmBinary = await readFile(new URL("../vendor/openscad/openscad.wasm", import.meta.url));
const fontBytes = await readFile(new URL("../vendor/openscad/DejaVuSans.ttf", import.meta.url));
const dependencies = {OpenSCAD, wasmBinary, fontBytes};
const fixture = await readFile(new URL("fixtures/customizer_box.scad", import.meta.url), "utf8");
const simpleBoxUrl = new URL("fixtures/simple_box.scad", import.meta.url);
const simpleBox = await readFile(simpleBoxUrl, "utf8");
const run = (operation, source = fixture, values = {}, options = {}) => runOpenSCAD({operation, source, values, options}, dependencies);

function bounds(stl) {
  const data = new DataView(stl);
  const count = data.getUint32(80, true);
  assert.equal(stl.byteLength, 84 + count * 50);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let triangle = 0; triangle < count; triangle++) {
    for (let vertex = 0; vertex < 3; vertex++) {
      for (let axis = 0; axis < 3; axis++) {
        const value = data.getFloat32(84 + triangle * 50 + 12 + vertex * 12 + axis * 4, true);
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      }
    }
  }
  return {min, max};
}

test("very simple box renders the width edit from 100 to 150 mm without changing source", async () => {
  const before = createHash("sha256").update(simpleBox).digest("hex");
  const discovered = await run("discover", simpleBox);
  assert.deepEqual(discovered.parameters.map(parameter => parameter.name), ["width", "depth", "height"]);
  const original = await run("generate", simpleBox);
  const edited = await run("generate", simpleBox, {width: 150});
  assert.deepEqual(bounds(original.stl), {min: [0, 0, 0], max: [100, 80, 40]});
  assert.deepEqual(bounds(edited.stl), {min: [0, 0, 0], max: [150, 80, 40]});
  assert.equal(createHash("sha256").update(await readFile(simpleBoxUrl)).digest("hex"), before);
});

test("pinned engine exports actual Customizer labels, groups, vectors, options and hidden fields", async () => {
  const result = await run("discover");
  assert.equal(result.engineBuild, ENGINE_BUILD);
  assert.equal(result.parameters.length, 8);
  assert.equal(result.parameters.some(parameter => parameter.name === "internal"), false);
  const width = result.parameters.find(parameter => parameter.name === "width");
  assert.deepEqual(width, {name: "width", label: "Overall width in millimetres", description: "Overall width in millimetres", group: "Dimensions", type: "number", default: 100, min: 10, max: 200, step: 5});
  const offset = result.parameters.find(parameter => parameter.name === "offset");
  assert.equal(offset.type, "vector");
  assert.equal(offset.vectorLength, 3);
  assert.deepEqual(offset.default, [0, 0, 0]);
  assert.equal(result.parameters.find(parameter => parameter.name === "label").default, 'A "quoted" box');
  assert.deepEqual(result.parameters.find(parameter => parameter.name === "finish").options, [{value: "smooth", label: "Smooth"}, {value: "rough", label: "Rough"}]);
  assert.deepEqual(result.warnings, []);
});

test("width edit changes real STL bounds and source bytes stay unchanged", async () => {
  const digest = createHash("sha256").update(fixture).digest("hex");
  const original = await run("generate");
  const edited = await run("generate", fixture, {width: 150, offset: [2, 3, 4], lid: true});
  assert.deepEqual(bounds(original.stl), {min: [0, 0, 0], max: [100, 80, 40]});
  assert.deepEqual(bounds(edited.stl), {min: [2, 3, 4], max: [152, 83, 44]});
  assert.equal(createHash("sha256").update(fixture).digest("hex"), digest);
  assert.deepEqual(edited.renderOptions, {backend: "Manifold", format: "binstl"});
});

test("quoted parameter strings remain literal and cannot change source expressions", async () => {
  const text = '\"; cube(999); // \\ next\nline';
  const source = `// Label\nlabel = "default";\nexpected = ${JSON.stringify(text)};\ncube([label == expected ? 17 : 2, 3, 4]);`;
  const result = await run("generate", source, {label: text});
  assert.deepEqual(bounds(result.stl).max, [17, 3, 4]);
});

test("numeric vectors, numbers and booleans must retain their metadata types and bounds", async () => {
  const {parameters} = await run("discover");
  for (const values of [{width: "150"}, {width: 201}, {width: 101}, {lid: "false"}, {offset: [0, "1", 2]}, {offset: [0, 0]}, {internal: 2}, {finish: "other"}, {width: Infinity}]) {
    assert.throws(() => validateValues(parameters, values), error => error.code === "PARAMETERS");
  }
  const defaults = validateValues(parameters, {});
  assert.equal(defaults.width, 100);
  assert.deepEqual(defaults.offset, [0, 0, 0]);
  const preset = JSON.parse(createPreset(parameters, {width: 150, lid: true}));
  assert.equal(preset.fileFormatVersion, "1");
  assert.equal(preset.parameterSets.manyfold.width, "150");
  assert.equal(preset.parameterSets.manyfold.lid, "true");
  assert.equal(preset.parameterSets.manyfold.label, 'A "quoted" box');
  assert.throws(() => validateValues(parameters, new Date()), error => error.code === "PARAMETERS");
});

test("source defaults outside the documented step lattice remain usable after reset", async () => {
  const source = 'x=2.5; // [0:1:10]\ncube(x);';
  const metadata = await run("discover", source);
  assert.equal(metadata.parameters[0].allowOffStepDefault, true);
  assert.equal(validateValues(metadata.parameters, {}).x, 2.5);
  assert.throws(() => validateValues(metadata.parameters, {x: 3.5}), error => error.code === "PARAMETERS");
  assert.deepEqual(bounds((await run("generate", source)).stl).max, [2.5, 2.5, 2.5]);
});

test("dependency lexer ignores quoted strings and comments and rejects unsupported file operations", async () => {
  assert.doesNotThrow(() => assertSelfContained('// include <file>\n/* import("file"); */\na="use <file> and surface(\\\"file\\\")"; cube(1);'));
  for (const source of ['include /*comment*/ <foo.scad>', 'use <x.scad>', 'import(file="x.stl");', 'surface("image.png");', 'a=dxf_dim(file="x.dxf");', 'a=dxf_cross(file="x.dxf");']) {
    await assert.rejects(run("discover", source), error => error.code === "DEPENDENCY");
  }
});

test("empty geometry, syntax failure, output limit and source limit are recoverable", async () => {
  await assert.rejects(run("generate", "cube([0,0,0]);"), error => error.code === "EMPTY");
  await assert.rejects(run("generate", "circle(10);"), error => error.code === "EMPTY");
  await assert.rejects(run("generate", "cube([);"), error => error.code === "RENDER");
  await assert.rejects(run("generate", "cube(10);", {}, {maxOutputBytes: 100}), error => error.code === "OUTPUT_LIMIT");
  await assert.rejects(run("generate", "cube(10);", {}, {maxSourceBytes: 1}), error => error.code === "SOURCE_LIMIT");
  assert.equal((await run("generate", "cube(10);")).stl.byteLength, 684);
});

test("OpenSCAD warnings remain visible alongside successful output", async () => {
  const result = await run("generate", "cube([10,10,missing_value]); cube(2);");
  assert.ok(result.stl.byteLength > 84);
  assert.ok(result.warnings.some(line => line.includes("missing_value")));
});

test("text geometry uses only the locally packaged font", async () => {
  const result = await run("generate", 'linear_extrude(2)text("Offline");');
  assert.ok(result.stl.byteLength > 684);
  assert.deepEqual(result.warnings, []);
});

test("unsupported metadata is reported while no-parameter sources remain discoverable", async () => {
  assert.deepEqual((await run("discover", "cube(1);")).parameters, []);
  assert.deepEqual(normalizeMetadata({parameters: [{name: "other", type: "unsupported", initial: null}]}).parameters, []);
  assert.equal(normalizeMetadata({parameters: [{name: "other", type: "unsupported", initial: null}]}).warnings.length, 1);
});

test("missing engine modules and invalid WASM identify installed asset failures", async () => {
  await assert.rejects(runOpenSCAD({operation: "discover", source: simpleBox, options: {engineUrl: new URL("fixtures/nonexistent-engine.js", import.meta.url).href}}), error => error.code === "ASSET" && error.message.includes("administrator"));
  await assert.rejects(runOpenSCAD({operation: "discover", source: simpleBox}, {OpenSCAD, wasmBinary: new Uint8Array([0, 1, 2])}), error => error.code === "ASSET" && error.message.includes("WebAssembly engine"));
  await assert.rejects(runOpenSCAD({operation: "discover", source: simpleBox}, {OpenSCAD: async () => { throw new RangeError("WebAssembly.Memory(): could not allocate memory"); }}), error => error.code === "RENDER" && error.message.includes("memory"));
  assert.equal((await run("generate", simpleBox)).stl.byteLength, 684);
});
