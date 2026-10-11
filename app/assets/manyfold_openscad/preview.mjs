// The preview owns only a bounded copy of the mesh; rendering still runs in a worker.
export function parseSTL(input, maxTriangles = 300000) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const points = [];
  let triangles = 0;
  const add = (coordinates) => {
    if (coordinates.length !== 9 || coordinates.some((value) => !Number.isFinite(value))) throw new Error("invalid_mesh");
    triangles += 1;
    if (triangles > maxTriangles) throw new Error("preview_too_large");
    points.push(...coordinates);
  };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.length >= 84 ? view.getUint32(80, true) : 0;
  if (count > 0 && 84 + count * 50 === bytes.length) {
    if (count > maxTriangles) throw new Error("preview_too_large");
    for (let triangle = 0; triangle < count; triangle += 1) {
      const coordinates = [];
      for (let vertex = 0; vertex < 9; vertex += 1) coordinates.push(view.getFloat32(84 + triangle * 50 + 12 + vertex * 4, true));
      add(coordinates);
    }
  } else {
    const text = new TextDecoder().decode(bytes);
    const coordinates = [];
    const number = "([+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?)";
    const vertexPattern = new RegExp(`\\bvertex\\s+${number}\\s+${number}\\s+${number}(?=\\s|$)`, "g");
    for (const match of text.matchAll(vertexPattern)) {
      coordinates.push(Number(match[1]), Number(match[2]), Number(match[3]));
      if (coordinates.length === 9) { add(coordinates.splice(0)); }
    }
    if (coordinates.length || !/^\s*solid\b/i.test(text) || !/\bendsolid\b/i.test(text)) throw new Error("invalid_mesh");
  }
  if (!triangles) throw new Error("empty_geometry");
  const bounds = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};
  points.forEach((value, index) => {
    const axis = index % 3;
    bounds.min[axis] = Math.min(bounds.min[axis], value);
    bounds.max[axis] = Math.max(bounds.max[axis], value);
  });
  return {vertices: new Float32Array(points), triangles, bounds};
}

export class MeshPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    if (!this.context) throw new Error("unsupported_browser");
    this.yaw = -0.6;
    this.pitch = 0.5;
    this.zoom = 1;
    this.listeners = [];
    const on = (name, handler, options) => { canvas.addEventListener(name, handler, options); this.listeners.push([name, handler, options]); };
    on("pointerdown", (event) => { this.pointer = [event.clientX, event.clientY]; canvas.setPointerCapture?.(event.pointerId); });
    on("pointerup", () => { this.pointer = null; });
    on("pointercancel", () => { this.pointer = null; });
    on("pointermove", (event) => {
      if (!this.pointer) return;
      this.yaw += (event.clientX - this.pointer[0]) * 0.01;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + (event.clientY - this.pointer[1]) * 0.01));
      this.pointer = [event.clientX, event.clientY]; this.draw();
    });
    on("wheel", (event) => { event.preventDefault(); this.zoom = Math.max(0.3, Math.min(5, this.zoom * Math.exp(-event.deltaY * 0.001))); this.draw(); }, {passive: false});
    on("keydown", (event) => {
      const actions = {ArrowLeft: () => { this.yaw -= 0.1; }, ArrowRight: () => { this.yaw += 0.1; }, ArrowUp: () => { this.pitch -= 0.1; }, ArrowDown: () => { this.pitch += 0.1; }, "+": () => { this.zoom = Math.min(5, this.zoom * 1.1); }, "-": () => { this.zoom = Math.max(0.3, this.zoom / 1.1); }};
      if (actions[event.key]) { event.preventDefault(); actions[event.key](); this.draw(); }
    });
    this.resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.draw()) : null;
    this.resizeObserver?.observe(canvas);
  }

  setMesh(stl) { this.mesh = parseSTL(stl); this.zoom = 1; this.draw(); return this.mesh; }
  clear() { this.mesh = null; this.context.clearRect(0, 0, this.canvas.width, this.canvas.height); }
  draw() {
    const {canvas, context, mesh} = this;
    const width = canvas.clientWidth || 640, height = canvas.clientHeight || 420;
    const ratio = globalThis.devicePixelRatio || 1;
    if (canvas.width !== width * ratio || canvas.height !== height * ratio) { canvas.width = width * ratio; canvas.height = height * ratio; }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!mesh) return;
    const center = mesh.bounds.min.map((value, axis) => (value + mesh.bounds.max[axis]) / 2);
    const span = Math.hypot(...mesh.bounds.min.map((value, axis) => mesh.bounds.max[axis] - value)) || 1;
    const scale = Math.min(width, height) * 0.8 / span * this.zoom;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const rotate = (x, y, z) => {
      x -= center[0]; y -= center[1]; z -= center[2];
      const rx = cy * x - sy * y, ry = sy * x + cy * y;
      return [width / 2 + rx * scale, height / 2 - (cp * z - sp * ry) * scale, sp * z + cp * ry];
    };
    const faces = [];
    for (let offset = 0; offset < mesh.vertices.length; offset += 9) {
      const vertices = [0, 3, 6].map((vertex) => rotate(...mesh.vertices.subarray(offset + vertex, offset + vertex + 3)));
      faces.push({vertices, depth: vertices.reduce((sum, vertex) => sum + vertex[2], 0)});
    }
    faces.sort((a, b) => a.depth - b.depth);
    context.lineWidth = 0.4;
    context.strokeStyle = "#34556d";
    for (const face of faces) {
      const [a, b, c] = face.vertices;
      const normal = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
      const light = Math.min(72, 44 + Math.sqrt(normal) / 3);
      context.fillStyle = `hsl(205 45% ${light}%)`;
      context.beginPath(); context.moveTo(a[0], a[1]); context.lineTo(b[0], b[1]); context.lineTo(c[0], c[1]); context.closePath(); context.fill(); context.stroke();
    }
  }
  dispose() {
    for (const [name, handler, options] of this.listeners) this.canvas.removeEventListener(name, handler, options);
    this.resizeObserver?.disconnect(); this.mesh = null; this.clear();
  }
}
