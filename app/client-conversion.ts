import JSZip from "jszip";
import { readPsd } from "ag-psd";
import * as UTIF from "utif";
import * as THREE from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { USDLoader } from "three/examples/jsm/loaders/USDLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

export type ImageFormat = "png" | "jpg";
export type ModelFormat = "glb" | "obj" | "usd";

export interface ImageOptions {
  format: ImageFormat;
  resize: number;
  flipX: boolean;
  flipY: boolean;
  alpha: boolean;
  compression: number;
  layerMode: "merged" | "separated";
}

export interface ImageAnalysis {
  width: number;
  height: number;
  previewUrl: string;
  layers: number;
  note?: string;
}

const imageMime: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon",
};

const extOf = (name: string) => name.split(".").pop()?.toLowerCase() || "";
export const stemOf = (name: string) => name.replace(/\.[^.]+$/, "");
const safeName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "layer";
const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("이미지를 인코딩하지 못했습니다.")), type, quality));

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function bitmapCanvas(file: File) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d", { willReadFrequently: true })!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

async function tiffCanvas(file: File) {
  const buffer = await file.arrayBuffer();
  const ifds = UTIF.decode(buffer);
  if (!ifds.length) throw new Error("TIFF 프레임을 찾지 못했습니다.");
  UTIF.decodeImage(buffer, ifds[0]);
  const rgba = UTIF.toRGBA8(ifds[0]);
  const canvas = document.createElement("canvas");
  canvas.width = ifds[0].width;
  canvas.height = ifds[0].height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba), canvas.width, canvas.height), 0, 0);
  return canvas;
}

async function psdData(file: File) {
  return readPsd(await file.arrayBuffer(), { skipThumbnail: true });
}

async function exrCanvas(file: File) {
  const image = new EXRLoader().parse(await file.arrayBuffer()) as unknown as { data: Float32Array | Uint16Array; width: number; height: number };
  const rgba = new Uint8ClampedArray(image.width * image.height * 4);
  const values = image.data;
  const half = values instanceof Uint16Array;
  const channels = Math.max(1, Math.round(values.length / (image.width * image.height)));
  const tone = (value: number) => {
    const linear = Math.max(0, value);
    const mapped = linear / (1 + linear);
    return Math.round(Math.pow(mapped, 1 / 2.2) * 255);
  };
  for (let i = 0; i < image.width * image.height; i++) {
    const read = (c: number) => {
      const raw = values[i * channels + Math.min(c, channels - 1)] ?? 0;
      return half ? THREE.DataUtils.fromHalfFloat(raw) : raw;
    };
    rgba[i * 4] = tone(read(0));
    rgba[i * 4 + 1] = tone(read(channels > 1 ? 1 : 0));
    rgba[i * 4 + 2] = tone(read(channels > 2 ? 2 : 0));
    rgba[i * 4 + 3] = channels > 3 ? Math.round(THREE.MathUtils.clamp(read(3), 0, 1) * 255) : 255;
  }
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.putImageData(new ImageData(rgba, image.width, image.height), 0, 0);
  return canvas;
}

async function sourceCanvas(file: File) {
  const ext = extOf(file.name);
  if (ext === "psd") {
    const psd = await psdData(file);
    if (!psd.canvas) throw new Error("PSD 병합 이미지를 읽지 못했습니다.");
    const canvas = document.createElement("canvas");
    canvas.width = psd.width;
    canvas.height = psd.height;
    canvas.getContext("2d")!.drawImage(psd.canvas, 0, 0);
    return canvas;
  }
  if (ext === "tif" || ext === "tiff") return tiffCanvas(file);
  if (ext === "exr") return exrCanvas(file);
  return bitmapCanvas(file);
}

function countPsdLayers(children: unknown): number {
  if (!Array.isArray(children)) return 0;
  return children.reduce((sum, layer) => {
    const item = layer as { children?: unknown; canvas?: HTMLCanvasElement };
    return sum + (item.children ? countPsdLayers(item.children) : item.canvas ? 1 : 0);
  }, 0);
}

