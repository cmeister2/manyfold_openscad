import {test, expect} from "@playwright/test";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {parseSTL} from "../../app/assets/manyfold_openscad/preview.mjs";

const network = new WeakMap();

test.beforeEach(async ({page, context, baseURL}) => {
  const observed = {requests: [], failures: [], errors: []};
  network.set(page, observed);
  const site = new URL(baseURL);
  context.on("request", request => observed.requests.push({url: request.url(), method: request.method()}));
  context.on("response", response => {
    if (response.status() >= 400) observed.failures.push(`${response.status()} ${response.url()}`);
  });
  context.on("requestfailed", request => observed.failures.push(`${request.failure()?.errorText} ${request.url()}`));
  context.on("console", message => { if (message.type() === "error") observed.errors.push(message.text()); });
  page.on("pageerror", error => observed.errors.push(error.message));
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== site.origin || !url.pathname.startsWith(site.pathname)) return route.abort();
    return route.continue();
  });
});

test.afterEach(async ({page, baseURL}) => {
  const observed = network.get(page), site = new URL(baseURL);
  expect(observed.failures, "Every resource must exist in the static export").toEqual([]);
  expect(observed.errors, "The page and worker must render without console errors").toEqual([]);
  for (const request of observed.requests) {
    const url = new URL(request.url);
    expect(url.origin, `Unexpected external request: ${request.url}`).toBe(site.origin);
    expect(url.pathname, `Unexpected host route: ${request.url}`).toMatch(/^\/manyfold_openscad\//);
    expect(url.pathname, `A demo must not contact Rails: ${request.url}`).not.toMatch(/\/(?:models|variants|users|cable|health)(?:\/|$)/);
    expect(request.method, `The static demo must not write to a server: ${request.url}`).toBe("GET");
  }
});

async function sourceDocument(page, fixture) {
  const config = await page.locator("[data-openscad-config]").evaluate(node => JSON.parse(node.textContent));
  const url = new URL(config.sourceUrl, page.url()).href;
  const source = await (await page.request.get(url)).json();
  const content = await readFile(new URL(`../fixtures/${fixture}`, import.meta.url), "utf8");
  expect(source.content).toBe(content);
  expect(source.digest).toBe(createHash("sha256").update(content).digest("hex"));
  return {url, source};
}

async function downloadMesh(page, info, filename) {
  const event = page.waitForEvent("download");
  await page.locator("[data-download]").click();
  const download = await event, path = info.outputPath(filename);
  await download.saveAs(path);
  return parseSTL(await readFile(path));
}

async function screenshot(page, info, name) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({path, fullPage: true});
  await info.attach(name, {path, contentType: "image/png"});
}

