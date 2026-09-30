// Test emitted worker / WASM URLs under a GitHub Pages project subdirectory.
import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import JSZip from "jszip";

const root = path.resolve(process.argv[2] || "dist");
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/ConDrop/")) { res.writeHead(404).end(); return; }
    const file = path.resolve(root, decodeURIComponent(url.pathname.slice("/ConDrop/".length)) || "index.html");
    if (!file.startsWith(root + path.sep)) throw new Error("Outside root");
    const mime = { ".js": "text/javascript", ".wasm": "application/wasm", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml" };
    res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const failures = [], external = [], wasm = [];
  page.on("pageerror", error => failures.push(error.message));
  context.on("request", request => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(origin + "/")) external.push(request.url());
    if (request.url().endsWith(".wasm")) wasm.push(request.url());
  });
  context.on("response", response => {
    if (response.status() >= 400 && ["document", "script", "stylesheet", "fetch", "xhr"].includes(response.request().resourceType())) failures.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(`${origin}/ConDrop/`);
  await page.locator('input[type="file"]').setInputFiles({ name: "curved.STP", mimeType: "application/octet-stream",
    buffer: await fs.readFile("node_modules/occt-import-js/test/testfiles/rounded-cube/rounded-cube.step") });
  for (const format of ["FBX", "OBJ", "GLB", "USD"]) {
    await page.locator(".format-card").filter({ has: page.locator("strong", { hasText: new RegExp(`^${format}$`) }) }).click();
    const pending = page.waitForEvent("download", { timeout: 60000 });
    await page.getByRole("button", { name: "Convert 1 file" }).click();
    const download = await pending;
    const data = await fs.readFile(await download.path());
    if (format === "GLB") assert.equal(data.toString("utf8", 0, 4), "glTF");
    else {
      const zip = await JSZip.loadAsync(data);
      assert(Object.keys(zip.files).some(name => name.endsWith(`.${format.toLowerCase()}`)));
      if (format === "OBJ") assert(Object.keys(zip.files).some(name => name.endsWith(".mtl")));
    }
    console.log(`Static /ConDrop/ STEP → ${format}: ${data.length} bytes`);
  }
  assert(wasm.length > 0, "WASM loaded from the static site");
  assert(wasm.every(url => url.startsWith(`${origin}/ConDrop/`)), "Project-relative WASM URL");
  assert.deepEqual(failures, []); assert.deepEqual(external, []);
  console.log("Static worker/WASM passed; no external requests or browser errors.");
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
