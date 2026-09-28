import JSZip from "jszip";
import { USDAParser } from "three/examples/jsm/loaders/usd/USDAParser.js";
import { USDCParser } from "three/examples/jsm/loaders/usd/USDCParser.js";

// Detect unsupported composition and geometry before three.js can silently
// return a plausible but incomplete model. No files referenced by USD are fetched.
export async function validateUsd(data: ArrayBuffer, name: string) {
  const files = new Map<string, ArrayBuffer>();
  const bytes = new Uint8Array(data);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const zip = await JSZip.loadAsync(data);
    for (const entry of Object.values(zip.files)) if (!entry.dir) files.set(entry.name, await entry.async("arraybuffer"));
  } else files.set(name, data);
  const { resourcePath } = await import("./model-loader");
  for (const [path, buffer] of files) {
    if (!/\.(usd|usda|usdc)$/i.test(path)) continue;
    const binary = new TextDecoder().decode(buffer.slice(0, 8)) === "PXR-USDC";
    const text = binary ? "" : new TextDecoder().decode(buffer);
    if (/\bsubLayers\s*=/.test(text)) throw new Error("USD subLayers 합성은 현재 지원되지 않습니다. Flatten된 USD 또는 참조 레이어를 포함한 ZIP을 사용해 주세요.");
    const parsed = binary ? new USDCParser().parseData(buffer) : new USDAParser().parseData(text);
    const base = path.slice(0, path.lastIndexOf("/") + 1);
    const validateAsset = (asset: string) => {
      if (asset) resourcePath(asset, files.keys(), base);
    };
    const references = (value: unknown) => {
      if (typeof value === "string") {
        for (const match of value.matchAll(/@([^@]+)@/g)) validateAsset(match[1]);
      } else if (Array.isArray(value)) value.forEach(references);
      else if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
          if (key === "assetPath" && typeof item === "string") validateAsset(item);
          else references(item);
        }
      }
    };
    for (const [prim, spec] of Object.entries(parsed.specsByPath)) {
      const fields = spec.fields;
      if (["NurbsPatch", "NurbsCurves", "BasisCurves", "Volume"].includes(String(fields.typeName))) {
        throw new Error(`USD의 ${fields.typeName} 요소는 지원되지 않습니다 (${prim}). 곡면을 메시로 테셀레이션한 파일을 사용해 주세요.`);
      }
      if (fields.subLayers || fields.subLayerPaths) throw new Error("USD subLayers 합성은 현재 지원되지 않습니다.");
      if (prim.endsWith(".subdivisionScheme") && fields.default && fields.default !== "none") {
        throw new Error("USD subdivision surface는 테셀레이션된 메시로 저장되어 있어야 합니다.");
      }
      if (fields.typeName === "asset" && typeof fields.default === "string") validateAsset(fields.default);
      if (fields.typeName === "asset" && fields.default && typeof fields.default === "object") references(fields.default);
      references(fields.references); references(fields.payload);
    }
  }
}
