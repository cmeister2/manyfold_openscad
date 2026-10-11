import {MeshPreview} from "./preview.mjs";

const copy = (value) => JSON.parse(JSON.stringify(value));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const errorCodes = {unsupported: "unsupported_browser", dependency: "unsupported_dependencies", source_limit: "source_too_large", parameters: "invalid_parameters", empty: "empty_geometry", output_limit: "output_too_large", render: "render_failed", metadata: "metadata_failed", asset: "asset_failed"};

export function validateParameter(parameter, value) {
  const type = parameter.type.toLowerCase();
  if (parameter.options?.length && !parameter.options.some((option) => same(option.value, value))) throw new Error("invalid_parameters");
  const number = (item, axis = 0) => {
    if (typeof item !== "number" || !Number.isFinite(item)) throw new Error("invalid_parameters");
    if (Number.isFinite(parameter.min) && item < parameter.min) throw new Error("invalid_parameters");
    if (Number.isFinite(parameter.max) && item > parameter.max) throw new Error("invalid_parameters");
    const sourceDefault = Array.isArray(parameter.default) ? parameter.default[axis] : parameter.default;
    if (Number.isFinite(parameter.step) && parameter.step > 0 && item !== sourceDefault) {
      const steps = (item - (Number.isFinite(parameter.min) ? parameter.min : 0)) / parameter.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-7 * Math.max(1, Math.abs(steps))) throw new Error("invalid_parameters");
    }
  };
  if (type === "number") number(value);
  else if (type === "boolean" && typeof value !== "boolean") throw new Error("invalid_parameters");
  else if (type === "string" && (typeof value !== "string" || value.length > 4096)) throw new Error("invalid_parameters");
  else if (type === "vector") {
    if (!Array.isArray(value) || value.length !== parameter.default.length) throw new Error("invalid_parameters");
    value.forEach(number);
  } else if (!["number", "boolean", "string"].includes(type)) throw new Error("unsupported_parameter");
  return value;
}

export class CustomizerState {
  constructor(parameters, initialParameters = {}) {
    this.parameters = parameters.filter((parameter) => !parameter.hidden);
    this.values = Object.create(null);
    this.output = null;
    this.stale = false;
    this.revision = 0;
    for (const parameter of this.parameters) {
      const value = Object.hasOwn(initialParameters, parameter.name) ? initialParameters[parameter.name] : parameter.default;
      this.values[parameter.name] = copy(validateParameter(parameter, value));
    }
  }
  invalidate() { this.revision += 1; if (this.output) this.stale = true; }
  set(name, value) {
    const parameter = this.parameters.find((item) => item.name === name);
    if (!parameter) throw new Error("invalid_parameters");
    this.invalidate(); this.values[name] = copy(validateParameter(parameter, value));
  }
  reset() {
    this.invalidate();
    for (const parameter of this.parameters) this.values[parameter.name] = copy(parameter.default);
  }
  generated(output) { this.output = {...output, parameters: copy(this.values)}; this.stale = false; }
  get canUseOutput() { return Boolean(this.output && !this.stale); }
}

function element(tag, options = {}) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(options)) {
    if (key === "text") node.textContent = value;
    else if (key === "className") node.className = value;
    else node.setAttribute(key, String(value));
  }
  return node;
}

export class CustomizerApp {
  constructor(root, config) {
    this.root = root;
    this.config = config;
    this.strings = config.strings || {};
    this.busy = "loading";
    this.warningMessages = new Set();
    this.inputs = new Map();
    this.fetchController = new AbortController();
    this.listeners = [];
    const selectors = {form: "[data-parameters]", generate: "[data-generate]", cancel: "[data-cancel]", reset: "[data-reset]", download: "[data-download]", save: "[data-save]", filename: "[data-filename]", status: "[data-status]", errors: "[data-errors]", warnings: "[data-warnings]", stale: "[data-stale]", saved: "[data-saved]", saveForm: "[data-save-form]", sourceWarning: "[data-source-warning]", acknowledge: "[data-acknowledge]", preview: "[data-preview]"};
    for (const [name, selector] of Object.entries(selectors)) this[name] = root.querySelector(selector);
    const on = (node, event, action) => { if (node) { node.addEventListener(event, action); this.listeners.push([node, event, action]); } };
    on(this.generate, "click", () => this.generateSTL());
    on(this.form, "submit", (event) => { event.preventDefault(); this.generateSTL(); });
    on(this.cancel, "click", () => { this.renderer?.cancel(); });
    on(this.reset, "click", () => { this.state.reset(); this.writeInputs(); this.clearSaved(); this.showError(); this.sync(); });
    on(this.download, "click", () => this.downloadSTL());
    on(this.saveForm, "submit", (event) => { event.preventDefault(); this.saveVariant(); });
    on(this.acknowledge, "click", () => {
      this.config.sourceMismatch = false; this.sourceWarning.hidden = true; this.sync();
      if (this.initialRenderPending) this.generateSTL();
    });
    on(this.filename, "input", () => { this.saveAttempt = null; });
    this.sync();
  }

