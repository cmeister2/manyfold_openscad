import {test, expect} from "@playwright/test";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {parseSTL} from "../../app/assets/manyfold_openscad/preview.mjs";

const base = process.env.OPENSCAD_BROWSER_URL || "http://127.0.0.1:3216";
const pagePath = name => `${base}/manyfold_openscad/models/${name}/customize`;
const measurements = [];

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

test("simple box generates offline, preserves source, saves and reopens typed settings", async ({page}, info) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const start = Date.now();
  const response = await page.goto(pagePath("customizerbox"));
  expect(response.headers()["content-security-policy"]).toContain("wasm-unsafe-eval");
  await expect(page.locator("[data-generate]")).toBeEnabled();
  measurements.push({profile: "desktop", startupMs: Date.now() - start});
  const sourceUrl = await page.locator("[data-openscad-config]").evaluate(node => JSON.parse(node.textContent).sourceUrl);
  const original = await (await page.request.get(`${base}${sourceUrl}`)).json();
  await expect(page.locator("[data-parameters] input")).toHaveCount(3);
  await page.getByLabel("Width in millimetres", {exact: true}).fill("150");
  const generationStart = Date.now();
  await page.locator("[data-generate]").click();
  await expect(page.locator("[data-download]")).toBeEnabled();
  measurements.push({profile: "desktop", generationMs: Date.now() - generationStart});
  const downloadEvent = page.waitForEvent("download");
  await page.locator("[data-download]").click();
  const download = await downloadEvent;
  const path = info.outputPath("box-wide.stl");
  await download.saveAs(path);
  const mesh = parseSTL(await readFile(path));
  expect(mesh.bounds.max.map((value, axis) => value - mesh.bounds.min[axis])).toEqual([150, 80, 40]);
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
  await expect(page.locator("[data-download]")).toBeDisabled();
  await page.locator("[data-generate]").click();
  await expect(page.locator("[data-download]")).toBeEnabled();
  await page.getByLabel("Width in millimetres", {exact: true}).fill("155");
  await expect(page.locator("[data-stale]")).toBeVisible();
  await expect(page.locator("[data-download]")).toBeDisabled();
  await expect(page.locator("[data-save]")).toBeDisabled();
  await page.locator("[data-reset]").click();
  await expect(page.getByLabel("Width in millimetres", {exact: true})).toHaveValue("100");
  expect(errors).toEqual([]);
  await page.screenshot({path: info.outputPath("customizer.png"), fullPage: true});
});

test("rich metadata controls expose labels, groups, hidden fields, vectors, and literal strings", async ({page}) => {
  await page.goto(pagePath("customizercontrols"));
  await expect(page.locator("[data-generate]")).toBeEnabled();
  await expect(page.locator("[data-parameters] fieldset legend")).toHaveText(["Dimensions", "Appearance"]);
  await expect(page.locator("[data-parameters] label")).toHaveCount(8);
  await expect(page.getByLabel("Label text", {exact: true})).toHaveValue('A "quoted" box');
  await expect(page.getByLabel("Position in millimetres 1", {exact: true})).toHaveValue("0");
  await expect(page.getByLabel("Surface finish", {exact: true})).toHaveValue("0");
  await page.getByLabel("Surface finish", {exact: true}).selectOption("1");
  await page.getByLabel("Add a lid", {exact: true}).check();
  await page.getByLabel("Label text", {exact: true}).fill('quoted "; cube(900); //');
  await page.getByLabel("Position in millimetres 1", {exact: true}).fill("3");
  await page.locator("[data-generate]").click();
  await expect(page.locator("[data-download]")).toBeEnabled();
  await page.locator("[data-reset]").click();
  await expect(page.getByLabel("Label text", {exact: true})).toHaveValue('A "quoted" box');
  await expect(page.getByLabel("Position in millimetres 1", {exact: true})).toHaveValue("0");
  await expect(page.getByLabel("Add a lid", {exact: true})).not.toBeChecked();
});

test("cancellation and timeout recover with a fresh real worker", async ({page}) => {
  await page.goto(pagePath("customizerbox"));
  await expect(page.locator("[data-generate]")).toBeEnabled();
  await page.locator("[data-generate]").click();
  await page.locator("[data-cancel]").click();
  await expect(page.locator("[data-status]")).toContainText("Generation cancelled.");
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
  await expect(page.locator("[data-generate]")).toBeEnabled();
  await page.locator("[data-generate]").click();
  await expect(page.locator("[data-errors]")).toBeVisible();
  await expect(page.locator("[data-download]")).toBeDisabled();
  await expect(page.locator("[data-generate]")).toBeEnabled();
});

test("visible rendering warnings persist with successful output; throttled client renders", async ({page, context}) => {
  await page.goto(pagePath("customizerbox"));
  await expect(page.locator("[data-generate]")).toBeEnabled();
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
  await page.locator("[data-acknowledge]").click();
  await expect(page.locator("[data-generate]")).toBeEnabled();
  await page.locator("[data-generate]").click();
  await expect(page.locator("[data-download]")).toBeEnabled();
  await expect(page.locator("[data-warnings]")).toBeVisible();
  await expect(page.locator("[data-warnings]")).toContainText("missing_value");
  await page.getByLabel("Width in millimetres", {exact: true}).fill("150");
  await expect(page.locator("[data-warnings]")).toContainText("missing_value");
});

test("sources without exposed parameters explain their status", async ({page}) => {
  await page.route("**/models/customizerbox/sources/*", async route => {
    const response = await route.fetch();
    const source = await response.json();
    source.content = "cube([10,10,10]);";
    return route.fulfill({response, json: source});
  });
  await page.goto(pagePath("customizerbox"));
  await expect(page.locator("[data-status]")).toContainText("no exposed Customizer parameters");
  await expect(page.locator("[data-generate]")).toBeDisabled();
  await expect(page.locator("[data-download]")).toBeDisabled();
});

test("unsupported browsers receive an actionable explanation", async ({page}) => {
  await page.addInitScript(() => { globalThis.Worker = undefined; });
  await page.goto(pagePath("customizerbox"));
  await expect(page.locator("[data-errors]")).toContainText("WebAssembly and Web Workers");
  await expect(page.locator("[data-generate]")).toBeDisabled();
});

test.afterAll(async () => { console.log("OpenSCAD browser measurements:", JSON.stringify(measurements)); });
