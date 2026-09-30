import JSZip from "jszip";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { TGALoader } from "three/examples/jsm/loaders/TGALoader.js";
import { USDLoader } from "three/examples/jsm/loaders/USDLoader.js";
import "./usd-materials";
import { acceptedModels, fileExtension } from "./file-routing";
import { validateFbxGeometry } from "./fbx-validation";
import { stepQuality, type ModelLoadOptions } from "./step-options";

export function normalizePath(path: string) {
  try { path = decodeURIComponent(path); } catch { /* Literal percent in filenames. */ }
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop(); else parts.push(part);
  }
  return parts.join("/").toLowerCase();
}

export function resourcePath(request: string, files: Iterable<string>, base = "") {
  const paths = Array.from(files);
  const exact = paths.filter((path) => normalizePath(path) === normalizePath(base + request));
  if (exact.length === 1) return exact[0];
  const rooted = paths.filter((path) => normalizePath(path) === normalizePath(request));
  if (rooted.length === 1) return rooted[0];
  const basename = normalizePath(request).split("/").pop();
  const matches = paths.filter((path) => normalizePath(path).split("/").pop() === basename);
  if (matches.length === 1) return matches[0];
  throw new Error(matches.length > 1
    ? `동일한 이름의 리소스가 여러 개 있습니다: ${request}. 모델의 상대 경로를 유지해 주세요.`
    : `리소스를 찾지 못했습니다: ${request}. 모델과 텍스처·버퍼·재질 파일을 같은 ZIP에 넣어 주세요.`);
}

export function disposeModel(scene: THREE.Object3D) {
  const disposed = new Set<unknown>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry && !disposed.has(mesh.geometry)) { mesh.geometry.dispose(); disposed.add(mesh.geometry); }
    for (const material of mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : []) {
      if (disposed.has(material)) continue;
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture && !disposed.has(value)) {
          const image = value.image;
          if (typeof image?.src === "string" && image.src.startsWith("blob:")) URL.revokeObjectURL(image.src);
          if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) image.close();
          value.dispose(); disposed.add(value);
        }
      }
      material.dispose(); disposed.add(material);
    }
  });
}

function validateScene(scene: THREE.Object3D) {
  let vertices = 0;
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute("position");
    vertices += position?.count || 0;
    if (position) for (let i = 0; i < position.count; i++) {
      if (![position.getX(i), position.getY(i), position.getZ(i)].every(Number.isFinite)) {
        throw new Error("모델에 유효하지 않은 정점 좌표가 있습니다.");
      }
    }
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(material)) {
        if (!(value instanceof THREE.Texture)) continue;
        const image = value.image;
        if (!image || !(image.width > 0 && image.height > 0)) {
          throw new Error(`텍스처를 읽지 못했습니다: ${value.name || material.name || "이름 없음"}. 누락된 텍스처 없이 다시 시도해 주세요.`);
        }
      }
    }
  });
  if (!vertices) throw new Error("변환할 메시가 없습니다. NURBS 곡면은 테셀레이션된 메시로 저장되어 있어야 합니다.");
}

async function parseModel(name: string, data: ArrayBuffer, manager: THREE.LoadingManager, base: string, options: ModelLoadOptions, mtl?: { text: string; base: string }) {
  const ext = fileExtension(name);
  if (ext === "stp" || ext === "step") {
    const { loadStep } = await import("./step-loader");
    return loadStep(data, options.tessellation);
  }
  if (ext === "gltf" || ext === "glb") {
    const gltf = await new GLTFLoader(manager).parseAsync(data, base);
    gltf.scene.animations = gltf.animations;
    return gltf.scene;
  }
  if (ext === "fbx") {
    validateFbxGeometry(data);
    const fbx = new FBXLoader(manager).parse(data, base);
    // FBX's UnitScaleFactor is centimetres per file unit. The loader exposes
    // it but does not scale vertices. Normalize to metres used by glTF/USD.
    // FBXLoader may return its only child group, leaving the global settings on
    // that group's original parent.
    const units = Number(fbx.userData.unitScaleFactor ?? fbx.parent?.userData.unitScaleFactor ?? 1) / 100;
    const root = new THREE.Group();
    root.add(fbx); root.scale.setScalar(units); root.animations = fbx.animations;
    return root;
  }
  if (ext === "obj") {
    const loader = new OBJLoader(manager);
    if (mtl) {
      const materials = new MTLLoader(manager).parse(mtl.text, mtl.base);
      materials.preload(); loader.setMaterials(materials);
    }
    return loader.parse(new TextDecoder().decode(data));
  }
  if (ext === "stl") {
    const geometry = new STLLoader(manager).parse(data) as THREE.BufferGeometry & { alpha?: number };
    const opacity = geometry.alpha ?? 1;
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1,
      vertexColors: geometry.hasAttribute("color"), opacity, transparent: opacity < 1 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name.replace(/\.[^.]+$/, "");
    return mesh;
  }
  if (ext === "skp") {
    const { buildInstancedScene, toInstancedGLB } = await import("openskp");
    try {
      const parsed = buildInstancedScene(data);
      const glb = toInstancedGLB(parsed, { textures: true });
      const loaded = await new GLTFLoader(manager).parseAsync(new Uint8Array(glb).buffer, "");
      return loaded.scene;
    } catch (error) {
      throw new Error(`SKP를 읽지 못했습니다. 일부 버전·요소는 지원되지 않습니다. ${error instanceof Error ? error.message : ""}`);
    }
  }
  if (["usd", "usda", "usdc", "usdz"].includes(ext)) {
    const { validateUsd } = await import("./usd-validation");
    await validateUsd(data, name);
    return new Promise<THREE.Group>((resolve, reject) => {
      new USDLoader(manager).parse(data, base, resolve, reject);
    });
  }
  throw new Error(`지원되지 않는 3D 형식: .${ext}`);
}

