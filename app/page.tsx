"use client";

import { useRef, useState } from "react";
import {
  acceptedImages, acceptedModels, analyzeImage, exportImages, exportModels,
  fileExtension, formatBytes, type ImageAnalysis, type ImageFormat, type ModelFormat,
} from "./client-conversion";
import { routeFiles } from "./file-routing";
import { stepQuality, type TessellationQuality } from "./step-options";

type Mode = "image" | "3d";
type QueueItem = { id: string; file: File; analysis?: ImageAnalysis; error?: string };

const imageFormats: Array<{ value: ImageFormat; label: string; ext: string; description: string }> = [
  { value: "png", label: "PNG", ext: ".png", description: "Lossless · transparency" },
  { value: "jpg", label: "JPG", ext: ".jpg", description: "Compact · universal" },
];

const modelFormats: Array<{ value: ModelFormat; label: string; ext: string; description: string }> = [
  { value: "glb", label: "GLB", ext: ".glb", description: "Materials · animation" },
  { value: "fbx", label: "FBX", ext: ".zip", description: "FBX + material archive" },
  { value: "obj", label: "OBJ", ext: ".zip", description: "OBJ + MTL + textures" },
  { value: "usd", label: "USD", ext: ".zip", description: "USD + PBR textures" },
];

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("image");
  const [imageItems, setImageItems] = useState<QueueItem[]>([]);
  const [modelItems, setModelItems] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [imageFormat, setImageFormat] = useState<ImageFormat>("png");
  const [modelFormat, setModelFormat] = useState<ModelFormat>("glb");
  const [resize, setResize] = useState(100);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [alpha, setAlpha] = useState(true);
  const [compression, setCompression] = useState(4);
  const [layerMode, setLayerMode] = useState<"merged" | "separated">("merged");
  const [scale, setScale] = useState(1);
  const [tessellation, setTessellation] = useState<TessellationQuality>("high");
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState("");
  const [notice, setNotice] = useState("");
  const items = mode === "image" ? imageItems : modelItems;
  const setItems = mode === "image" ? setImageItems : setModelItems;
  const hasLayers = imageItems.some((item) => (item.analysis?.layers || 0) > 0);
  const readyCount = items.filter((item) => !item.error).length;
  const accept = [...acceptedImages, ...acceptedModels].map((ext) => `.${ext}`).join(",");

  const addFiles = async (list: FileList | File[]) => {
    const routed = routeFiles(Array.from(list), mode);
    const queue = (files: File[]) => files.map((file) => ({ id: crypto.randomUUID(), file }));
    const queued = queue(routed.images);
    setImageItems((current) => [...current, ...queued]);
    setModelItems((current) => [...current, ...queue(routed.models)]);
    setMode(routed.mode);
    setNotice(routed.rejected.length
      ? `지원하지 않는 파일 ${routed.rejected.length}개를 제외했습니다: ${routed.rejected.map((file) => file.name).join(", ")}`
      : routed.images.length && routed.models.length ? "이미지와 3D 파일을 각각의 탭에 추가했습니다." : "");
    for (const item of queued) {
        try {
          const analysis = await analyzeImage(item.file);
          setImageItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, analysis } : entry));
        } catch (error) {
          setImageItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, error: error instanceof Error ? error.message : "파일을 읽지 못했습니다." } : entry));
        }
      }
  };

  const removeItem = (id: string) => {
    const item = items.find((entry) => entry.id === id);
    if (item?.analysis?.previewUrl) URL.revokeObjectURL(item.analysis.previewUrl);
    setItems((current) => current.filter((entry) => entry.id !== id));
  };

  const clearItems = () => {
    items.forEach((item) => item.analysis?.previewUrl && URL.revokeObjectURL(item.analysis.previewUrl));
    setItems([]);
  };

  const convert = async () => {
    const files = items.filter((item) => !item.error).map((item) => item.file);
    if (!files.length || working) return;
    setWorking(true);
    setNotice("");
    try {
      if (mode === "image") {
        await exportImages(files, { format: imageFormat, resize, flipX, flipY, alpha, compression, layerMode }, setProgress);
      } else {
        if (!Number.isFinite(scale) || scale <= 0) throw new Error("Scale factor는 0보다 큰 숫자여야 합니다.");
        const warnings = await exportModels(files, modelFormat, scale, setProgress, { tessellation });
        setNotice(`${files.length}개 파일의 변환이 완료되었습니다.${warnings.length ? ` ${warnings.join(" ")}` : ""}`);
        return;
      }
      setNotice(`${files.length}개 파일의 변환이 완료되었습니다.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "변환 중 오류가 발생했습니다.");
    } finally {
      setWorking(false);
      setProgress("");
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="ConDrop File Converter"><span className="brand-mark" aria-hidden="true"><i /></span><span className="brand-copy"><strong>ConDrop</strong><small>FILE CONVERTER</small></span></div>
        <nav className="mode-tabs" aria-label="Converter mode"><button className={mode === "image" ? "active" : ""} onClick={() => setMode("image")} type="button">Image</button><button className={mode === "3d" ? "active" : ""} onClick={() => setMode("3d")} type="button">3D</button></nav>
        <div className="local-badge"><span /> LOCAL PROCESSING</div>
      </header>

      <section className={`workspace ${items.length ? "has-files" : ""}`}>
        <div className="content-wrap">
          <div className={`drop-card ${dragging ? "dragging" : ""} ${items.length ? "compact" : ""}`} role="button" tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && inputRef.current?.click()}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
            onDrop={(event) => { event.preventDefault(); setDragging(false); void addFiles(event.dataTransfer.files); }}>
            <input ref={inputRef} className="file-input" type="file" accept={accept} multiple onChange={(event) => { if (event.target.files) void addFiles(event.target.files); event.target.value = ""; }} />
            <div className="drop-icon" aria-hidden="true">↓</div>
            <div className="drop-message"><p className="eyebrow">{mode === "image" ? "IMAGE CONVERTER" : "3D CONVERTER"}</p><h1>{items.length ? `Add more ${mode === "image" ? "images" : "models"}` : `Drop your ${mode === "image" ? "images" : "3D files"} here`}</h1><p className="drop-copy">Drag & drop or click to browse — files never leave your device</p></div>
            <button className="primary-button" type="button">Choose files</button>
            {!items.length && <p className="support-line">{mode === "image" ? "PNG · JPG · GIF · AVIF · WEBP · BMP · ICO · TIFF · PSD · EXR" : "OBJ · FBX · GLB · GLTF · USD · USDA · USDC · USDZ · SKP · STL · STP · STEP · ZIP"}<br />File type switches tabs automatically</p>}
          </div>

          {items.length > 0 && <div className="converter-grid">
            <section className="queue-panel panel">
              <div className="panel-header"><div><p className="section-kicker">INPUT QUEUE</p><h2>{items.length} file{items.length === 1 ? "" : "s"}</h2></div><button className="text-button" onClick={clearItems} type="button">Clear all</button></div>
              <div className="file-list">{items.map((item) => <article className={`file-row ${item.error ? "failed" : ""}`} key={item.id}>
                <div className="thumb">{item.analysis?.previewUrl ? <img src={item.analysis.previewUrl} alt="" /> : <span>{fileExtension(item.file.name).slice(0, 4).toUpperCase()}</span>}</div>
                <div className="file-details"><strong title={item.file.name}>{item.file.name}</strong><small>{item.error ? item.error : item.analysis ? `${item.analysis.width} × ${item.analysis.height}${item.analysis.layers ? ` · ${item.analysis.layers} layers` : ""}` : mode === "image" ? "Reading image…" : `${fileExtension(item.file.name).toUpperCase()} · ${formatBytes(item.file.size)}`}</small>{item.analysis?.note && <em>{item.analysis.note}</em>}</div>
                <div className="file-size">{formatBytes(item.file.size)}</div><button className="remove-button" onClick={() => removeItem(item.id)} type="button" aria-label={`${item.file.name} remove`}>×</button>
              </article>)}</div>
            </section>

            <section className="options-panel panel">
              <div className="panel-header"><div><p className="section-kicker">EXPORT SETTINGS</p><h2>Choose output</h2></div><span className="ready-count">{readyCount} READY</span></div>
              <div className={`format-grid ${mode === "3d" ? "three" : ""}`}>{(mode === "image" ? imageFormats : modelFormats).map((format) => {
                const selected = mode === "image" ? imageFormat === format.value : modelFormat === format.value;
                return <button className={`format-card ${selected ? "selected" : ""}`} key={format.value} onClick={() => mode === "image" ? setImageFormat(format.value as ImageFormat) : setModelFormat(format.value as ModelFormat)} type="button"><span className="radio-dot" /><strong>{format.label}</strong><small>{format.description}</small><code>{format.ext}</code></button>;
              })}</div>

              {mode === "image" ? <div className="settings-stack">
                <div className="setting-block"><div className="setting-heading"><div><strong>Resize</strong><small>Scale both dimensions proportionally.</small></div><output>{resize}%</output></div><input aria-label="Resize percentage" type="range" min="1" max="100" value={resize} onChange={(event) => setResize(Number(event.target.value))} /></div>
                <div className="setting-block inline-setting"><div><strong>Flip</strong><small>Mirror every exported image.</small></div><div className="toggle-pair"><button className={flipX ? "active" : ""} onClick={() => setFlipX(!flipX)} type="button">X</button><button className={flipY ? "active" : ""} onClick={() => setFlipY(!flipY)} type="button">Y</button></div></div>
                {imageFormat === "png" && <label className="check-setting" htmlFor="include-alpha" aria-label="Include alpha channel"><input id="include-alpha" checked={alpha} onChange={(event) => setAlpha(event.target.checked)} type="checkbox" /><span><strong>Include alpha channel</strong><small>Preserve transparency. Off fills transparent areas with black.</small></span></label>}
                {imageFormat === "jpg" && <div className="setting-block"><div className="setting-heading"><div><strong>Compression</strong><small>1 = best quality, 10 = smallest file.</small></div><output>{compression}/10</output></div><input aria-label="JPG compression" type="range" min="1" max="10" value={compression} onChange={(event) => setCompression(Number(event.target.value))} /></div>}
                {hasLayers && <div className="setting-block"><div className="setting-heading"><div><strong>PSD layers</strong><small>Merged image or a ZIP with one image per layer.</small></div></div><div className="segmented"><button className={layerMode === "merged" ? "active" : ""} onClick={() => setLayerMode("merged")} type="button">Merged</button><button className={layerMode === "separated" ? "active" : ""} onClick={() => setLayerMode("separated")} type="button">Separated</button></div></div>}
              </div> : <div className="settings-stack">
                <div className="setting-block"><div className="setting-heading"><div><strong>STEP 테셀레이션 품질</strong><small>STP/STEP 및 ZIP 내부 STEP에 적용됩니다. 상: 매끄러운 곡면 · 하: 빠른 변환, 작은 파일.</small></div></div><div className="segmented" role="group" aria-label="STEP 테셀레이션 품질">{(Object.keys(stepQuality) as TessellationQuality[]).map((quality) => <button key={quality} className={tessellation === quality ? "active" : ""} aria-pressed={tessellation === quality} onClick={() => setTessellation(quality)} type="button">{stepQuality[quality].label}</button>)}</div><small>STEP의 부품·면 색상과 법선을 보존합니다. 텍스처·전용 셰이더·투명도는 지원하지 않습니다.</small></div>
                <div className="setting-block"><div className="setting-heading"><div><strong>Scale factor</strong><small>Multiplies the model scale before export.</small></div></div><div className="number-field"><span>×</span><input aria-label="Scale factor" type="number" min="0.0001" step="0.1" value={scale} onChange={(event) => setScale(Number(event.target.value))} /></div></div>
                <div className="info-strip"><span>i</span><p>For external textures or USD layers, drop a ZIP containing the model and all companion files. Keep their folder structure. Textures retain their source resolution.</p></div>
                <div className="info-strip"><span>i</span><p>SKP / STL are input only. Stored mesh detail is preserved without simplification. STL has no UV textures. Some SKP versions and renderer-specific shaders are unsupported; NURBS surfaces must already be tessellated.</p></div>
                {modelFormat === "fbx" && <div className="info-strip"><span>i</span><p>FBX embeds supported textures. The ZIP also includes PBR material settings and texture files, since FBX readers differ in shader support.</p></div>}
                {modelFormat === "usd" && <div className="info-strip"><span>i</span><p>USD uses a static mesh snapshot with Preview Surface materials. Rigging, animation clips and procedural shaders are not retained in this output.</p></div>}
              </div>}

              <button className="convert-button" disabled={!readyCount || working} onClick={() => void convert()} type="button"><span>{working ? "Converting…" : `Convert ${readyCount} file${readyCount === 1 ? "" : "s"}`}</span><kbd>→</kbd></button>
              <p className="filename-note">Downloads use <code>original-name_cvt</code>. Multiple results are bundled in a ZIP.</p>
            </section>
          </div>}

        </div>
      </section>

      <footer className="statusbar"><span><i className={working ? "busy" : ""} /> {working ? progress || "Working" : "Ready"}</span><span>{notice || "Files stay on your device · no upload"}</span></footer>
      {working && <div className="working-overlay"><div className="working-card"><span className="spinner" /><strong>Converting locally</strong><small>{progress}</small><div className="progress-track"><i /></div></div></div>}
      {notice && !working && <button className="toast" onClick={() => setNotice("")} type="button">{notice}<span>×</span></button>}
    </main>
  );
}
