import {assertSource, createPreset, normalizeMetadata, RendererError} from "./parameters.js";

export const ENGINE_BUILD = "OpenSCAD-2025.03.25.wasm24456";
export const RENDER_OPTIONS = Object.freeze({backend: "Manifold", format: "binstl"});

function loadingFailure(error, asset) {
  if (error instanceof RangeError || /out of memory|cannot enlarge memory|could not allocate memory|memory allocation failed/i.test(String(error))) {
    return new RendererError("RENDER", "OpenSCAD could not allocate enough memory. Try a simpler model or another device.");
  }
  return new RendererError("ASSET", `The local OpenSCAD ${asset} could not be loaded. Ask the administrator to check the plugin's installed assets and security policy.`);
}

// The injectable engine keeps actual WASM integration checks usable under Node.
export async function runOpenSCAD(request, dependencies = {}) {
  const {operation, source, values = {}, options = {}} = request;
  assertSource(source, options.maxSourceBytes);
  if (operation !== "discover" && operation !== "generate") throw new RendererError("RENDER", "Unknown OpenSCAD operation.");
  const start = performance.now();
  const diagnostics = [];
  let logBytes = 0;
  let truncated = false;
  const log = text => {
    const line = String(text);
    if (!/^(WARNING:|ERROR:|DEPRECATED:|Fontconfig error:|Current top level)/.test(line)) return;
    if (logBytes + line.length <= 65536) { diagnostics.push(line); logBytes += line.length; }
    else truncated = true;
  };
  let OpenSCAD;
  try { OpenSCAD = dependencies.OpenSCAD || (await import(options.engineUrl)).default; }
  catch (error) { throw loadingFailure(error, "engine"); }
  const instantiate = async () => {
    try {
      return await OpenSCAD({
        noInitialRun: true,
        locateFile: path => path.endsWith(".wasm") ? options.wasmUrl : new URL(path, options.engineUrl).href,
        print: log,
        printErr: log,
        ...(dependencies.wasmBinary ? {wasmBinary: dependencies.wasmBinary} : {})
      });
    } catch (error) { throw loadingFailure(error, "WebAssembly engine"); }
  };
  let instance = await instantiate();
  const warnings = () => {
    const found = diagnostics.filter(line => /^(WARNING:|ERROR:|DEPRECATED:|Fontconfig error:)/.test(line));
    if (truncated) found.push("OpenSCAD produced more diagnostic messages than can be displayed.");
    return found;
  };
  const invoke = args => {
    let status;
    try { status = instance.callMain(args); }
    catch (error) {
      throw new RendererError("RENDER", `OpenSCAD failed: ${String(error)}`, warnings());
    }
    if (status !== 0) {
      const empty = diagnostics.some(line => line.includes("top level object is empty") || line.includes("not a 3D object"));
      throw new RendererError(empty ? "EMPTY" : "RENDER", empty ? "This model produced no 3D geometry with these settings. Only 3D STL geometry is supported." : "OpenSCAD could not generate this model. Check the messages below.", warnings());
    }
  };
  instance.FS.mkdir("/locale");
  instance.FS.writeFile("/input.scad", source);
  invoke(["/input.scad", "-o", "/input.param"]);
  let metadata;
  try { metadata = normalizeMetadata(JSON.parse(instance.FS.readFile("/input.param", {encoding: "utf8"}))); }
  catch (error) {
    if (error instanceof RendererError) throw error;
    throw new RendererError("METADATA", "OpenSCAD could not read the Customizer metadata.", warnings());
  }
  if (operation === "discover") {
    return {...metadata, warnings: [...metadata.warnings, ...warnings()], engineBuild: ENGINE_BUILD, elapsedMs: performance.now() - start};
  }
  const preset = createPreset(metadata.parameters, values);
  // This pinned CLI build exits its runtime after callMain. Rendering requires a
  // fresh instance; the worker itself is terminated after this operation.
  instance = null;
  let font = dependencies.fontBytes;
  if (!font) {
    try {
      const response = await fetch(options.fontUrl, {credentials: "same-origin"});
      if (!response.ok) throw new Error("Font asset request failed");
      font = await response.arrayBuffer();
    } catch (error) { throw loadingFailure(error, "font asset"); }
  }
  instance = await instantiate();
  instance.FS.mkdir("/locale");
  instance.FS.writeFile("/input.scad", source);
  instance.FS.writeFile("/parameters.json", preset);
  instance.FS.mkdir("/fonts");
  instance.FS.writeFile("/fonts/DejaVuSans.ttf", new Uint8Array(font));
  instance.FS.writeFile("/fonts/fonts.conf", '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>/fonts</dir><cachedir>/tmp/fontconfig</cachedir></fontconfig>');
  invoke(["/input.scad", "-p", "/parameters.json", "-P", "manyfold", "--backend=Manifold", "--export-format=binstl", "-o", "/output.stl"]);
  const size = instance.FS.stat("/output.stl").size;
  if (size > (options.maxOutputBytes ?? 33554432)) {
    throw new RendererError("OUTPUT_LIMIT", "The generated STL exceeds the configured output size limit.", warnings());
  }
  const stl = instance.FS.readFile("/output.stl");
  if (stl.byteLength < 84 || new DataView(stl.buffer, stl.byteOffset, stl.byteLength).getUint32(80, true) === 0) {
    throw new RendererError("EMPTY", "This model produced no triangles. Only 3D STL geometry is supported.", warnings());
  }
  return {stl: stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength), warnings: [...new Set([...metadata.warnings, ...warnings()])], engineBuild: ENGINE_BUILD, renderOptions: RENDER_OPTIONS, generatedAt: new Date().toISOString(), elapsedMs: performance.now() - start};
}

if (typeof self !== "undefined" && typeof self.postMessage === "function" && typeof document === "undefined") {
  self.onmessage = async ({data}) => {
    try {
      const result = await runOpenSCAD(data);
      self.postMessage({result}, result.stl ? [result.stl] : []);
    } catch (error) {
      self.postMessage({error: {code: error.code || "RENDER", message: error.message || String(error), warnings: error.warnings || []}});
    }
  };
}