export async function analyzeImage(file: File): Promise<ImageAnalysis> {
  const ext = extOf(file.name);
  if (ext === "psd") {
    const psd = await psdData(file);
    if (!psd.canvas) throw new Error("PSD 미리보기를 만들 수 없습니다.");
    const blob = await canvasToBlob(psd.canvas, "image/png");
    return { width: psd.width, height: psd.height, previewUrl: URL.createObjectURL(blob), layers: countPsdLayers(psd.children) };
  }
  const canvas = await sourceCanvas(file);
  const blob = await canvasToBlob(canvas, "image/png");
  const note = ext === "gif" ? "Animated GIF는 첫 프레임을 변환합니다." : ext === "exr" ? "HDR 톤을 화면용 sRGB로 매핑합니다." : undefined;
  return { width: canvas.width, height: canvas.height, previewUrl: URL.createObjectURL(blob), layers: 0, note };
}

function transformedCanvas(source: HTMLCanvasElement, options: ImageOptions, forceOpaque = false) {
  const scale = THREE.MathUtils.clamp(options.resize, 1, 100) / 100;
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  if (forceOpaque || (options.format === "png" && !options.alpha)) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.translate(options.flipX ? width : 0, options.flipY ? height : 0);
  ctx.scale(options.flipX ? -1 : 1, options.flipY ? -1 : 1);
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

async function encodeCanvas(source: HTMLCanvasElement, options: ImageOptions) {
  const isJpg = options.format === "jpg";
  const canvas = transformedCanvas(source, options, isJpg);
  const quality = isJpg ? Math.max(.18, 1 - (options.compression - 1) * .09) : undefined;
  return canvasToBlob(canvas, isJpg ? "image/jpeg" : "image/png", quality);
}

function flattenLayers(children: unknown, result: Array<{ name: string; canvas: HTMLCanvasElement; left: number; top: number }> = []) {
  if (!Array.isArray(children)) return result;
  for (const value of children) {
    const layer = value as { name?: string; canvas?: HTMLCanvasElement; left?: number; top?: number; children?: unknown };
    if (layer.children) flattenLayers(layer.children, result);
    else if (layer.canvas) result.push({ name: layer.name || `Layer ${result.length + 1}`, canvas: layer.canvas, left: layer.left || 0, top: layer.top || 0 });
  }
  return result;
}

async function exportSeparatedPsd(file: File, options: ImageOptions) {
  const psd = await psdData(file);
  const zip = new JSZip();
  const layers = flattenLayers(psd.children);
  if (!layers.length) throw new Error("내보낼 PSD 레이어를 찾지 못했습니다.");
  for (let index = 0; index < layers.length; index++) {
    const layer = layers[index];
    const full = document.createElement("canvas");
    full.width = psd.width;
    full.height = psd.height;
    full.getContext("2d")!.drawImage(layer.canvas, layer.left, layer.top);
    const blob = await encodeCanvas(full, options);
    zip.file(`${String(index + 1).padStart(2, "0")}_${safeName(layer.name)}.${options.format}`, blob);
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export async function exportImages(files: File[], options: ImageOptions, onProgress: (message: string) => void) {
  const outputs: Array<{ name: string; blob: Blob }> = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    onProgress(`${index + 1}/${files.length} · ${file.name}`);
    const stem = `${stemOf(file.name)}_cvt`;
    if (extOf(file.name) === "psd" && options.layerMode === "separated") {
      outputs.push({ name: `${stem}_layers.zip`, blob: await exportSeparatedPsd(file, options) });
    } else {
      outputs.push({ name: `${stem}.${options.format}`, blob: await encodeCanvas(await sourceCanvas(file), options) });
    }
  }
  if (outputs.length === 1) return downloadBlob(outputs[0].blob, outputs[0].name);
  const zip = new JSZip();
  outputs.forEach((output) => zip.file(output.name, output.blob));
  downloadBlob(await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } }), "condrop_images_cvt.zip");
}

