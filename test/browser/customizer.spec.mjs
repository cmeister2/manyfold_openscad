import {test, expect} from "@playwright/test";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {parseSTL} from "../../app/assets/manyfold_openscad/preview.mjs";

const base = process.env.OPENSCAD_BROWSER_URL || "http://127.0.0.1:3216";
const pagePath = name => `${base}/manyfold_openscad/models/${name}/customize`;
const measurements = [];

async function downloadBounds(page, info, filename) {
  const downloadEvent = page.waitForEvent("download");
  await page.locator("[data-download]").click();
  const path = info.outputPath(filename);
  await (await downloadEvent).saveAs(path);
  const mesh = parseSTL(await readFile(path));
  return mesh.bounds.max.map((value, axis) => value - mesh.bounds.min[axis]);
}

test.beforeAll(async ({request}) => {
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    try { if ((await request.get(`${base}/health`)).ok()) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("The disposable Manyfold browser fixture did not start.");
});

test.beforeEach(async ({page, context}) => {
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin !== new URL(base).origin) return route.abort();
    return route.continue();
  });
  await page.goto(`${base}/users/sign_in`);
});

test("simple box renders on opening offline, preserves source, saves and reopens typed settings", async ({page}, info) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const start = Date.now();
  const response = await page.goto(pagePath("customizerbox"));
  expect(response.headers()["content-security-policy"]).toContain("wasm-unsafe-eval");
  await expect(page.locator("[data-download]")).toBeEnabled();
  await expect(page.locator("[data-save]")).toBeEnabled();
  await expect(page.locator("[data-preview]")).toBeVisible();
  expect(await page.locator("[data-preview]").evaluate(canvas => {
    const {data} = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    return data.some((value, index) => index % 4 === 3 && value !== 0);
  })).toBe(true);
  expect(await downloadBounds(page, info, "box-default.stl")).toEqual([100, 80, 40]);
  measurements.push({profile: "desktop", startupMs: Date.now() - start});
  const sourceUrl = await page.locator("[data-openscad-config]").evaluate(node => JSON.parse(node.textContent).sourceUrl);
  const original = await (await page.request.get(`${base}${sourceUrl}`)).json();
  await expect(page.locator("[data-parameters] input")).toHaveCount(3);
  await page.getByLabel("Width in millimetres", {exact: true}).fill("150");
  await expect(page.locator("[data-stale]")).toBeVisible();
  await expect(page.locator("[data-download]")).toBeDisabled();
  await expect(page.locator("[data-save]")).toBeDisabled();
  const generationStart = Date.now();
  await page.locator("[data-generate]").click();
  await expect(page.locator("[data-download]")).toBeEnabled();
  measurements.push({profile: "desktop", generationMs: Date.now() - generationStart});
  expect(await downloadBounds(page, info, "box-wide.stl")).toEqual([150, 80, 40]);
  const canvas = page.locator("[data-preview]");
  const previousPreview = await canvas.evaluate(node => node.toDataURL());
  await canvas.focus();
  await canvas.press("ArrowRight");
  expect(await canvas.evaluate(node => node.toDataURL())).not.toBe(previousPreview);
  expect(await (await page.request.get(`${base}${sourceUrl}`)).json()).toEqual(original);
  await page.locator("[data-filename]").fill(`box-wide-${Date.now()}.stl`);
  // Lose a successful server response, then retry the same mesh and idempotency key.
  const saves = [];
  let loseResponse = true;
  await page.route("**/models/customizerbox/variants", async route => {
    if (route.request().method() !== "POST") return route.continue();
    saves.push(route.request().postData());
    const serverResponse = await route.fetch();
    if (loseResponse) { loseResponse = false; return route.abort("failed"); }
    return route.fulfill({response: serverResponse});
  });
  await page.locator("[data-save]").click();
  await expect(page.locator("[data-errors]")).toBeVisible();
  await expect(page.locator("[data-save]")).toBeEnabled();
  await page.locator("[data-save]").click();
  const manifestLink = page.locator("[data-saved] a[href$='/manifest']");
  await expect(manifestLink).toBeVisible({timeout: 45000});
  expect(saves).toHaveLength(2);
  const key = value => value.match(/name="idempotency_key"\r\n\r\n([^\r]+)/)?.[1];
  expect(key(saves[0])).toBeTruthy();
  expect(key(saves[1])).toBe(key(saves[0]));
  const manifest = await (await page.request.get(new URL(await manifestLink.getAttribute("href"), base).href)).json();
  expect(manifest.parameters).toEqual({width: 150, depth: 80, height: 40});
  expect(manifest.source.digest).toBe(original.digest);
  expect(manifest.output.digest).toMatch(/^[a-f0-9]{64}$/);
  await page.locator("[data-saved] a[href$='/reopen']").click();
  await expect(page.getByLabel("Width in millimetres", {exact: true})).toHaveValue("150");
  await expect(page.locator("[data-download]")).toBeEnabled();
  expect(await downloadBounds(page, info, "box-reopened.stl")).toEqual([150, 80, 40]);
  await page.getByLabel("Width in millimetres", {exact: true}).fill("155");
  await expect(page.locator("[data-stale]")).toBeVisible();
  await expect(page.locator("[data-download]")).toBeDisabled();
  await expect(page.locator("[data-save]")).toBeDisabled();
  await page.locator("[data-reset]").click();
  await expect(page.getByLabel("Width in millimetres", {exact: true})).toHaveValue("100");
  await expect(page.locator("[data-download]")).toBeDisabled();
  await expect(page.locator("[data-generate]")).toBeEnabled();
  expect(errors).toEqual([]);
  await page.screenshot({path: info.outputPath("customizer.png"), fullPage: true});
});

