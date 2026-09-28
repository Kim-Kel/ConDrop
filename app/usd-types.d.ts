declare module "three/examples/jsm/loaders/usd/USDAParser.js" {
  export class USDAParser { parseData(text: string): { specsByPath: Record<string, { specType: number; fields: Record<string, unknown> }> }; }
}
declare module "three/examples/jsm/loaders/usd/USDCParser.js" {
  export class USDCParser { parseData(buffer: ArrayBuffer): { specsByPath: Record<string, { specType: number; fields: Record<string, unknown> }> }; }
}
declare module "three/examples/jsm/loaders/usd/USDComposer.js" {
  import { MeshPhysicalMaterial } from "three";
  export class USDComposer {
    specsByPath: Record<string, { fields: Record<string, unknown> }>;
    _applyPreviewSurface(material: MeshPhysicalMaterial, shaderPath: string): void;
    _getAttributes(path: string): Record<string, unknown>;
  }
}
