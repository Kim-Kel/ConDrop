/// <reference types="vite/client" />
import * as THREE from "three";
import runtimeAsset from "occt-import-js/dist/occt-import-js.js?url";
import wasmAsset from "occt-import-js/dist/occt-import-js.wasm?url";
import { stepQuality, type TessellationQuality } from "./step-options";

type Color = [number, number, number];
interface StepMesh {
  name: string;
  color?: Color;
  brep_faces: Array<{ first: number; last: number; color?: Color | null }>;
  attributes: { position: { array: Float32Array }; normal?: { array: Float32Array } };
  index: { array: Uint32Array };
}
interface StepNode { name: string; meshes: number[]; children: StepNode[] }
interface StepResult { root: StepNode; meshes: StepMesh[] }

async function tessellate(content: ArrayBuffer, quality: TessellationQuality): Promise<StepResult> {
  const preset = stepQuality[quality];
  if (!preset) throw new Error("지원하지 않는 STEP 테셀레이션 품질입니다.");
  const worker = new Worker(new URL("./step-worker.js", import.meta.url));
  try {
    return await new Promise<StepResult>((resolve, reject) => {
      worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.result);
      worker.onerror = (event) => { event.preventDefault(); reject(new Error("STEP 변환 엔진을 실행하지 못했습니다. 페이지를 새로고침하거나 더 작은 파일·낮은 품질로 다시 시도해 주세요.")); };
      worker.onmessageerror = () => reject(new Error("STEP 변환 결과를 읽지 못했습니다."));
      worker.postMessage({ content,
        runtimeUrl: new URL(runtimeAsset, window.location.href).href,
        wasmUrl: new URL(wasmAsset, window.location.href).href,
        params: { linearUnit: "meter", linearDeflectionType: "bounding_box_ratio",
          linearDeflection: preset.linearDeflection, angularDeflection: preset.angularDeflection },
      }, [content]);
    });
  } finally { worker.terminate(); }
}

export async function loadStep(content: ArrayBuffer, quality: TessellationQuality = "high") {
  const result = await tessellate(content, quality);
  const geometries: THREE.BufferGeometry[] = [];
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const materialFor = (rgb: Color = [0.65, 0.65, 0.65]) => {
    const key = rgb.join(",");
    let material = materials.get(key);
    if (!material) {
      // OCCT Quantity_Color::Red/Green/Blue are linear RGB, as are Three's
      // working-space color components. Do not apply another sRGB conversion.
      material = new THREE.MeshStandardMaterial({ color: new THREE.Color(...rgb), roughness: 0.6, metalness: 0 });
      material.name = `STEP_Color_${materials.size + 1}`;
      materials.set(key, material);
    }
    return material;
  };
  try {
    const meshes = result.meshes.map((source) => {
      const geometry = new THREE.BufferGeometry(); geometries.push(geometry);
      geometry.setAttribute("position", new THREE.BufferAttribute(source.attributes.position.array, 3));
      geometry.setIndex(new THREE.BufferAttribute(source.index.array, 1));
      if (source.attributes.normal) geometry.setAttribute("normal", new THREE.BufferAttribute(source.attributes.normal.array, 3));
      else geometry.computeVertexNormals();
      const palette = [materialFor(source.color)];
      const triangles = source.index.array.length / 3;
      let cursor = 0;
      for (const face of [...source.brep_faces].sort((a, b) => a.first - b.first)) {
        if (face.last < face.first) continue; // Empty CAD face.
        if (face.first < cursor || face.last >= triangles) throw new Error("STEP 면의 삼각형 범위가 유효하지 않습니다.");
        if (face.first > cursor) geometry.addGroup(cursor * 3, (face.first - cursor) * 3, 0);
        const material = materialFor(face.color || source.color);
        let index = palette.indexOf(material);
        if (index < 0) { index = palette.length; palette.push(material); }
        geometry.addGroup(face.first * 3, (face.last - face.first + 1) * 3, index);
        cursor = face.last + 1;
      }
      if (cursor < triangles) geometry.addGroup(cursor * 3, (triangles - cursor) * 3, 0);
      const mesh = new THREE.Mesh(geometry, palette);
      mesh.name = source.name;
      return mesh;
    });
    // OCCT already bakes each occurrence's placement into its coordinates.
    // Keep the assembly tree without applying those transforms a second time.
    const buildNode = (node: StepNode): THREE.Group => {
      const group = new THREE.Group(); group.name = node.name;
      for (const index of node.meshes) {
        if (!meshes[index]) throw new Error("STEP 조립 구조가 유효하지 않습니다.");
        group.add(meshes[index].clone());
      }
      for (const child of node.children) group.add(buildNode(child));
      return group;
    };
    const scene = buildNode(result.root);
    scene.userData.stepTessellation = quality;
    return scene;
  } catch (error) {
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    throw error;
  }
}