test("rich metadata controls expose labels, groups, hidden fields, vectors, and literal strings", async ({page}, info) => {
  await page.goto(pagePath("customizercontrols"));
  await expect(page.locator("[data-download]")).toBeEnabled();
  expect(await downloadBounds(page, info, "rich-box-default.stl")).toEqual([100, 80, 40]);
  await expect(page.locator("[data-parameters] fieldset legend")).toHaveText(["Dimensions", "Appearance"]);
  await expect(page.locator("[data-parameters] label")).toHaveCount(8);
  await expect(page.getByLabel("Label text", {exact: true})).toHaveValue('A "quoted" box');
  await expect(page.getByLabel("Position in millimetres 1", {exact: true})).toHaveValue("0");
  await expect(page.getByLabel("Surface finish", {exact: true})).toHaveValue("0");
  await page.getByLabel("Surface finish", {exact: true}).selectOption("1");
  await page.getByLabel("Wall thickness", {exact: true}).selectOption("2");
  await page.getByLabel("Add a lid", {exact: true}).check();
  await page.getByLabel("Label text", {exact: true}).fill('quoted "; cube(900); //');
  await page.getByLabel("Position in millimetres 1", {exact: true}).fill("3");
  await page.locator("[data-generate]").click();
  await expect(page.locator("[data-download]")).toBeEnabled();
  expect(await downloadBounds(page, info, "rich-box-with-lid.stl")).toEqual([100, 80, 43]);
  await page.locator("[data-reset]").click();
  await expect(page.getByLabel("Label text", {exact: true})).toHaveValue('A "quoted" box');
  await expect(page.getByLabel("Position in millimetres 1", {exact: true})).toHaveValue("0");
  await expect(page.getByLabel("Wall thickness", {exact: true})).toHaveValue("1");
  await expect(page.getByLabel("Add a lid", {exact: true})).not.toBeChecked();
});

