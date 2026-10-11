import test from "node:test";
import assert from "node:assert/strict";
import {CustomizerState, validateParameter} from "../app/assets/manyfold_openscad/customizer.mjs";
import {parseSTL} from "../app/assets/manyfold_openscad/preview.mjs";

const parameters = [
  {name: "width", label: "Box width", group: "Dimensions", type: "number", default: 100, min: 50, max: 200, step: 5},
  {name: "lid", type: "boolean", default: true},
  {name: "caption", type: "string", default: 'A "quoted" box'},
  {name: "colour", type: "string", default: "blue", options: [{value: "blue", label: "Ocean"}, {value: "red", label: "Ruby"}]},
  {name: "offset", type: "vector", default: [0, 0, 0], min: -10, max: 10, step: 0.5},
  {name: "internal", type: "number", default: 99, hidden: true}
];

test("Customizer metadata keeps defaults typed, hides hidden fields and restores known preset values", () => {
  const state = new CustomizerState(parameters, {width: 150, caption: 'echo("do not execute");', colour: "red", offset: [1, 2, -0.5], unknown: "ignored", internal: 7});
  assert.equal(state.parameters.length, 5);
  assert.equal(state.values.width, 150);
  assert.equal(state.values.lid, true);
  assert.equal(state.values.caption, 'echo("do not execute");');
  assert.equal(state.values.colour, "red");
  assert.deepEqual(state.values.offset, [1, 2, -0.5]);
  assert.equal(Object.hasOwn(state.values, "unknown"), false);
  assert.equal(Object.hasOwn(state.values, "internal"), false);
  state.reset();
  assert.equal(state.values.width, 100);
  assert.equal(state.values.caption, 'A "quoted" box');
  assert.deepEqual(state.values.offset, [0, 0, 0]);
  assert.equal(parameters[0].default, 100);
});

test("parameters enforce types, labelled option values, vector dimensions, ranges and steps", () => {
  for (const [parameter, invalid] of [[parameters[0], 201], [parameters[0], 101], [parameters[0], "100"], [parameters[0], NaN], [parameters[1], "true"], [parameters[2], 3], [parameters[3], "Ocean"], [parameters[4], [1, 2]], [parameters[4], [0, 0, 10.5]], [parameters[4], [0, 0, 0.3]]]) {
    assert.throws(() => validateParameter(parameter, invalid), /invalid_parameters/);
  }
  assert.equal(validateParameter(parameters[0], 150), 150);
  assert.equal(validateParameter(parameters[3], "red"), "red");
  assert.deepEqual(validateParameter(parameters[4], [-10, 0, 10]), [-10, 0, 10]);
  assert.throws(() => new CustomizerState(parameters, {width: "150"}), /invalid_parameters/);
  assert.throws(() => validateParameter(parameters[2], "a".repeat(4097)), /invalid_parameters/);
});

test("off-step source defaults survive load and reset while edited numbers and vector axes obey documented increments", () => {
  const scalar = {name: "size", type: "number", default: 2.5, min: 0, max: 10, step: 1, allowOffStepDefault: true};
  const vector = {name: "shift", type: "vector", default: [0.5, 1.5, 0], min: 0, max: 10, step: 1, allowOffStepDefault: true};
  const state = new CustomizerState([scalar, vector]);
  assert.equal(state.values.size, 2.5);
  assert.deepEqual(state.values.shift, [0.5, 1.5, 0]);
  state.set("size", 4);
  state.set("shift", [4, 1.5, 3]);
  assert.throws(() => state.set("size", 3.5), /invalid_parameters/);
  assert.throws(() => state.set("shift", [1.5, 1.5, 0]), /invalid_parameters/, "defaults belong to their original vector component");
  state.reset();
  assert.equal(state.values.size, 2.5);
  assert.deepEqual(state.values.shift, [0.5, 1.5, 0]);
  assert.throws(() => validateParameter(scalar, -1), /invalid_parameters/);
});

test("every edit, invalid edit and reset invalidate generated output until explicit regeneration", () => {
  const state = new CustomizerState(parameters);
  state.generated({stl: new ArrayBuffer(4), engineBuild: "pinned"});
  assert.equal(state.canUseOutput, true);
  state.set("width", 150);
  assert.equal(state.canUseOutput, false);
  assert.equal(state.output.parameters.width, 100);
  state.set("width", 100);
  assert.equal(state.canUseOutput, false, "returning to old settings still needs generation");
  state.generated({stl: new ArrayBuffer(4)});
  assert.equal(state.canUseOutput, true);
  assert.throws(() => state.set("width", 300));
  assert.equal(state.canUseOutput, false);
  state.generated({stl: new ArrayBuffer(4)});
  state.reset();
  assert.equal(state.canUseOutput, false);
});

function binaryTriangle(vertices) {
  const bytes = new Uint8Array(134);
  const data = new DataView(bytes.buffer);
  // A binary STL header may legitimately start with "solid".
  bytes.set(new TextEncoder().encode("solid binary"));
  data.setUint32(80, 1, true);
  vertices.forEach((value, index) => data.setFloat32(96 + index * 4, value, true));
  return bytes;
}

test("preview accepts binary and ASCII STL and reports actual geometry bounds", () => {
  const coordinates = [-1, 0, 3, 150, 0, 3, 0, 20, 5];
  const binary = parseSTL(binaryTriangle(coordinates));
  assert.equal(binary.triangles, 1);
  assert.deepEqual(binary.bounds, {min: [-1, 0, 3], max: [150, 20, 5]});
  const ascii = parseSTL(new TextEncoder().encode("solid box\nfacet normal 0 0 1\nouter loop\nvertex -1 0 3\nvertex 150 0 3\nvertex 0 20 5\nendloop\nendfacet\nendsolid box\n"));
  assert.deepEqual([...ascii.vertices], coordinates);
  assert.deepEqual(ascii.bounds, binary.bounds);
});

test("preview rejects corrupt, nonfinite, empty and excessive meshes", () => {
  assert.throws(() => parseSTL(new TextEncoder().encode("solid empty\nendsolid empty")), /empty_geometry/);
  assert.throws(() => parseSTL(new TextEncoder().encode("solid bad\nvertex 1 2 3\nendsolid bad")), /invalid_mesh/);
  assert.throws(() => parseSTL(new TextEncoder().encode("random text")), /invalid_mesh/);
  assert.throws(() => parseSTL(binaryTriangle([Infinity, 0, 0, 0, 1, 0, 0, 0, 1])), /invalid_mesh/);
  assert.throws(() => parseSTL(binaryTriangle([0, 0, 0, 0, 1, 0, 0, 0, 1]), 0), /preview_too_large/);
});
