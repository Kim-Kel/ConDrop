import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import JSZip from "jszip";

const harness = `/@fs/${path.resolve("tests/browser/harness.ts").replaceAll("\\", "/")}`;
const stepFixture = (name: string) => fs.readFileSync(`node_modules/occt-import-js/test/testfiles/${name}`);

test("STEP curved tessellation levels, ZIP, assembly hierarchy and units", async ({ page, context }) => {
  const external: string[] = [];
  context.on("request", request => { if (/^https?:/.test(request.url()) && !request.url().startsWith("http://127.0.0.1:4173")) external.push(request.url()); });
  await page.goto("/");
  const inspect = (bytes: Buffer, quality: "low" | "medium" | "high", zipped = false) => page.evaluate(async ({ harness, bytes, quality, zipped }) => (await import(/* @vite-ignore */ harness)).inspectStep(bytes, quality, zipped), { harness, bytes: Array.from(bytes), quality, zipped });
  const rounded = stepFixture("rounded-cube/rounded-cube.step");
  const low = await inspect(rounded, "low");
  const medium = await inspect(rounded, "medium");
  const high = await inspect(rounded, "high", true);
  expect(low.triangles).toBeLessThan(medium.triangles);
  expect(medium.triangles).toBeLessThan(high.triangles);
  for (const unit of ["mm", "m", "in"]) {
    const result = await inspect(stepFixture(`cube-units/cube-${unit}.step`), "medium");
    expect(result.hierarchy).toEqual(["Part"]);
    for (const side of result.size) expect(side).toBeCloseTo(1, 6);
  }
  expect(external).toEqual([]);
  console.log("STEP triangle counts", { low: low.triangles, medium: medium.triangles, high: high.triangles });
});

test("STEP per-face colors survive FBX, OBJ/MTL and USD export", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async ({ harness, bytes }) => (await import(/* @vite-ignore */ harness)).stepColorRoundTrip(bytes), { harness, bytes: Array.from(stepFixture("cube-fcstd/cube2.step")) });
  expect(result).toHaveLength(6);
});

test("STEP input switches tabs, quality changes the downloaded output", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "curved.stp", mimeType: "application/octet-stream", buffer: stepFixture("rounded-cube/rounded-cube.step") });
  await expect(page.getByRole("button", { name: "3D", exact: true })).toHaveClass("active");
  const counts: number[] = [];
  for (const [quality, format] of [["하", "GLB"], ["중", "OBJ"], ["상", "FBX"], ["상", "USD"]]) {
    const choice = page.getByRole("group", { name: "STEP 테셀레이션 품질" }).getByRole("button", { name: quality, exact: true });
    await choice.click(); await expect(choice).toHaveAttribute("aria-pressed", "true");
    await page.locator(".format-card").filter({ has: page.locator("strong", { hasText: new RegExp(`^${format}$`) }) }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Convert 1 file" }).click();
    const saved = await download;
    const bytes = fs.readFileSync((await saved.path())!);
    const info = await page.evaluate(async ({ harness, bytes, name }) => (await import(/* @vite-ignore */ harness)).inspectFile(bytes, name), { harness, bytes: Array.from(bytes), name: saved.suggestedFilename() });
    counts.push(info.triangles);
    await expect(page.getByRole("button", { name: "Convert 1 file" })).toBeEnabled();
  }
  expect(counts[0]).toBeLessThan(counts[1]); expect(counts[1]).toBeLessThan(counts[2]); expect(counts[2]).toBe(counts[3]);
});
for (const name of ["runRouting", "runStl", "runSkp", "runObjTextures", "runGlbAnimation", "runFbxRoundTrip", "runUsdRoundTrip", "runFailures"]) {
  test(name, async ({ page }) => {
    const external: string[] = [];
    page.on("request", (request) => { if (/^https?:/.test(request.url()) && !request.url().startsWith("http://127.0.0.1:4173")) external.push(request.url()); });
    await page.goto("/");
    const result = await page.evaluate(async ({ harness, name }) => (await import(/* @vite-ignore */ harness))[name](), { harness, name });
    expect(result).toBeTruthy(); expect(external).toEqual([]);
    console.log(name, result);
  });
}

test("OpenUSD-generated USDC input, USD extension detection, and USDZ", async ({ page }) => {
  await page.goto("/");
  const bytes = fs.readFileSync("tests/fixtures/triangle.usdc");
  for (const name of ["triangle.usdc", "triangle.usd", "triangle.usdz"]) {
    const zip = new JSZip().file("triangle.usdc", bytes);
    const contents = name.endsWith(".usdz") ? await zip.generateAsync({ type: "uint8array" }) : bytes;
    const info = await page.evaluate(async ({ harness, bytes, name }) => (await import(/* @vite-ignore */ harness)).inspectFile(bytes, name), { harness, bytes: Array.from(contents), name });
    expect(info.triangles).toBe(1); expect(info.size).toEqual([2, 3, 0]);
  }
});

test("write USD export for optional independent OpenUSD validation", async ({ page }, testInfo) => {
  await page.goto("/");
  const bytes = await page.evaluate(async (harness) => (await import(/* @vite-ignore */ harness)).usdForIndependentCheck(), harness);
  fs.writeFileSync(testInfo.outputPath("validation.zip"), Buffer.from(bytes));
});

for (const name of ["chair_and_table.skp", "saeukkang.usdz"]) {
  test(`optional upstream sample: ${name}`, async ({ page }) => {
    test.skip(!fs.existsSync(`work/fixtures/${name}`), "Local external sample, not required by CI");
    await page.goto("/");
    const info = await page.evaluate(async ({ harness, bytes, name }) => (await import(/* @vite-ignore */ harness)).inspectFile(bytes, name), { harness, bytes: Array.from(fs.readFileSync(`work/fixtures/${name}`)), name });
    expect(info.triangles).toBeGreaterThan(10);
    console.log(name, info);
  });
}

test("file selection and drops switch both directions, queues survive, STL downloads", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "test.stl", mimeType: "application/octet-stream", buffer: Buffer.from("solid a\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid a") });
  await expect(page.getByRole("button", { name: "3D", exact: true })).toHaveClass("active");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Convert 1 file" }).click();
  expect((await download).suggestedFilename()).toBe("test_cvt.glb");
  await page.evaluate(() => {
    const data = new DataTransfer();
    const canvas = document.createElement("canvas"); canvas.width = 2; canvas.height = 2;
    const bytes = Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), c => c.charCodeAt(0));
    data.items.add(new File([bytes], "pixel.png", { type: "image/png" }));
    document.querySelector(".drop-card")!.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: data }));
  });
  await expect(page.getByRole("button", { name: "Image", exact: true })).toHaveClass("active");
  await expect(page.getByText("pixel.png", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const data = new DataTransfer(); data.items.add(new File(["fixture"], "drop.fbx"));
    document.querySelector(".drop-card")!.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: data }));
  });
  await expect(page.getByRole("button", { name: "3D", exact: true })).toHaveClass("active");
  await expect(page.getByText("test.stl", { exact: true })).toBeVisible();
  await expect(page.getByText("drop.fbx", { exact: true })).toBeVisible();
});