type ModelPackage = { scene: THREE.Object3D; cleanup: () => void };

const modelMime = (name: string) => {
  const ext = extOf(name);
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "bin") return "application/octet-stream";
  return "application/octet-stream";
};

function normalizePath(path: string) {
  return decodeURIComponent(path).replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

async function parseWithLoader(name: string, data: ArrayBuffer | string, manager: THREE.LoadingManager, mtlText?: string): Promise<THREE.Object3D> {
  const ext = extOf(name);
  if (ext === "glb" || ext === "gltf") {
    const loader = new GLTFLoader(manager);
    return new Promise((resolve, reject) => loader.parse(data, "", (gltf) => resolve(gltf.scene), reject));
  }
  if (ext === "fbx") return new FBXLoader(manager).parse(data as ArrayBuffer, "");
  if (ext === "obj") {
    const loader = new OBJLoader(manager);
    if (mtlText) {
      const materials = new MTLLoader(manager).parse(mtlText, "");
      materials.preload();
      loader.setMaterials(materials);
    }
    return loader.parse(data as string);
  }
  if (["usd", "usda", "usdc", "usdz"].includes(ext)) {
    const loader = new USDLoader(manager);
    return new Promise((resolve, reject) => {
      try {
        loader.parse(data, "", (group) => resolve(group), reject);
      } catch (error) {
        reject(error);
      }
    });
  }
  throw new Error(`지원되지 않는 3D 형식: .${ext}`);
}

async function loadModel(file: File): Promise<ModelPackage> {
  const urls: string[] = [];
  const manager = new THREE.LoadingManager();
  if (extOf(file.name) !== "zip") {
    const ext = extOf(file.name);
    const data = ext === "obj" || ext === "gltf" ? await file.text() : await file.arrayBuffer();
    const scene = await parseWithLoader(file.name, data, manager);
    return { scene, cleanup: () => undefined };
  }

  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && !entry.name.startsWith("__MACOSX/"));
  const primary = entries.find((entry) => /\.(glb|gltf|fbx|obj|usd|usda|usdc|usdz)$/i.test(entry.name));
  if (!primary) throw new Error("ZIP 안에서 OBJ, FBX, GLB, GLTF 또는 USD 모델을 찾지 못했습니다.");

  const resources = new Map<string, string>();
  for (const entry of entries) {
    const blob = await entry.async("blob");
    const url = URL.createObjectURL(new Blob([blob], { type: modelMime(entry.name) }));
    urls.push(url);
    resources.set(normalizePath(entry.name), url);
    resources.set(normalizePath(entry.name.split("/").pop() || entry.name), url);
  }
  manager.setURLModifier((requested) => resources.get(normalizePath(requested)) || resources.get(normalizePath(requested.split("/").pop() || requested)) || requested);
  const ext = extOf(primary.name);
  const data = ext === "obj" || ext === "gltf" ? await primary.async("text") : await primary.async("arraybuffer");
  const mtl = entries.find((entry) => /\.mtl$/i.test(entry.name));
  const scene = await parseWithLoader(primary.name, data, manager, mtl ? await mtl.async("text") : undefined);
  return { scene, cleanup: () => urls.forEach(URL.revokeObjectURL) };
}

function scaledScene(input: THREE.Object3D, factor: number) {
  input.updateMatrixWorld(true);
  input.scale.multiplyScalar(factor);
  input.updateMatrixWorld(true);
  return input;
}

async function exportGlb(scene: THREE.Object3D) {
  const result = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: false, trs: false });
  return new Blob([result as ArrayBuffer], { type: "model/gltf-binary" });
}

