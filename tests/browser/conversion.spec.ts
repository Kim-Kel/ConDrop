import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import JSZip from "jszip";

const harness = `/@fs/${path.resolve("tests/browser/harness.ts").replaceAll("\\", "/")}`;
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
