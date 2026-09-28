import * as THREE from "three";
import JSZip from "jszip";
import { create } from "openskp";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { exportFbx, exportUsd } from "../../app/model-export";
import { loadModel, resourcePath } from "../../app/model-loader";
import { routeFiles } from "../../app/file-routing";

function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const file = async (blob: Blob, name: string) => new File([blob], name);
function stats(scene: THREE.Object3D) {
  let triangles = 0; const materials: THREE.Material[] = [];
  scene.traverse((obj) => { const mesh = obj as THREE.Mesh; if (mesh.isMesh) {
    triangles += (mesh.geometry.index?.count || mesh.geometry.getAttribute("position").count) / 3;
    materials.push(...(Array.isArray(mesh.material) ? mesh.material : [mesh.material]));
  } });
  return { triangles, materials, size: new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3()).toArray() };
}
async function texture(width = 2048, flipY = false) {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = 2;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ff0000"; context.fillRect(0, 0, width, 1);
  context.fillStyle = "#0000ff"; context.fillRect(0, 1, width, 1);
  const tex = new THREE.CanvasTexture(canvas); tex.flipY = flipY; tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
async function texturedScene() {
  const scene = new THREE.Group(); scene.name = "Source";
  const map = await texture();
  const orm = await texture(); orm.colorSpace = THREE.NoColorSpace;
  const material = new THREE.MeshStandardMaterial({ name: "PBR", map, roughnessMap: orm, metalnessMap: orm,
    roughness: 0.37, metalness: 0.64, normalMap: orm, aoMap: orm, side: THREE.DoubleSide });
  material.color.setRGB(0.31, 0.2, 0.45);
  const geometry = new THREE.BoxGeometry(2, 4, 6);
  const mesh = new THREE.Mesh(geometry, [material, new THREE.MeshStandardMaterial({ color: 0x22ff11 })]);
  geometry.groups.forEach((group, i) => { group.materialIndex = i % 2; });
  mesh.name = "Box"; mesh.position.set(1, 2, 3); scene.add(mesh);
  scene.animations = [new THREE.AnimationClip("Move", 1, [new THREE.VectorKeyframeTrack("Box.position", [0, 1], [1, 2, 3, 4, 5, 6])])];
  return scene;
}

export async function runFbxRoundTrip() {
  const source = await texturedScene();
  const before = stats(source);
  const output = await exportFbx(source, "テスト");
  const zip = await JSZip.loadAsync(await output.arrayBuffer());
  const fbx = Object.keys(zip.files).find((name) => name.endsWith(".fbx"))!;
  const bytes = await zip.file(fbx)!.async("uint8array");
  check(new TextDecoder().decode(bytes.slice(0, 20)).startsWith("Kaydara FBX Binary"), "real binary FBX");
  const manifest = JSON.parse(await zip.file("condrop-materials.json")!.async("string"));
  check(manifest.materials.some((m: { roughnessMap?: string }) => m.roughnessMap), "PBR map archived");
  const loaded = await loadModel(await file(output, "roundtrip.zip"));
  try {
    const after = stats(loaded.scene);
    check(after.triangles === before.triangles, `triangles ${after.triangles}`);
    check(after.size.every((n, i) => Math.abs(n - before.size[i]) < 1e-5), `metres ${after.size}`);
    const material = after.materials.find((m) => (m as THREE.MeshStandardMaterial).roughnessMap) as THREE.MeshStandardMaterial;
    check(material?.map?.image.width === 2048, "texture not downsized");
    check(material.roughness === 0.37 && material.metalness === 0.64, "PBR factors preserved");
    check(Math.abs(material.color.r - 0.31) < 1e-6, "FBX archive linear color precision");
    check(material.map.flipY === false, "UV orientation preserved");
    const sourceMesh = source.children[0] as THREE.Mesh;
    let restoredMesh: THREE.Mesh | undefined;
    loaded.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) restoredMesh = o as THREE.Mesh; });
    const sourceUv = sourceMesh.geometry.getAttribute("uv");
    const index = sourceMesh.geometry.index!;
    const restoredUv = restoredMesh!.geometry.getAttribute("uv");
    check(Math.abs(restoredUv.getY(0) - sourceUv.getY(index.getX(0))) < 1e-6, "archived FBX UVs not mirrored");
    check(loaded.scene.animations.length > 0, "animation preserved");
    return { triangles: after.triangles, size: after.size, textureWidth: material.map.image.width, animations: loaded.scene.animations.length };
  } finally { loaded.cleanup(); }
}

export async function runUsdRoundTrip() {
  const source = await texturedScene();
  const output = await exportUsd(source, "roundtrip");
  const zip = await JSZip.loadAsync(await output.arrayBuffer());
  const usd = await zip.file("roundtrip.usd")!.async("string");
  check(usd.startsWith("#usda 1.0"), "USD text encoding");
  check(usd.includes("inputs:roughness.connect") && usd.includes("inputs:metallic.connect"), "PBR shader channels");
  const loaded = await loadModel(await file(output, "roundtrip.zip"));
  try {
    const after = stats(loaded.scene);
    check(after.triangles === 12, `triangles ${after.triangles}`);
    check(after.size.every((n, i) => Math.abs(n - [2, 4, 6][i]) < 1e-5), `size ${after.size}`);
    const materials = after.materials as THREE.MeshStandardMaterial[];
    check(materials.some((m) => m.roughnessMap && m.metalnessMap && m.normalMap), "PBR loaded");
    const pbr = materials.find((m) => m.roughnessMap)!;
    check(Math.abs(pbr.roughness - 0.37) < 1e-6 && Math.abs(pbr.metalness - 0.64) < 1e-6, `PBR factors ${pbr.roughness}, ${pbr.metalness}`);
    check(Math.abs(pbr.color.r - 0.31) < 1e-6, `linear color ${pbr.color.r}`);
    check(Math.abs(pbr.normalScale.x - 1) < 1e-6, `normal strength ${pbr.normalScale.x}`);
    check(materials.some((m) => m.map?.image.width === 2048), "source resolution");
    return { triangles: after.triangles, materials: materials.length, layers: Object.keys(zip.files).filter((n) => /\.usda$/.test(n)).length };
  } finally { loaded.cleanup(); }
}