async function textureBlob(texture: THREE.Texture) {
  const image = texture.image as CanvasImageSource & { data?: ArrayLike<number>; width?: number; height?: number };
  if (!image || !image.width || !image.height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d")!;
  if (image.data) {
    const pixelCount = image.width * image.height;
    const channels = Math.max(1, Math.min(4, Math.floor(image.data.length / pixelCount)));
    const pixels = context.createImageData(image.width, image.height);
    const scale = image.data instanceof Float32Array || image.data instanceof Float64Array
      ? 255
      : image.data instanceof Uint16Array ? 255 / 65535
        : image.data instanceof Uint32Array ? 255 / 4294967295 : 1;
    const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value * scale)));
    for (let pixel = 0; pixel < pixelCount; pixel++) {
      const source = pixel * channels;
      const target = pixel * 4;
      pixels.data[target] = byte(image.data[source] ?? 0);
      pixels.data[target + 1] = byte(image.data[source + (channels >= 3 ? 1 : 0)] ?? 0);
      pixels.data[target + 2] = byte(image.data[source + (channels >= 3 ? 2 : 0)] ?? 0);
      pixels.data[target + 3] = channels === 2 || channels === 4 ? byte(image.data[source + channels - 1] ?? 255) : 255;
    }
    context.putImageData(pixels, 0, 0);
  } else {
    context.drawImage(image, 0, 0);
  }
  return canvasToBlob(canvas, "image/png");
}

const usdNumber = (value: number) => {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.abs(value) < 1e-10 ? 0 : Number(value.toFixed(9));
  return String(rounded);
};

const usdIdentifier = (value: string, fallback: string) => {
  const clean = value.replace(/[^A-Za-z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
  return clean || fallback;
};

type MaterialCatalog = { materials: Map<string, THREE.Material>; names: Map<string, string> };

function materialCatalog(scene: THREE.Object3D): MaterialCatalog {
  const materials = new Map<string, THREE.Material>();
  const names = new Map<string, string>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    sourceMaterials.forEach((material) => {
      if (!material || names.has(material.uuid)) return;
      let name = usdIdentifier(material.name, `Material_${materials.size + 1}`);
      while (materials.has(name)) name = `${name}_${materials.size + 1}`;
      names.set(material.uuid, name);
      materials.set(name, material);
    });
  });
  return { materials, names };
}

function meshMaterialGroups(mesh: THREE.Mesh) {
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  const index = geometry.index;
  const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const sourceGroups = geometry.groups.length ? geometry.groups : [{ start: 0, count: index ? index.count : position.count, materialIndex: 0 }];
  const grouped = new Map<number, Array<{ start: number; count: number }>>();
  sourceGroups.forEach((group) => {
    const requested = group.materialIndex ?? 0;
    const materialIndex = sourceMaterials[requested] ? requested : 0;
    const ranges = grouped.get(materialIndex) || [];
    ranges.push({ start: group.start, count: group.count });
    grouped.set(materialIndex, ranges);
  });
  return { sourceMaterials, groups: [...grouped.entries()].map(([materialIndex, ranges]) => ({ materialIndex, ranges })) };
}

async function addBaseColorTextures(zip: JSZip, catalog: MaterialCatalog) {
  const textureNames = new Map<string, string>();
  for (const [name, base] of catalog.materials) {
    const material = base as THREE.MeshStandardMaterial;
    if (!material.map) continue;
    const blob = await textureBlob(material.map);
    if (!blob) throw new Error(`${name} 재질의 베이스 컬러 텍스처를 PNG로 내보낼 수 없습니다.`);
    const textureName = `${name}_basecolor.png`;
    zip.file(textureName, blob);
    textureNames.set(material.uuid, textureName);
  }
  return textureNames;
}

