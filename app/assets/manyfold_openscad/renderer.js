import {assertSource, RendererError} from "./parameters.js";
export {RendererError} from "./parameters.js";

export class Renderer {
  constructor(options = {}) {
    this.options = {
      workerUrl: new URL("./worker.js", import.meta.url).href,
      engineUrl: new URL("./openscad.js", import.meta.url).href,
      timeoutMs: 120000,
      maxSourceBytes: 1048576,
      maxOutputBytes: 33554432,
      ...options
    };
    this.options.engineUrl = new URL(this.options.engineUrl, import.meta.url).href;
    this.options.wasmUrl ||= new URL("./openscad.wasm", this.options.engineUrl).href;
    this.options.fontUrl ||= new URL("./DejaVuSans.ttf", this.options.engineUrl).href;
    this.worker = null;
    this.pending = null;
    this.disposed = false;
  }

  discover(source) { return this.run("discover", source); }
  generate(source, values = {}) { return this.run("generate", source, values); }

  run(operation, source, values) {
    if (this.disposed) return Promise.reject(new RendererError("DISPOSED", "The customizer has been closed."));
    if (this.pending) return Promise.reject(new RendererError("BUSY", "An OpenSCAD operation is already running."));
    try { assertSource(source, this.options.maxSourceBytes); } catch (error) { return Promise.reject(error); }
    if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") {
      return Promise.reject(new RendererError("UNSUPPORTED", "This browser does not support Web Workers and WebAssembly. Use a current desktop browser."));
    }
    if (typeof location !== "undefined") {
      for (const key of ["workerUrl", "engineUrl", "wasmUrl", "fontUrl"]) {
        if (new URL(this.options[key], location.href).origin !== location.origin) {
          return Promise.reject(new RendererError("ASSET", "The OpenSCAD renderer assets must be served by this Manyfold instance."));
        }
      }
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(this.pending?.timer);
        this.worker?.terminate();
        this.worker = null;
        this.pending = null;
        error ? reject(error) : resolve(result);
      };
      this.pending = {finish};
      try {
        this.worker = new Worker(this.options.workerUrl, {type: "module", name: "manyfold-openscad"});
        this.worker.onmessage = ({data}) => {
          if (data.error) finish(new RendererError(data.error.code, data.error.message, data.error.warnings));
          else finish(null, data.result);
        };
        this.worker.onerror = event => {
          event.preventDefault?.();
          finish(new RendererError("RENDER", event.message || "The OpenSCAD worker failed. Try a smaller model or a current desktop browser."));
        };
        this.worker.onmessageerror = () => finish(new RendererError("RENDER", "The OpenSCAD worker returned an unreadable result."));
        this.pending.timer = setTimeout(() => finish(new RendererError("TIMEOUT", "OpenSCAD exceeded the configured generation timeout. Try a simpler model or smaller values.")), this.options.timeoutMs);
        this.worker.postMessage({operation, source, values, options: this.options});
      } catch (error) {
        finish(new RendererError("UNSUPPORTED", `The OpenSCAD worker could not start: ${error.message}`));
      }
    });
  }

  cancel() {
    this.pending?.finish(new RendererError("CANCELLED", "Generation cancelled."));
  }

  dispose() {
    this.cancel();
    this.disposed = true;
  }
}
