import * as THREE from "three";
import { USDComposer } from "three/examples/jsm/loaders/usd/USDComposer.js";

// Compatibility adapter for pinned three 0.185.1. Keep corrections at the
// PreviewSurface boundary (also used by reference-layer composers), not by
// guessing the shader type from final materials. Remove when upstream fixes land.
// USD color constants and UVTexture scale are linear, and normal textures are
// remapped from [0,1] to [-1,1] with scale=2 and bias=-1. The standard material
// already performs that normal remapping, so its strength is scale / 2.
const applyPreviewSurface = USDComposer.prototype._applyPreviewSurface;
USDComposer.prototype._applyPreviewSurface = function (material, shaderPath) {
  applyPreviewSurface.call(this, material, shaderPath);
  const fields = this._getAttributes(shaderPath);
  const colorValue = (color: THREE.Color, value: unknown) => {
    if (Array.isArray(value) && value.length >= 3) color.setRGB(value[0], value[1], value[2], THREE.LinearSRGBColorSpace);
  };
  colorValue(material.color, material.map?.userData.scale ?? fields["inputs:diffuseColor"]);
  colorValue(material.emissive, material.emissiveMap?.userData.scale ?? fields["inputs:emissiveColor"]);
  colorValue(material.specularColor, material.specularColorMap?.userData.scale ?? fields["inputs:specularColor"]);
  if (material.roughnessMap?.userData.scale) material.roughness = material.roughnessMap.userData.scale[1];
  if (material.metalnessMap?.userData.scale) material.metalness = material.metalnessMap.userData.scale[2];
  const scale = material.normalMap?.userData.scale;
  const bias = material.normalMap?.userData.bias;
  if (Array.isArray(scale) && Array.isArray(bias) && Math.abs(bias[0] + scale[0] / 2) < 1e-6 && Math.abs(bias[1] + scale[1] / 2) < 1e-6) {
    material.normalScale.set(scale[0] / 2, scale[1] / 2);
  }
  const opacityConnections = this.specsByPath[`${shaderPath}.inputs:opacity`]?.fields.connectionPaths;
  if (Array.isArray(opacityConnections) && String(opacityConnections[0]).endsWith(".outputs:a") && material.map?.userData.scale?.length === 4) material.opacity = material.map.userData.scale[3];
};