test("cancellation and timeout recover with a fresh real worker", async ({page}) => {
  let wasmRequests = 0, releaseGeneration;
  const heldGeneration = new Promise(resolve => { releaseGeneration = resolve; });
  await page.route("**/assets/openscad.wasm", async route => {
    // Discovery uses the first worker; hold the automatic render's real worker
    // so cancellation does not depend on the machine's rendering speed.
    if (++wasmRequests === 2) {
      await heldGeneration;
      return route.abort().catch(() => {}); // Cancellation already terminated this worker.
    }
    return route.continue();
  });
  try {
    await page.goto(pagePath("customizerbox"));
    await expect.poll(() => wasmRequests).toBe(2);
    await expect(page.locator("[data-cancel]")).toBeVisible();
    await page.locator("[data-cancel]").click();
    await expect(page.locator("[data-status]")).toContainText("Generation cancelled.");
  } finally { releaseGeneration(); }
  await expect(page.locator("[data-download]")).toBeDisabled();
  await expect(page.locator("[data-generate]")).toBeEnabled();
  await page.locator("[data-generate]").click();
  await expect(page.locator("[data-download]")).toBeEnabled();
  const recovered = await page.evaluate(async () => {
    const {Renderer} = await import("/manyfold_openscad/assets/renderer.js");
    const renderer = new Renderer({timeoutMs: 1});
    let code;
    try { await renderer.generate("width=100; cube([width,80,40]);", {width: 150}); } catch (error) { code = error.code; }
    renderer.options.timeoutMs = 120000;
    const output = await renderer.generate("width=100; cube([width,80,40]);", {width: 150});
    renderer.dispose();
    return {code, size: output.stl.byteLength};
  });
  expect(recovered.code).toBe("TIMEOUT");
  expect(recovered.size).toBeGreaterThan(84);
});

test("missing dependencies and empty geometry have visible recoverable errors", async ({page}) => {
  await page.goto(pagePath("customizerdependency"));
  await expect(page.locator("[data-errors]")).toBeVisible();
  await expect(page.locator("[data-errors]")).toContainText(/self-contained|external|dependenc/i);
  await expect(page.locator("[data-generate]")).toBeDisabled();
  await page.goto(pagePath("customizerempty"));
  await expect(page.locator("[data-errors]")).toBeVisible();
  await expect(page.locator("[data-download]")).toBeDisabled();
  await expect(page.locator("[data-generate]")).toBeEnabled();
  await page.locator("[data-generate]").click();
  await expect(page.locator("[data-errors]")).toBeVisible();
  await expect(page.locator("[data-generate]")).toBeEnabled();
});

test("visible rendering warnings persist with successful output; throttled client renders", async ({page, context}) => {
  await page.goto(pagePath("customizerbox"));
  await expect(page.locator("[data-download]")).toBeEnabled();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", {rate: 4});
  const result = await page.evaluate(async () => {
    const {Renderer} = await import("/manyfold_openscad/assets/renderer.js");
    const renderer = new Renderer();
    const source = '// Width\nwidth=100; // [10:5:200]\necho(missing_value); cube([width,80,40]);';
    const metadata = await renderer.discover(source);
    const output = await renderer.generate(source, {width: 150});
    renderer.dispose();
    return {startupMs: metadata.elapsedMs, generationMs: output.elapsedMs, warnings: output.warnings, bytes: output.stl.byteLength};
  });
  measurements.push({profile: "4x CPU throttle", ...result});
  expect(result.warnings.some(message => message.includes("missing_value"))).toBeTruthy();
  expect(result.bytes).toBeGreaterThan(84);
  await cdp.send("Emulation.setCPUThrottlingRate", {rate: 1});
});

