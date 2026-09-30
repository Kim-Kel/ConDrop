// A fresh worker per import releases the OpenCascade WASM heap after use.
// All code and WASM URLs are supplied by the app, never by the input model.
self.onmessage = async ({ data: { content, runtimeUrl, wasmUrl, params } }) => {
  try {
    importScripts(runtimeUrl);
    const occt = await self.occtimportjs({ locateFile: () => wasmUrl });
    const result = occt.ReadStepFile(new Uint8Array(content), params);
    if (!result.success || !result.meshes?.length) {
      throw new Error("STEP 형상을 읽지 못했습니다. 유효한 곡면·솔리드가 포함된 STP/STEP 파일인지 확인해 주세요.");
    }
    const transfer = [];
    for (const mesh of result.meshes) {
      for (const attribute of Object.values(mesh.attributes)) {
        attribute.array = new Float32Array(attribute.array);
        transfer.push(attribute.array.buffer);
      }
      mesh.index.array = new Uint32Array(mesh.index.array);
      transfer.push(mesh.index.array.buffer);
    }
    self.postMessage({ result }, transfer);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "STEP 변환 엔진에서 오류가 발생했습니다." });
  }
};
