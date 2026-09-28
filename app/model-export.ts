import JSZip from "jszip";
import * as THREE from "three";
import { USDZExporter } from "three/examples/jsm/exporters/USDZExporter.js";
import { FBXExporter } from "@comfyorg/fbx-exporter-three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

const safeStem = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_") || "model";

function materialsOf(scene: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => materials.add(material));
  });
  return [...materials];
}

export async function exportFbx(scene: THREE.Object3D, stem: string) {
  const zip = new JSZip();
  const textures: Record<string, unknown> = {};
  const images = new Map<string, string>();
  // three's JSON material representation retains PBR factors, every texture
  // slot, UV transforms, sampler settings, colors and vertex-color flags.
  const materialRecords = [];
  const originalNames = new Map<THREE.Material, string>();
  try {
    for (const [index, material] of materialsOf(scene).entries()) {
      originalNames.set(material, material.name);
      material.name = `Material_${index + 1}_${safeStem(material.name)}`;
      const record = material.toJSON({ textures: {}, images: {}, geometries: {}, materials: {}, shapes: {}, skeletons: {}, animations: {}, nodes: {} });
      materialRecords.push({ ...record, condropLinearColors: Object.fromEntries(Object.entries(material)
        .filter(([, value]) => value instanceof THREE.Color).map(([key, value]) => [key, (value as THREE.Color).toArray()])) });
      for (const texture of Object.values(material)) {
        if (!(texture instanceof THREE.Texture) || textures[texture.uuid]) continue;
        if (texture.isRenderTargetTexture || texture instanceof THREE.CubeTexture) {
          throw new Error("렌더 타깃·환경 큐브맵은 FBX 재질 아카이브로 내보낼 수 없습니다.");
        }
        let filename = images.get(texture.source.uuid);
        if (!filename) {
          filename = `textures/texture_${images.size + 1}.png`;
          const image = texture.image;
          const canvas = document.createElement("canvas");
          canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext("2d")!;
          if (image.data) {
            if (!(image.data instanceof Uint8Array) && !(image.data instanceof Uint8ClampedArray)) {
              throw new Error("HDR/고비트 심도 텍스처를 8비트로 낮추지 않고 FBX로 내보내는 기능은 지원되지 않습니다.");
            }
            const channels = image.data.length / (image.width * image.height);
            const pixels = context.createImageData(image.width, image.height);
            for (let i = 0; i < image.width * image.height; i++) {
              pixels.data[i * 4] = image.data[i * channels];
              pixels.data[i * 4 + 1] = image.data[i * channels + (channels >= 3 ? 1 : 0)];
              pixels.data[i * 4 + 2] = image.data[i * channels + (channels >= 3 ? 2 : 0)];
              pixels.data[i * 4 + 3] = channels === 2 || channels === 4 ? image.data[i * channels + channels - 1] : 255;
            }
            context.putImageData(pixels, 0, 0);
          } else context.drawImage(image, 0, 0);
          const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG 텍스처를 인코딩하지 못했습니다.")), "image/png"));
          zip.file(filename, await blob.arrayBuffer());
          images.set(texture.source.uuid, filename);
        }
        // Pass a meta object to avoid serializing the source pixels as base64.
        const record = texture.toJSON({ textures: {}, images: {} });
        textures[texture.uuid] = { ...record, sourceFile: filename };
      }
    }
    const exporter = new FBXExporter();
    // The upstream encoder logs failures and continues. Fail explicitly instead
    // of offering a supposedly successful download with missing textures.
    exporter.register((plan) => {
      for (const entry of plan.textures.textures.values()) {
        if (!entry.imageBytes?.length) throw new Error(`FBX 텍스처를 포함하지 못했습니다: ${entry.fileName}`);
      }
    });
    const bytes = await exporter.parseAsync(scene, { embedTextures: true, onlyVisible: false,
      animations: scene.animations, customProperties: true, unitScale: 100 });
    zip.file(`${safeStem(stem)}.fbx`, bytes);
    zip.file("condrop-materials.json", JSON.stringify({ schema: "condrop-materials-v1", materials: materialRecords, textures }, null, 2));
    zip.file("README.txt", "FBX contains geometry, hierarchy, supported animation and embedded Phong-compatible textures.\ncondrop-materials.json and textures/ retain the original loaded PBR materials at source resolution. Re-import the complete ZIP in ConDrop to restore them. Other applications may require manual PBR texture assignment.\nProcedural / renderer-specific shaders cannot be reconstructed.\n");
    return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  } finally { originalNames.forEach((name, material) => { material.name = name; }); }
}