export function exportObjText(scene: THREE.Object3D, stem: string, catalog = materialCatalog(scene)) {
  scene.updateMatrixWorld(true);
  const lines = [`# ConDrop OBJ`, `mtllib ${safeName(stem)}.mtl`, ``];
  let vertexOffset = 0;
  let uvOffset = 0;
  let normalOffset = 0;
  let partIndex = 0;

  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    const normal = geometry.attributes.normal;
    const hasUv = Boolean(uv && uv.count >= position.count);
    const hasNormal = Boolean(normal && normal.count >= position.count);
    const index = geometry.index;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const vector = new THREE.Vector3();
    const { sourceMaterials, groups } = meshMaterialGroups(mesh);

    groups.forEach((group, groupIndex) => {
      const material = sourceMaterials[group.materialIndex] || sourceMaterials[0];
      const materialName = catalog.names.get(material.uuid) || `Material_${partIndex + 1}`;
      const objectName = usdIdentifier(mesh.name, `Mesh_${partIndex + 1}`) + (groups.length > 1 ? `_Part_${groupIndex + 1}` : "");
      lines.push(`o ${objectName}`, `usemtl ${materialName}`);
      for (let vertex = 0; vertex < position.count; vertex++) {
        mesh.getVertexPosition(vertex, vector).applyMatrix4(mesh.matrixWorld);
        lines.push(`v ${usdNumber(vector.x)} ${usdNumber(vector.y)} ${usdNumber(vector.z)}`);
      }
      if (hasUv) {
        for (let vertex = 0; vertex < position.count; vertex++) lines.push(`vt ${usdNumber(uv.getX(vertex))} ${usdNumber(uv.getY(vertex))}`);
      }
      if (hasNormal) {
        for (let vertex = 0; vertex < position.count; vertex++) {
          vector.fromBufferAttribute(normal as THREE.BufferAttribute, vertex).applyNormalMatrix(normalMatrix);
          lines.push(`vn ${usdNumber(vector.x)} ${usdNumber(vector.y)} ${usdNumber(vector.z)}`);
        }
      }
      group.ranges.forEach((range) => {
        const end = Math.min(range.start + range.count, index ? index.count : position.count);
        for (let offset = range.start; offset + 2 < end; offset += 3) {
          const refs: string[] = [];
          for (let corner = 0; corner < 3; corner++) {
            const vertex = index ? index.getX(offset + corner) : offset + corner;
            const positionRef = vertexOffset + vertex + 1;
            const uvRef = hasUv ? uvOffset + vertex + 1 : "";
            const normalRef = hasNormal ? normalOffset + vertex + 1 : "";
            refs.push(hasUv || hasNormal ? `${positionRef}/${uvRef}${hasNormal ? `/${normalRef}` : ""}` : String(positionRef));
          }
          lines.push(`f ${refs.join(" ")}`);
        }
      });
      lines.push("");
      vertexOffset += position.count;
      if (hasUv) uvOffset += position.count;
      if (hasNormal) normalOffset += position.count;
      partIndex++;
    });
  });
  if (!partIndex) throw new Error("OBJ로 내보낼 삼각형 메시를 찾지 못했습니다.");
  return lines.join("\n");
}