export async function runSkp() {
  const builder = create();
  const tex = await texture(16);
  const blob = await new Promise<Blob>((resolve) => tex.image.toBlob(resolve, "image/png"));
  const material = builder.addTextureMaterial("Checker", new Uint8Array(await blob.arrayBuffer()), "checker.png");
  const def = builder.addComponentDefinition("Panel", (panel) => {
    panel.addFace([[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]], { material });
  });
  builder.addInstance(def, { translation: [0, 0, 0] });
  builder.addInstance(def, { translation: [20, 0, 0] });
  const loaded = await loadModel(new File([new Uint8Array(builder.toBytes())], "textured.skp"));
  try {
    const info = stats(loaded.scene);
    check(info.triangles >= 4, `SKP faces ${info.triangles}`);
    check(info.materials.some((m) => (m as THREE.MeshStandardMaterial).map?.image.width === 16), "SKP embedded texture");
    check(Math.abs(info.size[0] - 0.762) < 1e-5, `SKP inches to metres ${info.size}`);
    return { triangles: info.triangles, size: info.size };
  } finally { loaded.cleanup(); }
}

export const stlText = "solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid triangle";
export async function runStl() {
  const ascii = await loadModel(new File([stlText], "triangle.stl"));
  check(stats(ascii.scene).triangles === 1, "ASCII STL"); ascii.cleanup();
  const bytes = new ArrayBuffer(134); const view = new DataView(bytes);
  view.setUint32(80, 1, true); view.setFloat32(92, 1, true); view.setFloat32(108, 1, true); view.setFloat32(124, 1, true);
  const binary = await loadModel(new File([bytes], "binary.stl"));
  check(stats(binary.scene).triangles === 1, "binary STL"); binary.cleanup();
  return true;
}

export async function runFailures() {
  const expectError = async (file: File, pattern: RegExp) => {
    try { const result = await loadModel(file); result.cleanup(); } catch (e) { check(pattern.test(String(e)), String(e)); return; }
    throw new Error(`Expected failure: ${file.name}`);
  };
  await expectError(new File(["mtllib missing.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3"], "missing.obj"), /리소스/);
  await expectError(new File(["invalid"], "bad.skp"), /SKP/);
  await expectError(new File(['Geometry: 1, "Geometry::Surface", "NurbsSurface" {\n}'], "nurbs.fbx"), /NurbsSurface/);
  await expectError(new File(["#usda 1.0\ndef Xform \"Root\" (\n prepend references = @missing.usda@\n)\n{\n}\n"], "missing.usd"), /리소스/);
  await expectError(new File(["#usda 1.0\ndef NurbsPatch \"Surface\"\n{\n}\n"], "nurbs.usda"), /NurbsPatch/);
  try { resourcePath("x.png", ["one/x.png", "two/x.png"]); throw new Error("ambiguous accepted"); } catch(e) { check(String(e).includes("여러"), String(e)); }
  return true;
}

export async function runObjTextures() {
  const tex = await texture(8);
  const blob = await new Promise<Blob>((resolve) => tex.image.toBlob(resolve, "image/png"));
  const zip = new JSZip();
  zip.file("model/mesh.obj", "mtllib materials/mat.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nusemtl Paint\nf 1/1 2/2 3/3");
  zip.file("model/materials/mat.mtl", "newmtl Paint\nKd 1 1 1\nmap_Kd ../textures/tex%25.png");
  zip.file("model/textures/tex%.png", await blob.arrayBuffer());
  const loaded = await loadModel(new File([await zip.generateAsync({ type: "arraybuffer" })], "obj.zip"));
  try { check((stats(loaded.scene).materials[0] as THREE.MeshPhongMaterial).map?.image.width === 8, "wait for texture"); return true; }
  finally { loaded.cleanup(); }
}

export async function runGlbAnimation() {
  const source = await texturedScene();
  const bytes = await new GLTFExporter().parseAsync(source, { binary: true, animations: source.animations });
  const loaded = await loadModel(new File([bytes as ArrayBuffer], "animated.glb"));
  try { check(loaded.scene.animations.length === 1, "glTF animation clips retained"); return true; }
  finally { loaded.cleanup(); }
}

export async function inspectFile(bytes: number[], name: string) {
  const loaded = await loadModel(new File([new Uint8Array(bytes)], name));
  try {
    const result = stats(loaded.scene);
    return { triangles: result.triangles, size: result.size,
      textures: result.materials.filter((m) => (m as THREE.MeshStandardMaterial).map).length };
  } finally { loaded.cleanup(); }
}

export async function usdForIndependentCheck() {
  return Array.from(new Uint8Array(await (await exportUsd(await texturedScene(), "validation")).arrayBuffer()));
}

export function runRouting() {
  const result = routeFiles([{ name: "A.FBX" }, { name: "a.png" }, { name: "b.skp" }, { name: "bad.txt" }], "image");
  check(result.mode === "3d" && result.models.length === 2 && result.images.length === 1 && result.rejected.length === 1, "mixed routing");
  check(routeFiles([{ name: "a.PNG" }], "3d").mode === "image", "reverse routing");
  return true;
}