test("source revision mismatch needs acknowledgment and warnings survive successful generation", async ({page}) => {
  await page.route("**/models/customizerbox/sources/*", async route => {
    const response = await route.fetch();
    const source = await response.json();
    source.content += "\necho(missing_value);\n";
    source.digest = createHash("sha256").update(source.content).digest("hex");
    return route.fulfill({response, json: source});
  });
  await page.goto(pagePath("customizerbox"));
  await expect(page.locator("[data-source-warning]")).toBeVisible();
  await expect(page.locator("[data-generate]")).toBeDisabled();
  await expect(page.locator("[data-download]")).toBeDisabled();
  await expect(page.locator("[data-save]")).toBeDisabled();
  await expect(page.locator("[data-cancel]")).toBeHidden();
  await page.locator("[data-acknowledge]").click();
  await expect(page.locator("[data-download]")).toBeEnabled();
  await expect(page.locator("[data-warnings]")).toBeVisible();
  await expect(page.locator("[data-warnings]")).toContainText("missing_value");
  await page.getByLabel("Width in millimetres", {exact: true}).fill("150");
  await expect(page.locator("[data-warnings]")).toContainText("missing_value");
});

test("sources without exposed parameters render on opening and allow manual regeneration", async ({page}, info) => {
  await page.route("**/models/customizerbox/sources/*", async route => {
    const response = await route.fetch();
    const source = await response.json();
    source.content = "cube([10,10,10]);";
    source.digest = createHash("sha256").update(source.content).digest("hex");
    return route.fulfill({response, json: source});
  });
  await page.goto(pagePath("customizerbox"));
  await expect(page.locator("[data-parameters]")).toContainText("no exposed Customizer parameters");
  await expect(page.locator("[data-source-warning]")).toBeVisible();
  await expect(page.locator("[data-generate]")).toBeDisabled();
  await expect(page.locator("[data-download]")).toBeDisabled();
  await page.locator("[data-acknowledge]").click();
  await expect(page.locator("[data-download]")).toBeEnabled();
  await expect(page.locator("[data-parameters] input")).toHaveCount(0);
  await expect(page.locator("[data-parameters]")).toContainText("no exposed Customizer parameters");
  expect(await downloadBounds(page, info, "plain-scad.stl")).toEqual([10, 10, 10]);
  await expect(page.locator("[data-generate]")).toBeEnabled();
  await page.locator("[data-generate]").click();
  await expect(page.locator("[data-download]")).toBeEnabled();
  expect(await downloadBounds(page, info, "plain-scad-retry.stl")).toEqual([10, 10, 10]);
});

test("invalid restored settings remain visible until defaults are explicitly rendered", async ({page}, info) => {
  await page.route("**/models/customizerbox/customize", async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/(<script\b[^>]*\bdata-openscad-config\b[^>]*>)([\s\S]*?)(<\/script>)/, (_match, open, json, close) => {
      const config = JSON.parse(json);
      config.initialParameters = {width: "150", depth: 80, height: 40};
      return `${open}${JSON.stringify(config)}${close}`;
    });
    return route.fulfill({response, body});
  });
  await page.goto(pagePath("customizerbox"));
  await expect(page.locator("[data-errors]")).toBeVisible();
  await expect(page.locator("[data-errors]")).toContainText("parameter values");
  await expect(page.getByLabel("Width in millimetres", {exact: true})).toHaveValue("100");
  await expect(page.locator("[data-generate]")).toBeEnabled();
  await expect(page.locator("[data-cancel]")).toBeHidden();
  await expect(page.locator("[data-download]")).toBeDisabled();
  await expect(page.locator("[data-save]")).toBeDisabled();
  await page.locator("[data-generate]").click();
  await expect(page.locator("[data-download]")).toBeEnabled();
  await expect(page.locator("[data-errors]")).toBeHidden();
  expect(await downloadBounds(page, info, "restored-defaults.stl")).toEqual([100, 80, 40]);
});

test("unsupported browsers receive an actionable explanation", async ({page}) => {
  await page.addInitScript(() => { globalThis.Worker = undefined; });
  await page.goto(pagePath("customizerbox"));
  await expect(page.locator("[data-errors]")).toContainText("WebAssembly and Web Workers");
  await expect(page.locator("[data-generate]")).toBeDisabled();
});

test.afterAll(async () => { console.log("OpenSCAD browser measurements:", JSON.stringify(measurements)); });