export async function restoreMaterialArchive(scene: THREE.Object3D, json: string, manager: THREE.LoadingManager) {
  const archive = JSON.parse(json);
  if (archive.schema !== "condrop-materials-v1" || !Array.isArray(archive.materials)) throw new Error("ConDrop 재질 아카이브 형식이 올바르지 않습니다.");
  const textures: Record<string, THREE.Texture> = {};
  for (const [uuid, value] of Object.entries(archive.textures)) {
    const record = value as THREE.TextureJSON & { sourceFile: string };
    const texture = await new THREE.TextureLoader(manager).loadAsync(record.sourceFile);
    texture.name = record.name || "";
    texture.flipY = record.flipY;
    texture.colorSpace = record.colorSpace;
    texture.offset.fromArray(record.offset); texture.repeat.fromArray(record.repeat); texture.center.fromArray(record.center);
    texture.rotation = record.rotation;
    texture.channel = record.channel;
    texture.wrapS = record.wrap[0] as THREE.Wrapping; texture.wrapT = record.wrap[1] as THREE.Wrapping;
    texture.magFilter = record.magFilter; texture.minFilter = record.minFilter;
    texture.anisotropy = record.anisotropy; texture.mapping = record.mapping;
    texture.generateMipmaps = record.generateMipmaps; texture.premultiplyAlpha = record.premultiplyAlpha;
    texture.unpackAlignment = record.unpackAlignment;
    textures[uuid] = texture;
  }
  const loader = new THREE.MaterialLoader().setTextures(textures);
  const materials = new Map<string, THREE.Material>(archive.materials.map((record: THREE.MaterialJSON & { condropLinearColors?: Record<string, number[]> }) => {
    const material = loader.parse(record);
    for (const [key, rgb] of Object.entries(record.condropLinearColors || {})) {
      const color = (material as unknown as Record<string, unknown>)[key];
      if (color instanceof THREE.Color) color.fromArray(rgb);
    }
    return [material.name, material];
  }));
  const flipped = new Set<THREE.BufferGeometry>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.material) return;
    const restore = (material: THREE.Material) => materials.get(material.name) || material;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(restore) : restore(mesh.material);
    // The FBX writer flips V for glTF-style textures. Undo that before restoring
    // the archived texture's original flipY and UV transform settings.
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const slots = ["map", "emissiveMap", "normalMap", "bumpMap", "alphaMap", "specularMap", "aoMap", "displacementMap", "envMap"];
    let originalTexture: THREE.Texture | undefined;
    for (const material of list) {
      for (const slot of slots) {
        const texture = (material as unknown as Record<string, unknown>)[slot];
        if (texture instanceof THREE.Texture) { originalTexture = texture; break; }
      }
      if (originalTexture) break;
    }
    if (originalTexture?.flipY === false && !flipped.has(mesh.geometry)) {
      for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
        if (/^uv[0-3]?$/.test(name)) for (let i = 0; i < attribute.count; i++) attribute.setY(i, 1 - attribute.getY(i));
      }
      flipped.add(mesh.geometry);
    }
  });
}

