import test from "node:test";
import assert from "node:assert/strict";
import {Renderer} from "../app/assets/manyfold_openscad/renderer.js";

class FakeWorker {
  static workers = [];
  constructor(url, options) {
    this.url = url;
    this.options = options;
    FakeWorker.workers.push(this);
  }
  postMessage(request) { this.request = request; }
  terminate() { this.terminated = true; }
  complete(result) { this.onmessage({data: {result}}); }
}

test("cancel and timeout terminate the active worker and the next operation starts fresh", async () => {
  const original = globalThis.Worker;
  globalThis.Worker = FakeWorker;
  try {
    const renderer = new Renderer({timeoutMs: 10});
    assert.equal(FakeWorker.workers.length, 0);
    const cancelled = renderer.generate("cube(10);");
    const first = FakeWorker.workers.at(-1);
    await assert.rejects(renderer.generate("cube(10);"), error => error.code === "BUSY");
    renderer.cancel();
    await assert.rejects(cancelled, error => error.code === "CANCELLED");
    assert.equal(first.terminated, true);
    const timedOut = renderer.generate("cube(10);");
    const second = FakeWorker.workers.at(-1);
    assert.notEqual(first, second);
    first.complete({stl: new ArrayBuffer(84)});
    assert.notEqual(second.terminated, true);
    await assert.rejects(timedOut, error => error.code === "TIMEOUT");
    assert.equal(second.terminated, true);
    const completed = renderer.generate("cube(10);");
    const third = FakeWorker.workers.at(-1);
    third.complete({stl: new ArrayBuffer(84), warnings: []});
    assert.equal((await completed).stl.byteLength, 84);
    assert.equal(third.terminated, true);
    renderer.dispose();
    await assert.rejects(renderer.generate("cube(10);"), error => error.code === "DISPOSED");
  } finally {
    globalThis.Worker = original;
  }
});

test("unsupported browsers and dependencies fail before a worker starts", async () => {
  const original = globalThis.Worker;
  globalThis.Worker = undefined;
  try {
    await assert.rejects(new Renderer().discover("cube(1);"), error => error.code === "UNSUPPORTED");
    await assert.rejects(new Renderer().discover("include <foo.scad>"), error => error.code === "DEPENDENCY");
  } finally { globalThis.Worker = original; }
});
