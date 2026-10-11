// Customizer definitions come exclusively from OpenSCAD's .param exporter.
export class RendererError extends Error {
  constructor(code, message, warnings = []) {
    super(message);
    this.name = "RendererError";
    this.code = code;
    this.warnings = warnings;
  }
}

export function assertSource(source, maxBytes = 1048576) {
  if (typeof source !== "string" || new TextEncoder().encode(source).length > maxBytes) {
    throw new RendererError("SOURCE_LIMIT", "The OpenSCAD source exceeds the configured size limit.");
  }
  assertSelfContained(source);
}

// A small lexer recognizes dependency operations outside comments and strings.
// It is never used to infer parameters, defaults, annotations, or expressions.
export function assertSelfContained(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index + 2);
      index = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (char === '"') {
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") { index += 2; continue; }
        if (source[index++] === '"') break;
      }
      tokens.push("string");
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = index++;
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index += 1;
      tokens.push(source.slice(start, index));
    } else {
      tokens.push(char);
      index += 1;
    }
    const operation = tokens.at(-2);
    const next = tokens.at(-1);
    if (((operation === "include" || operation === "use") && next === "<") ||
        (["import", "surface", "dxf_dim", "dxf_cross"].includes(operation) && next === "(")) {
      throw new RendererError("DEPENDENCY", "This model uses external files (include, use, import, surface, or DXF queries). The customizer currently supports self-contained .scad files only.");
    }
  }
}

export function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" ||
      (metadata.parameters !== undefined && !Array.isArray(metadata.parameters))) {
    throw new RendererError("METADATA", "OpenSCAD returned invalid Customizer metadata.");
  }
  const warnings = [];
  const parameters = [];
  const names = new Set();
  for (const raw of metadata.parameters || []) {
    if (!raw || typeof raw.name !== "string" || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(raw.name) || names.has(raw.name)) {
      throw new RendererError("METADATA", "OpenSCAD returned an invalid or duplicated parameter name.");
    }
    names.add(raw.name);
    if (raw.group === "Hidden") continue;
    let type = raw.type;
    if (type === "number" && Array.isArray(raw.initial)) type = "vector";
    const validDefault = type === "number" ? Number.isFinite(raw.initial) :
      type === "boolean" ? typeof raw.initial === "boolean" :
      type === "string" ? typeof raw.initial === "string" :
      type === "vector" ? Array.isArray(raw.initial) && raw.initial.length > 0 && raw.initial.every(Number.isFinite) : false;
    if (!validDefault) {
      warnings.push(`The parameter ${raw.name} has an unsupported type and keeps its source default.`);
      continue;
    }
    const parameter = {
      name: raw.name,
      label: raw.caption || raw.name,
      description: raw.caption || "",
      group: raw.group || "Parameters",
      type,
      default: structuredClone(raw.initial)
    };
    for (const bound of ["min", "max", "step"]) {
      if (Number.isFinite(raw[bound])) parameter[bound] = raw[bound];
    }
    if ((type === "number" || type === "vector") && parameter.step > 0) {
      parameter.allowOffStepDefault = (Array.isArray(raw.initial) ? raw.initial : [raw.initial]).some(number => {
        const ticks = (number - (parameter.min ?? 0)) / parameter.step;
        return Math.abs(ticks - Math.round(ticks)) > 1e-7 * Math.max(1, Math.abs(ticks));
      });
      if (!parameter.allowOffStepDefault) delete parameter.allowOffStepDefault;
    }
    if (type === "vector") parameter.vectorLength = raw.initial.length;
    if (Array.isArray(raw.options)) {
      parameter.options = raw.options.map(option => ({value: option.value, label: String(option.name ?? option.value)}));
    }
    parameters.push(parameter);
  }
  return {parameters, warnings};
}

export function validateValues(parameters, values = {}) {
  if (!values || typeof values !== "object" || Array.isArray(values) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(values))) {
    throw new RendererError("PARAMETERS", "Parameter values must be a JSON object.");
  }
  const names = new Set(parameters.map(parameter => parameter.name));
  for (const name of Object.keys(values)) {
    if (!names.has(name)) throw new RendererError("PARAMETERS", `The parameter ${name} is not exposed by this source.`);
  }
  const result = Object.create(null);
  for (const parameter of parameters) {
    const value = Object.hasOwn(values, parameter.name) ? values[parameter.name] : structuredClone(parameter.default);
    const fail = detail => { throw new RendererError("PARAMETERS", `${parameter.label}: ${detail}`); };
    if (parameter.type === "boolean" && typeof value !== "boolean") fail("choose true or false.");
    if (parameter.type === "string" && (typeof value !== "string" || value.length > 4096)) fail("enter a string of at most 4096 characters.");
    if (parameter.type === "number" && !Number.isFinite(value)) fail("enter a finite number.");
    if (parameter.type === "vector" && (!Array.isArray(value) || value.length !== parameter.vectorLength || !value.every(Number.isFinite))) {
      fail(`enter ${parameter.vectorLength} finite numbers.`);
    }
    if (parameter.options && !parameter.options.some(option => JSON.stringify(option.value) === JSON.stringify(value))) {
      fail("choose one of the documented options.");
    }
    if (parameter.type === "number" || parameter.type === "vector") {
      const numbers = Array.isArray(value) ? value : [value];
      const defaults = Array.isArray(parameter.default) ? parameter.default : [parameter.default];
      for (let index = 0; index < numbers.length; index++) {
        const number = numbers[index];
        if (parameter.min !== undefined && number < parameter.min) fail(`the minimum is ${parameter.min}.`);
        if (parameter.max !== undefined && number > parameter.max) fail(`the maximum is ${parameter.max}.`);
        if (parameter.step > 0 && number !== defaults[index]) {
          const ticks = (number - (parameter.min ?? 0)) / parameter.step;
          if (Math.abs(ticks - Math.round(ticks)) > 1e-7 * Math.max(1, Math.abs(ticks))) fail(`use increments of ${parameter.step}.`);
        }
      }
    }
    result[parameter.name] = structuredClone(value);
  }
  return result;
}

export function createPreset(parameters, values) {
  const validated = validateValues(parameters, values);
  const preset = Object.create(null);
  for (const [name, value] of Object.entries(validated)) {
    // OpenSCAD's preset reader treats string parameter entries as literal text.
    // Numeric, boolean, and vector entries use only JSON-serialized typed values.
    preset[name] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return JSON.stringify({fileFormatVersion: "1", parameterSets: {manyfold: preset}});
}