export async function loadModel(file: File, options: ModelLoadOptions = {}) {
  const resources = new Map<string, ArrayBuffer>();
  let primary = file.name;
  let data = await file.arrayBuffer();
  if (fileExtension(file.name) === "zip") {
    const zip = await JSZip.loadAsync(data);
    const entries = Object.values(zip.files).filter((entry) => !entry.dir && !entry.name.startsWith("__MACOSX/"));
    const models = entries.filter((entry) => acceptedModels.includes(fileExtension(entry.name)) && fileExtension(entry.name) !== "zip");
    // USD packages can contain many referenced geometry layers. A root layer at
    // the shallowest folder level is deterministic; other multi-model ZIPs fail.
    const depth = Math.min(...models.map((entry) => entry.name.split("/").length));
    const roots = models.filter((entry) => entry.name.split("/").length === depth);
    if (roots.length !== 1) throw new Error(roots.length ? "ZIP의 최상위 폴더에는 변환할 모델 하나만 넣어 주세요." : "ZIP에서 지원되는 3D 모델을 찾지 못했습니다.");
    primary = roots[0].name;
    for (const entry of entries) resources.set(entry.name, await entry.async("arraybuffer"));
    data = resources.get(primary)!;
  }
  const ext = fileExtension(primary);
  const base = primary.includes("/") ? primary.slice(0, primary.lastIndexOf("/") + 1) : "";
  const urls = new Map<string, string>();
  const manager = new THREE.LoadingManager();
  manager.addHandler(/\.tga$/i, new TGALoader(manager));
  manager.setURLModifier((requested) => {
    if (/^(blob:|data:)/i.test(requested)) return requested;
    // A file must never cause network requests to URLs embedded in its content.
    const path = resourcePath(requested, resources.keys());
    let url = urls.get(path);
    if (!url) {
      url = URL.createObjectURL(new Blob([resources.get(path)!]));
      urls.set(path, url);
    }
    return url;
  });
  const failures: string[] = [];
  manager.onError = (url) => failures.push(url);
  const ready = new Promise<void>((resolve) => { manager.onLoad = resolve; });
  manager.itemStart("condrop:parse");
  let scene: THREE.Object3D | undefined;
  const cleanup = () => { urls.forEach((url) => URL.revokeObjectURL(url)); if (scene) disposeModel(scene); };
  try {
    let mtl: { text: string; base: string } | undefined;
    if (ext === "obj") {
      const names = [...new TextDecoder().decode(data).matchAll(/^\s*mtllib\s+(.+)$/gm)].map((match) => match[1].trim());
      if (names.length > 1) throw new Error("OBJ의 여러 MTL 라이브러리는 하나의 MTL로 합쳐 주세요.");
      if (names.length) {
        const path = resourcePath(names[0], resources.keys(), base);
        mtl = { text: new TextDecoder().decode(resources.get(path)), base: path.slice(0, path.lastIndexOf("/") + 1) };
      }
    }
    if (["usd", "usda", "usdc"].includes(ext) && resources.size) {
      // USDLoader resolves layer references through its archive asset table.
      // Passing only the root bytes silently loses referenced geometry.
      const zip = new JSZip();
      zip.file(primary, data, { createFolders: false });
      for (const [name, bytes] of resources) if (name !== primary) zip.file(name, bytes, { createFolders: false });
      data = await zip.generateAsync({ type: "arraybuffer", compression: "STORE" });
    }
    scene = await parseModel(primary, data, manager, base, options, mtl);
    const archive = [...resources.keys()].find((path) => path === "condrop-materials.json");
    if (ext === "fbx" && archive) {
      const { restoreMaterialArchive } = await import("./model-export");
      await restoreMaterialArchive(scene, new TextDecoder().decode(resources.get(archive)), manager);
    }
    manager.itemEnd("condrop:parse");
    await ready;
    if (failures.length) throw new Error(`텍스처·버퍼 ${failures.length}개를 읽지 못했습니다. ZIP의 리소스를 확인해 주세요.`);
    validateScene(scene);
    const warnings: string[] = [];
    if (ext === "stp" || ext === "step") warnings.push(`STEP: 테셀레이션 ${stepQuality[options.tessellation || "high"].label}. 형상·법선·부품/면 색상을 변환했습니다. 텍스처·전용 셰이더·투명도는 지원하지 않으며, 출력은 곡면 편집 정보가 없는 메시입니다.`);
    if (ext === "skp") warnings.push("SKP: 저장된 면과 PNG/JPEG 텍스처를 변환했습니다. 일부 전용 요소는 지원되지 않습니다.");
    if (ext === "stl") warnings.push("STL: 원본 삼각형과 법선을 유지했습니다. UV·텍스처 정보는 STL에 없습니다.");
    return { scene, cleanup, warnings };
  } catch (error) { cleanup(); throw error; }
}