async function exportObj(scene: THREE.Object3D, stem: string) {
  const zip = new JSZip();
  const internalStem = safeName(stem);
  const catalog = materialCatalog(scene);
  const textureNames = await addBaseColorTextures(zip, catalog);
  zip.file(`${internalStem}.obj`, exportObjText(scene, internalStem, catalog));
  const lines = [`# ConDrop material package`, `# Generated locally in your browser`, ``];
  for (const [name, base] of catalog.materials) {
    const material = base as THREE.MeshStandardMaterial;
    const color = material.color || new THREE.Color(1, 1, 1);
    lines.push(`newmtl ${name}`, `Kd ${color.r.toFixed(6)} ${color.g.toFixed(6)} ${color.b.toFixed(6)}`, `d ${(material.opacity ?? 1).toFixed(6)}`);
    const textureName = textureNames.get(material.uuid);
    if (textureName) lines.push(`map_Kd ${textureName}`);
    lines.push("");
  }
  zip.file(`${internalStem}.mtl`, lines.join("\n"));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

function materialUsda(materials: Map<string, THREE.Material>, textureNames = new Map<string, string>()) {
  const lines = [`    def Scope "Materials"`, "    {"];
  for (const [name, base] of materials) {
    const material = base as THREE.MeshStandardMaterial;
    const color = material.color || new THREE.Color(1, 1, 1);
    const emissive = material.emissive || new THREE.Color(0, 0, 0);
    const textureName = textureNames.get(material.uuid);
    lines.push(
      `        def Material "${name}"`,
      "        {",
      `            token outputs:surface.connect = </Root/Materials/${name}/PreviewSurface.outputs:surface>`,
      `            def Shader "PreviewSurface"`,
      "            {",
      `                uniform token info:id = "UsdPreviewSurface"`,
      textureName
        ? `                color3f inputs:diffuseColor.connect = </Root/Materials/${name}/BaseColorTexture.outputs:rgb>`
        : `                color3f inputs:diffuseColor = (${usdNumber(color.r)}, ${usdNumber(color.g)}, ${usdNumber(color.b)})`,
      `                color3f inputs:emissiveColor = (${usdNumber(emissive.r)}, ${usdNumber(emissive.g)}, ${usdNumber(emissive.b)})`,
      `                float inputs:metallic = ${usdNumber(material.metalness ?? 0)}`,
      `                float inputs:roughness = ${usdNumber(material.roughness ?? 1)}`,
      `                float inputs:opacity = ${usdNumber(material.opacity ?? 1)}`,
      `                token outputs:surface`,
      "            }",
    );
    if (textureName) {
      lines.push(
        `            def Shader "BaseColorTexture"`,
        "            {",
        `                uniform token info:id = "UsdUVTexture"`,
        `                asset inputs:file = @./${textureName}@`,
        `                token inputs:sourceColorSpace = "sRGB"`,
        `                float4 inputs:scale = (${usdNumber(color.r)}, ${usdNumber(color.g)}, ${usdNumber(color.b)}, 1)`,
        `                float2 inputs:st.connect = </Root/Materials/${name}/UVReader.outputs:result>`,
        `                float3 outputs:rgb`,
        `                float outputs:a`,
        "            }",
        `            def Shader "UVReader"`,
        "            {",
        `                uniform token info:id = "UsdPrimvarReader_float2"`,
        `                token inputs:varname = "st"`,
        `                float2 outputs:result`,
        "            }",
      );
    }
    lines.push("        }");
  }
  lines.push("    }");
  return lines;
}

export function exportUsda(scene: THREE.Object3D, textureNames = new Map<string, string>()) {
  scene.updateMatrixWorld(true);
  const catalog = materialCatalog(scene);
  const meshBlocks: string[] = [];
  let meshIndex = 0;

  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    const index = geometry.index;
    const { sourceMaterials, groups } = meshMaterialGroups(mesh);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const points: string[] = [];
    const normals: string[] = [];
    const uvs: string[] = [];
    const vector = new THREE.Vector3();

    for (let vertex = 0; vertex < position.count; vertex++) {
      mesh.getVertexPosition(vertex, vector).applyMatrix4(mesh.matrixWorld);
      points.push(`(${usdNumber(vector.x)}, ${usdNumber(vector.y)}, ${usdNumber(vector.z)})`);
      if (normal) {
        vector.fromBufferAttribute(normal as THREE.BufferAttribute, vertex).applyNormalMatrix(normalMatrix);
        normals.push(`(${usdNumber(vector.x)}, ${usdNumber(vector.y)}, ${usdNumber(vector.z)})`);
      }
      if (uv) uvs.push(`(${usdNumber(uv.getX(vertex))}, ${usdNumber(uv.getY(vertex))})`);
    }

    groups.forEach((group, groupIndex) => {
      const sourceMaterial = sourceMaterials[group.materialIndex ?? 0] || sourceMaterials[0];
      const materialName = catalog.names.get(sourceMaterial.uuid) || `Material_${meshIndex + 1}`;
      const faceIndices: number[] = [];
      group.ranges.forEach((range) => {
        const end = Math.min(range.start + range.count, index ? index.count : position.count);
        for (let offset = range.start; offset + 2 < end; offset += 3) {
          faceIndices.push(index ? index.getX(offset) : offset, index ? index.getX(offset + 1) : offset + 1, index ? index.getX(offset + 2) : offset + 2);
        }
      });
      if (!faceIndices.length) return;
      const primName = usdIdentifier(mesh.name, `Mesh_${meshIndex + 1}`) + (groups.length > 1 ? `_Part_${groupIndex + 1}` : "");
      const faceCounts = new Array(faceIndices.length / 3).fill(3).join(", ");
      meshBlocks.push(
        `    def Mesh "${primName}_${meshIndex + 1}"`,
        "    {",
        `        int[] faceVertexCounts = [${faceCounts}]`,
        `        int[] faceVertexIndices = [${faceIndices.join(", ")}]`,
        `        point3f[] points = [${points.join(", ")}]`,
        ...(normals.length ? [`        normal3f[] normals = [${normals.join(", ")}]`, `        uniform token normalsInterpolation = "vertex"`] : []),
        ...(uvs.length ? [`        texCoord2f[] primvars:st = [${uvs.join(", ")}]`, `        uniform token primvars:st:interpolation = "vertex"`] : []),
        `        rel material:binding = </Root/Materials/${materialName}>`,
        `        uniform token subdivisionScheme = "none"`,
        `        bool doubleSided = ${sourceMaterial.side === THREE.DoubleSide ? "true" : "false"}`,
        "    }",
      );
      meshIndex++;
    });
  });

  if (!meshBlocks.length) throw new Error("USD로 내보낼 삼각형 메시를 찾지 못했습니다.");
  const lines = [
    "#usda 1.0",
    "(",
    `    defaultPrim = "Root"`,
    `    metersPerUnit = 1`,
    `    upAxis = "Y"`,
    ")",
    "",
    `def Xform "Root"`,
    "{",
    ...materialUsda(catalog.materials, textureNames),
    ...meshBlocks,
    "}",
    "",
  ];
  return new Blob([lines.join("\n")], { type: "model/vnd.usda" });
}

