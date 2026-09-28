export type ConverterMode = "image" | "3d";
export const acceptedImages = ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "tif", "tiff", "psd", "exr"];
export const acceptedModels = ["obj", "fbx", "glb", "gltf", "usd", "usda", "usdc", "usdz", "skp", "stl", "zip"];
export const fileExtension = (name: string) => name.split(".").pop()?.toLowerCase() || "";

// Classify the whole drop, independently of the selected tab. Mixed drops keep
// both queues; the first recognized file determines which queue is displayed.
export function routeFiles<T extends { name: string }>(files: T[], current: ConverterMode) {
  const images: T[] = [], models: T[] = [], rejected: T[] = [];
  let mode = current;
  let found = false;
  for (const file of files) {
    const ext = fileExtension(file.name);
    const type = acceptedModels.includes(ext) ? "3d" : acceptedImages.includes(ext) ? "image" : null;
    if (type) {
      if (!found) mode = type;
      found = true;
      (type === "image" ? images : models).push(file);
    } else rejected.push(file);
  }
  return { images, models, rejected, mode };
}