  t(key) { return this.strings[key] || key; }
  statusMessage(key) { this.status.textContent = key ? this.t(key) : ""; }
  showError(error) {
    this.errors.hidden = !error;
    const rawCode = error ? String(error.code || error.message || "").toLowerCase() : "";
    const code = errorCodes[rawCode] || rawCode;
    this.errors.textContent = error ? this.strings[code] || error.message || this.t("render_failed") : "";
  }
  addWarnings(warnings = []) {
    for (const warning of warnings) this.warningMessages.add(String(warning));
    // Warnings from discovery and all render attempts stay visible until leaving the page.
    const container = this.warnings;
    container.replaceChildren(); container.hidden = this.warningMessages.size === 0;
    for (const warning of this.warningMessages) container.append(element("div", {text: this.strings[warning.toLowerCase()] || warning}));
  }
  async request(url, options = {}) {
    const response = await fetch(url, {credentials: "same-origin", signal: this.fetchController.signal, ...options});
    let body;
    try { body = await response.json(); } catch { throw new Error(this.t("request_failed")); }
    if (!response.ok) throw new Error(body.error || this.t("request_failed"));
    return body;
  }
  async start() {
    try {
      if (typeof Worker === "undefined" || typeof WebAssembly === "undefined" || typeof TextEncoder === "undefined") throw new Error("unsupported_browser");
      this.previewMesh = new MeshPreview(this.preview);
      const {Renderer} = await import(this.config.assets?.rendererUrl || new URL("./renderer.js", import.meta.url));
      if (this.disposed) return;
      const options = {workerUrl: this.config.assets?.workerUrl, engineUrl: this.config.assets?.engineUrl, wasmUrl: this.config.assets?.wasmUrl, fontUrl: this.config.assets?.fontUrl, timeoutMs: this.config.limits?.timeoutMs || this.config.generationTimeoutMs, maxSourceBytes: this.config.limits?.sourceBytes || this.config.maxSourceBytes, maxOutputBytes: this.config.limits?.outputBytes || this.config.maxOutputBytes};
      this.renderer = new Renderer(Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)));
      this.statusMessage("loading");
      this.source = await this.request(this.config.sourceUrl);
      if (this.disposed) return;
      if (this.config.sourceDigest && this.source.digest !== this.config.sourceDigest) this.config.sourceMismatch = true;
      if (this.config.source?.digest && this.source.digest !== this.config.source.digest) this.config.sourceMismatch = true;
      this.sourceWarning.hidden = !this.config.sourceMismatch;
      const metadata = await this.renderer.discover(this.source.content);
      if (this.disposed) return;
      this.addWarnings(metadata.warnings);
      this.initialRenderPending = true;
      try { this.state = new CustomizerState(metadata.parameters, this.config.initialParameters || {}); }
      catch (error) {
        this.state = new CustomizerState(metadata.parameters); this.showError(error);
        // Restored settings must not silently produce a different variant.
        this.initialRenderPending = false;
      }
      this.buildForm();
      this.busy = "";
      this.statusMessage("ready");
      this.filename.value ||= this.source.filename.replace(/\.scad$/i, "-custom.stl").split(/[\\/]/).pop();
      this.sync();
      if (this.initialRenderPending && !this.config.sourceMismatch) await this.generateSTL();
    } catch (error) {
      if (!this.disposed) { this.addWarnings(error.warnings); this.busy = ""; this.showError(error); this.statusMessage(""); this.sync(); }
    }
  }
  buildForm() {
    this.form.replaceChildren(); this.inputs.clear();
    if (!this.state.parameters.length) this.form.append(element("p", {className: "text-muted", text: this.t("no_parameters")}));
    const groups = new Map();
    this.state.parameters.forEach((parameter, index) => {
      const group = parameter.group || this.t("parameters");
      if (!groups.has(group)) {
        const fieldset = element("fieldset", {className: "mb-4"});
        fieldset.append(element("legend", {className: "h5", text: group})); groups.set(group, fieldset); this.form.append(fieldset);
      }
      const wrapper = element("div", {className: "mb-3"});
      const id = `openscad-parameter-${index}`;
      const label = element("label", {className: "form-label", for: id, text: parameter.label || parameter.name});
      wrapper.append(label);
      const fields = [];
      const numeric = (suffix = "") => {
        const input = element("input", {id: `${id}${suffix}`, type: "number", className: "form-control", step: parameter.step > 0 && !parameter.allowOffStepDefault ? parameter.step : "any", required: true});
        if (Number.isFinite(parameter.min)) input.min = parameter.min;
        if (Number.isFinite(parameter.max)) input.max = parameter.max;
        fields.push(input); return input;
      };
      if (parameter.options?.length) {
        const select = element("select", {id, className: "form-select"});
        parameter.options.forEach((option, optionIndex) => select.append(element("option", {value: optionIndex, text: option.label ?? String(option.value)})));
        wrapper.append(select); fields.push(select);
      } else if (parameter.type === "vector") {
        const vector = element("div", {className: "openscad-vector", role: "group", "aria-labelledby": `${id}-label`});
        label.id = `${id}-label`; label.removeAttribute("for");
        parameter.default.forEach((_, axis) => { const input = numeric(`-${axis}`); input.setAttribute("aria-label", `${parameter.label || parameter.name} ${axis + 1}`); vector.append(input); });
        wrapper.append(vector);
      } else if (parameter.type === "number") wrapper.append(numeric());
      else if (parameter.type === "boolean") {
        const input = element("input", {id, type: "checkbox", className: "form-check-input ms-2"}); fields.push(input); wrapper.append(input);
      } else { const input = element("input", {id, type: "text", className: "form-control", maxlength: 4096}); fields.push(input); wrapper.append(input); }
      if (parameter.allowOffStepDefault) {
        const hint = element("div", {id: `${id}-step-help`, className: "form-text", text: this.t("off_step_hint").replace("%{step}", String(parameter.step))});
        wrapper.append(hint); fields.forEach((field) => field.setAttribute("aria-describedby", hint.id));
      }
      if (parameter.description && parameter.description !== parameter.label) {
        const description = element("div", {id: `${id}-help`, className: "form-text", text: parameter.description});
        wrapper.append(description); fields.forEach((field) => field.setAttribute("aria-describedby", [field.getAttribute("aria-describedby"), description.id].filter(Boolean).join(" ")));
      }
      this.inputs.set(parameter.name, fields);
      for (const field of fields) {
        field.addEventListener("input", () => {
          this.state.invalidate(); this.clearSaved();
          try {
            const value = parameter.options?.length ? parameter.options[fields[0].selectedIndex].value : parameter.type === "boolean" ? fields[0].checked : parameter.type === "vector" ? fields.map((input) => input.value === "" ? NaN : Number(input.value)) : parameter.type === "number" ? (fields[0].value === "" ? NaN : Number(fields[0].value)) : fields[0].value;
            this.state.set(parameter.name, value); fields.forEach((input) => input.setCustomValidity("")); this.showError();
          } catch { field.setCustomValidity(this.t("invalid_parameters")); }
          this.sync();
        });
      }
      groups.get(group).append(wrapper);
    });
    this.writeInputs();
  }
  writeInputs() {
    for (const parameter of this.state.parameters) {
      const fields = this.inputs.get(parameter.name), value = this.state.values[parameter.name];
      if (parameter.options?.length) fields[0].selectedIndex = parameter.options.findIndex((option) => same(option.value, value));
      else if (parameter.type === "boolean") fields[0].checked = value;
      else if (parameter.type === "vector") fields.forEach((field, axis) => { field.value = value[axis]; });
      else fields[0].value = value;
      fields.forEach((field) => field.setCustomValidity(""));
    }
  }
  sync() {
    if (this.disposed) return;
    const ready = Boolean(this.state && !this.busy && !this.config.sourceMismatch);
    this.generate.disabled = !ready;
    this.reset.disabled = !this.state || Boolean(this.busy);
    this.cancel.hidden = this.busy !== "generating";
    this.download.disabled = !this.state?.canUseOutput || Boolean(this.busy);
    if (this.save) this.save.disabled = !this.config.canSave || !this.state?.canUseOutput || Boolean(this.busy);
    if (this.filename) this.filename.disabled = Boolean(this.busy);
    for (const fields of this.inputs.values()) fields.forEach((field) => { field.disabled = Boolean(this.busy); });
    this.stale.hidden = !this.state?.stale;
    this.root.setAttribute("aria-busy", String(Boolean(this.busy)));
    this.root.classList.toggle("openscad-busy", Boolean(this.busy));
  }
  clearSaved() { this.saved.replaceChildren(); this.saveAttempt = null; }
  async generateSTL() {
    if (this.disposed || this.generate.disabled) return;
    if (!this.form.reportValidity()) { this.showError(new Error("invalid_parameters")); return; }
    this.initialRenderPending = false;
    this.busy = "generating"; this.showError(); this.statusMessage("generating"); this.clearSaved(); this.sync();
    try {
      const output = await this.renderer.generate(this.source.content, copy(this.state.values));
      if (this.disposed) return;
      this.addWarnings(output.warnings);
      try { this.previewMesh.setMesh(output.stl); }
      catch (error) {
        if (error.message !== "preview_too_large") throw error;
        this.previewMesh.clear(); this.addWarnings(["preview_too_large"]);
      }
      this.state.generated(output); this.statusMessage("generated");
    } catch (error) {
      if (this.disposed) return;
      this.addWarnings(error.warnings);
      if (String(error.code || error.message).toLowerCase() === "cancelled") this.statusMessage("cancelled");
      else { this.showError(error); this.statusMessage(""); }
    } finally { if (!this.disposed) { this.busy = ""; this.sync(); } }
  }
  downloadSTL() {
    if (!this.state.canUseOutput || this.busy) return;
    const url = URL.createObjectURL(new Blob([this.state.output.stl], {type: "model/stl"}));
    const link = element("a", {href: url, download: this.filename.value.trim() || "custom.stl"});
    document.body.append(link); link.click(); link.remove();
    // Keep the URL alive long enough for browsers to start the download.
    const timer = setTimeout(() => { URL.revokeObjectURL(url); this.downloadURLs?.delete(url); }, 10000);
    this.downloadURLs ||= new Map(); this.downloadURLs.set(url, timer);
  }
  async saveVariant() {
    if (!this.state.canUseOutput || this.busy || !this.config.canSave || !this.saveForm.reportValidity()) return;
    const filename = this.filename.value.trim();
    if (!filename || !/\.stl$/i.test(filename) || /[\\/]/.test(filename)) { this.showError(new Error("invalid_filename")); return; }
    this.saveAttempt ||= {key: globalThis.crypto?.randomUUID?.() || `openscad-${Date.now()}-${Math.random().toString(36).slice(2)}`, filename};
    const output = this.state.output;
    const form = new FormData();
    const data = {source_file_id: this.source.id, source_digest: this.source.digest, filename, parameters: JSON.stringify(output.parameters), engine_build: output.engineBuild, render_options: JSON.stringify(output.renderOptions || {}), generated_at: output.generatedAt, idempotency_key: this.saveAttempt.key};
    for (const [key, value] of Object.entries(data)) form.append(key, value ?? "");
    form.append("stl", new Blob([output.stl], {type: "model/stl"}), filename);
    this.busy = "saving"; this.showError(); this.statusMessage("saving"); this.sync();
    try {
      const csrf = this.config.csrfToken || document.querySelector('meta[name="csrf-token"]')?.content;
      let result = await this.request(this.config.saveUrl, {method: "POST", headers: csrf ? {"X-CSRF-Token": csrf} : {}, body: form});
      for (let attempt = 0; result.status === "pending" && attempt < 90; attempt += 1) {
        await this.delay(2000);
        result = await this.request(result.status_url);
      }
      if (result.status !== "complete") throw new Error(result.error || this.t("save_pending"));
      this.showSaved(result); this.statusMessage("saved");
    } catch (error) { if (!this.disposed) { this.showError(error); this.statusMessage("save_retry"); } }
    finally { if (!this.disposed) { this.busy = ""; this.sync(); } }
  }
  delay(milliseconds) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pendingDelay = null; resolve(); }, milliseconds);
      this.pendingDelay = {timer, reject};
    });
  }
  showSaved(result) {
    this.saved.replaceChildren();
    for (const [key, url] of [["view_file", result.file_url], ["download_manifest", result.manifest_url], ["reopen", result.reopen_url]]) {
      if (url) this.saved.append(element("a", {href: url, className: "btn btn-outline-secondary me-2 mt-2", text: this.t(key)}));
    }
  }
  dispose() {
    this.disposed = true; this.fetchController.abort(); this.renderer?.dispose(); this.previewMesh?.dispose();
    for (const [node, event, action] of this.listeners) node.removeEventListener(event, action);
    for (const [url, timer] of this.downloadURLs || []) { clearTimeout(timer); URL.revokeObjectURL(url); }
    if (this.pendingDelay) { clearTimeout(this.pendingDelay.timer); this.pendingDelay.reject(new Error("cancelled")); }
  }
}

let mounted;
export function mountCustomizer() {
  const root = document.querySelector("[data-openscad-customizer]");
  if (mounted?.root === root && !mounted.disposed) return;
  mounted?.dispose(); mounted = null;
  const config = document.querySelector("[data-openscad-config]");
  if (root && config) { mounted = new CustomizerApp(root, JSON.parse(config.textContent)); mounted.start(); }
}
if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountCustomizer, {once: true});
  else mountCustomizer();
  document.addEventListener("turbo:load", mountCustomizer);
  document.addEventListener("turbo:before-cache", () => { mounted?.dispose(); mounted = null; });
  globalThis.addEventListener("pagehide", () => { mounted?.dispose(); mounted = null; });
}