export async function exportUsd(scene: THREE.Object3D, stem: string) {
  // Clone the skeleton as well: baking the current pose must not alter input.
  const output = new THREE.Group();
  output.add(clone(scene));
  const temporaryMaterials = new Set<THREE.Material>();
  const temporaryGeometry = new Set<THREE.BufferGeometry>();
  output.updateMatrixWorld(true);
  try {
  output.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh || mesh.morphTargetInfluences?.some((weight) => weight !== 0)) {
      (mesh as THREE.SkinnedMesh).skeleton?.update();
      const geometry = mesh.geometry.clone();
      const source = geometry.getAttribute("position");
      const position = new Float32Array(source.count * 3);
      const vertex = new THREE.Vector3();
      for (let i = 0; i < source.count; i++) { mesh.getVertexPosition(i, vertex); vertex.toArray(position, i * 3); }
      geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
      geometry.computeVertexNormals();
      mesh.geometry = geometry; temporaryGeometry.add(geometry);
    }
    const convert = (material: THREE.Material) => {
      const source = material as THREE.MeshPhongMaterial & THREE.MeshStandardMaterial;
      const target = source.isMeshStandardMaterial ? source.clone() : new THREE.MeshStandardMaterial();
      if (!source.isMeshStandardMaterial) {
        for (const key of ["name", "color", "map", "normalMap", "normalScale", "bumpMap", "bumpScale", "emissive", "emissiveMap", "emissiveIntensity", "aoMap", "aoMapIntensity", "alphaMap", "alphaTest", "opacity", "transparent", "side", "vertexColors"] as const) {
          if (key in source) Object.assign(target, { [key]: source[key] });
        }
        target.roughness = source.isMeshPhongMaterial ? Math.sqrt(2 / (Math.max(0, source.shininess) + 2)) : 1;
        target.metalness = 0;
      }
      // Never allow the exporter to re-encode JPEG using canvas's lossy default.
      for (const [key, value] of Object.entries(target)) {
        if (!(value instanceof THREE.Texture)) continue;
        const texture = value.clone();
        const image = value.image;
        if (image?.data) {
          if (!(image.data instanceof Uint8Array) && !(image.data instanceof Uint8ClampedArray)) throw new Error("USD 출력의 HDR/고비트 심도 텍스처 변환은 지원되지 않습니다.");
          const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext("2d")!;
          const pixels = context.createImageData(image.width, image.height);
          const channels = image.data.length / (image.width * image.height);
          for (let i = 0; i < image.width * image.height; i++) {
            pixels.data[i * 4] = image.data[i * channels];
            pixels.data[i * 4 + 1] = image.data[i * channels + (channels >= 3 ? 1 : 0)];
            pixels.data[i * 4 + 2] = image.data[i * channels + (channels >= 3 ? 2 : 0)];
            pixels.data[i * 4 + 3] = channels === 2 || channels === 4 ? image.data[i * channels + channels - 1] : 255;
          }
          context.putImageData(pixels, 0, 0); texture.source = new THREE.Source(canvas);
        }
        texture.userData = { ...texture.userData, mimeType: "image/png" };
        Object.assign(target, { [key]: texture });
      }
      temporaryMaterials.add(target);
      return target;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
  });
  // USD's doubleSided is a mesh property, not a material property. Separate
  // material groups so every face keeps the appropriate culling behavior.
  const meshes: THREE.Mesh[] = [];
  output.traverse((object) => { if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh); });
  const doubleSided = new Set<number>();
  for (const mesh of meshes) {
    const parts: THREE.Mesh[] = [];
    if (Array.isArray(mesh.material)) {
      const holder = new THREE.Group();
      holder.name = mesh.name; holder.position.copy(mesh.position); holder.quaternion.copy(mesh.quaternion); holder.scale.copy(mesh.scale);
      for (const group of mesh.geometry.groups) {
        const material = mesh.material[group.materialIndex || 0];
        if (!material) continue;
        const geometry = mesh.geometry.clone();
        const index = mesh.geometry.index;
        const end = Math.min(group.start + group.count, index?.count || geometry.getAttribute("position").count);
        const indices = [];
        for (let i = group.start; i < end; i++) indices.push(index ? index.getX(i) : i);
        geometry.setIndex(indices); geometry.clearGroups();
        temporaryGeometry.add(geometry);
        const part = new THREE.Mesh(geometry, material); holder.add(part); parts.push(part);
      }
      while (mesh.children.length) holder.add(mesh.children[0]);
      mesh.parent?.add(holder); mesh.removeFromParent();
    } else {
      mesh.geometry = mesh.geometry.clone(); temporaryGeometry.add(mesh.geometry); parts.push(mesh);
    }
    for (const part of parts) {
      if (!part.geometry.hasAttribute("normal")) part.geometry.computeVertexNormals();
      const material = part.material as THREE.Material;
      if (material.side === THREE.DoubleSide) doubleSided.add(part.geometry.id);
    }
  }
  // The upstream USDZ exporter warns about double-sided materials, although
  // generic USD supports them. Author the mesh attribute in the USD layers below.
  temporaryMaterials.forEach((material) => { material.side = THREE.FrontSide; });
    const bytes = await new USDZExporter().parseAsync(output, { onlyVisible: false,
      maxTextureSize: Infinity, includeAnchoringProperties: false });
    const zip = await JSZip.loadAsync(bytes);
    for (const id of doubleSided) {
      const path = `geometries/Geometry_${id}.usda`;
      const layer = zip.file(path);
      if (!layer) throw new Error("USD 양면 재질 레이어를 찾지 못했습니다.");
      zip.file(path, (await layer.async("string")).replace(/(def Mesh "Geometry"\s*\{)/, "$1\n\t\tbool doubleSided = true"));
    }
    const root = await zip.file("model.usda")!.async("uint8array");
    zip.remove("model.usda");
    // .usd can contain USDA text; all geometry layers retain their relative paths.
    zip.file(`${safeStem(stem)}.usd`, root);
    zip.file("README.txt", "Open the .usd file with geometries/ and textures/ beside it.\nUSD uses USDA encoding, static mesh geometry and UsdPreviewSurface PBR materials. Textures use lossless PNG at their loaded resolution.\nSkin/morph deformation is baked at the current pose. Animation, editable rigs, NURBS and renderer-specific shader graphs are not retained. Phong materials are approximated as PBR.\n");
    return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  } finally {
    temporaryGeometry.forEach((geometry) => geometry.dispose());
    temporaryMaterials.forEach((material) => { for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose(); material.dispose(); });
  }
}