async function finishPaint(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test("exported Manyfold page renders a modified box and keeps Save variant inert", async ({page}, info) => {
  await page.goto("index.html");
  await expect(page.locator("#main-navbar")).toBeVisible();
  await expect(page.locator("#footer")).toBeVisible();
  await expect(page.locator("[data-generate]")).toBeEnabled();
  const {url, source} = await sourceDocument(page, "simple_box.scad");
  await expect(page.locator("[data-parameters] input")).toHaveCount(3);
  await expect(page.getByRole("button", {name: "Save variant", exact: true})).toBeVisible();
  await expect(page.locator("[data-save]")).toBeDisabled();
  await page.getByLabel("Width in millimetres", {exact: true}).fill("150");
  await page.locator("[data-generate]").click();
  await expect(page.locator("[data-download]")).toBeEnabled();
  await expect(page.locator("[data-save]")).toBeEnabled();
  const mesh = await downloadMesh(page, info, "box-wide.stl");
  expect(mesh.bounds.max.map((value, axis) => value - mesh.bounds.min[axis])).toEqual([150, 80, 40]);

  const canvas = page.locator("[data-preview]");
  const beforeRotation = await canvas.evaluate(node => node.toDataURL());
  await canvas.focus();
  await canvas.press("ArrowRight");
  expect(await canvas.evaluate(node => node.toDataURL())).not.toBe(beforeRotation);

  const status = await page.locator("[data-status]").textContent();
  const beforeSave = network.get(page).requests.length, pageURL = page.url();
  await page.locator("[data-save]").click();
  // Let the submit event and two paint frames finish before checking the no-op.
  await finishPaint(page);
  expect(network.get(page).requests).toHaveLength(beforeSave);
  expect(page.url()).toBe(pageURL);
  await expect(page.locator("[data-status]")).toHaveText(status);
  await expect(page.locator("[data-saved]")).toBeEmpty();
  await expect(page.locator("[data-errors]")).toBeHidden();
  await expect(page.locator("[data-save]")).toBeEnabled();
  await expect(page.locator("[data-download]")).toBeEnabled();
  expect((await downloadMesh(page, info, "box-after-save.stl")).bounds).toEqual(mesh.bounds);
  await screenshot(page, info, "simple-box-demo");

  await page.getByLabel("Width in millimetres", {exact: true}).fill("155");
  await expect(page.locator("[data-stale]")).toBeVisible();
  await expect(page.locator("[data-download]")).toBeDisabled();
  await expect(page.locator("[data-save]")).toBeDisabled();
  await page.locator("[data-reset]").click();
  await expect(page.getByLabel("Width in millimetres", {exact: true})).toHaveValue("100");
  await expect(page.locator("[data-download]")).toBeDisabled();
  expect(await (await page.request.get(url)).json()).toEqual(source);

  const beforeNavigation = network.get(page).requests.length;
  // Preserve the host navigation visually, but its server-dependent links are inert.
  await page.locator("#nav-link-models").click({force: true});
  await finishPaint(page);
  expect(page.url()).toBe(pageURL);
  expect(network.get(page).requests).toHaveLength(beforeNavigation);
});

test("featureful export discovers typed controls and renders vector offsets", async ({page}, info) => {
  await page.goto("index.html");
  await expect(page.locator("[data-generate]")).toBeEnabled();
  await page.locator('a[href$="controls.html"]').first().click();
  await expect(page).toHaveURL(/\/manyfold_openscad\/controls\.html$/);
  await expect(page.locator("#main-navbar")).toBeVisible();
  await expect(page.locator("#footer")).toBeVisible();
  await expect(page.locator("[data-generate]")).toBeEnabled();
  const {url, source} = await sourceDocument(page, "customizer_box.scad");
  await expect(page.locator("[data-parameters] fieldset legend")).toHaveText(["Dimensions", "Appearance"]);
  await expect(page.locator("[data-parameters] label")).toHaveCount(8);
  await expect(page.getByLabel("Label text", {exact: true})).toHaveValue('A "quoted" box');
  await page.getByLabel("Surface finish", {exact: true}).selectOption({label: "Rough"});
  await page.getByLabel("Add a lid", {exact: true}).check();
  await page.getByLabel("Label text", {exact: true}).fill('quoted "; cube(900); //');
  await page.getByLabel("Position in millimetres 1", {exact: true}).fill("3");
  await page.getByLabel("Wall thickness", {exact: true}).selectOption({label: "Thick"});
  await page.locator("[data-generate]").click();
  await expect(page.locator("[data-download]")).toBeEnabled();
  const mesh = await downloadMesh(page, info, "featureful-box.stl");
  expect(mesh.bounds.min).toEqual([3, 0, 0]);
  expect(mesh.bounds.max).toEqual([103, 80, 40]);
  expect(mesh.triangles).toBeGreaterThan(12);
  await screenshot(page, info, "featureful-box-demo");
  await page.locator("[data-reset]").click();
  await expect(page.getByLabel("Label text", {exact: true})).toHaveValue('A "quoted" box');
  await expect(page.getByLabel("Position in millimetres 1", {exact: true})).toHaveValue("0");
  await expect(page.getByLabel("Add a lid", {exact: true})).not.toBeChecked();
  await expect(page.getByLabel("Surface finish", {exact: true})).toHaveValue("0");
  await expect(page.getByLabel("Wall thickness", {exact: true})).toHaveValue("1");
  expect(await (await page.request.get(url)).json()).toEqual(source);
  await page.locator('a[href$="index.html"]').first().click();
  await expect(page).toHaveURL(/\/manyfold_openscad\/index\.html$/);
  await expect(page.locator("[data-generate]")).toBeEnabled();
  await expect(page.locator("[data-parameters] input")).toHaveCount(3);
});