async function exportUsd(scene: THREE.Object3D, stem: string) {
  const zip = new JSZip();
  const internalStem = safeName(stem);
  const catalog = materialCatalog(scene);
  const textureNames = await addBaseColorTextures(zip, catalog);
  zip.file(`${internalStem}.usd`, exportUsda(scene, textureNames));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export async function exportModels(files: File[], format: ModelFormat, scale: number, onProgress: (message: string) => void) {
  const outputs: Array<{ name: string; blob: Blob }> = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    onProgress(`${index + 1}/${files.length} · ${file.name}`);
    const loaded = await loadModel(file);
    try {
      const scene = scaledScene(loaded.scene, scale);
      const stem = `${stemOf(file.name)}_cvt`;
      if (format === "glb") outputs.push({ name: `${stem}.glb`, blob: await exportGlb(scene) });
      else if (format === "obj") outputs.push({ name: `${stem}.zip`, blob: await exportObj(scene, stem) });
      else outputs.push({ name: `${stem}.zip`, blob: await exportUsd(scene, stem) });
    } finally {
      loaded.cleanup();
    }
  }
  if (outputs.length === 1) return downloadBlob(outputs[0].blob, outputs[0].name);
  const zip = new JSZip();
  outputs.forEach((output) => zip.file(output.name, output.blob));
  downloadBlob(await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } }), "condrop_3d_cvt.zip");
}

export const acceptedImages = ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "tif", "tiff", "psd", "exr"];
export const acceptedModels = ["obj", "fbx", "glb", "gltf", "usd", "usda", "usdc", "usdz", "zip"];
export const isAccepted = (file: File, mode: "image" | "3d") => (mode === "image" ? acceptedImages : acceptedModels).includes(extOf(file.name));
export const fileExtension = extOf;
export const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
