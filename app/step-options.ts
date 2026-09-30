export type TessellationQuality = "high" | "medium" | "low";

// Linear error is relative to the average bounding-box dimension of each
// free shape. Angular error is in radians. Smaller values give finer meshes.
export const stepQuality = {
  high: { label: "상", linearDeflection: 0.0001, angularDeflection: 0.1 },
  medium: { label: "중", linearDeflection: 0.001, angularDeflection: 0.25 },
  low: { label: "하", linearDeflection: 0.01, angularDeflection: 0.5 },
} satisfies Record<TessellationQuality, { label: string; linearDeflection: number; angularDeflection: number }>;

export interface ModelLoadOptions { tessellation?: TessellationQuality }
