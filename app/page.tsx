"use client";

import { useMemo, useRef, useState } from "react";
import {
  acceptedImages, acceptedModels, analyzeImage, exportImages, exportModels,
  fileExtension, formatBytes, isAccepted, type ImageAnalysis, type ImageFormat, type ModelFormat,
} from "./client-conversion";

type Mode = "image" | "3d";
type QueueItem = { id: string; file: File; analysis?: ImageAnalysis; error?: string };

const imageFormats: Array<{ value: ImageFormat; label: string; ext: string; description: string }> = [
  { value: "png", label: "PNG", ext: ".png", description: "Lossless · transparency" },
  { value: "jpg", label: "JPG", ext: ".jpg", description: "Compact · universal" },
];

const modelFormats: Array<{ value: ModelFormat; label: string; ext: string; description: string }> = [
  { value: "glb", label: "GLB", ext: ".glb", description: "Materials · animation" },
  { value: "obj", label: "OBJ", ext: ".zip", description: "OBJ + MTL + textures" },
  { value: "usd", label: "USD", ext: ".zip", description: "USD + PNG textures" },
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
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState("");
  const [notice, setNotice] = useState("");
  const items = mode === "image" ? imageItems : modelItems;
  const setItems = mode === "image" ? setImageItems : setModelItems;
  const hasLayers = imageItems.some((item) => (item.analysis?.layers || 0) > 0);
  const readyCount = items.filter((item) => !item.error).length;
  const accept = useMemo(() => (mode === "image" ? acceptedImages : acceptedModels).map((ext) => `.${ext}`).join(","), [mode]);

  const addFiles = async (list: FileList | File[]) => {
    const incoming = Array.from(list);
    const valid = incoming.filter((file) => isAccepted(file, mode));
    const invalid = incoming.filter((file) => !isAccepted(file, mode));
    if (invalid.length) setNotice(`지원하지 않는 파일 ${invalid.length}개를 제외했습니다: ${invalid.map((file) => file.name).join(", ")}`);
    if (!valid.length) return;
    const queued = valid.map((file) => ({ id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`, file }));
    setItems((current) => [...current, ...queued]);
    if (mode === "image") {
      for (const item of queued) {
        try {
          const analysis = await analyzeImage(item.file);
          setImageItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, analysis } : entry));
        } catch (error) {
          setImageItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, error: error instanceof Error ? error.message : "파일을 읽지 못했습니다." } : entry));
        }
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
        await exportModels(files, modelFormat, scale, setProgress);
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
            {!items.length && <p className="support-line">{mode === "image" ? "PNG · JPG · GIF · AVIF · WEBP · BMP · ICO · TIFF · PSD · EXR" : "OBJ · FBX · GLB · GLTF · USD · USDA · USDC · USDZ · ZIP"}</p>}
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
                {imageFormat === "png" && <label className="check-setting"><input checked={alpha} onChange={(event) => setAlpha(event.target.checked)} type="checkbox" /><span><strong>Include alpha channel</strong><small>Preserve transparency. Off fills transparent areas with black.</small></span></label>}
                {imageFormat === "jpg" && <div className="setting-block"><div className="setting-heading"><div><strong>Compression</strong><small>1 = best quality, 10 = smallest file.</small></div><output>{compression}/10</output></div><input aria-label="JPG compression" type="range" min="1" max="10" value={compression} onChange={(event) => setCompression(Number(event.target.value))} /></div>}
                {hasLayers && <div className="setting-block"><div className="setting-heading"><div><strong>PSD layers</strong><small>Merged image or a ZIP with one image per layer.</small></div></div><div className="segmented"><button className={layerMode === "merged" ? "active" : ""} onClick={() => setLayerMode("merged")} type="button">Merged</button><button className={layerMode === "separated" ? "active" : ""} onClick={() => setLayerMode("separated")} type="button">Separated</button></div></div>}
              </div> : <div className="settings-stack">
                <div className="setting-block"><div className="setting-heading"><div><strong>Scale factor</strong><small>Multiplies the model scale before export.</small></div></div><div className="number-field"><span>×</span><input aria-label="Scale factor" type="number" min="0.0001" step="0.1" value={scale} onChange={(event) => setScale(Number(event.target.value))} /></div></div>
                <div className="info-strip"><span>i</span><p>For OBJ/GLTF with separate textures, upload one ZIP containing the model, material files, textures and buffers.</p></div>
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
