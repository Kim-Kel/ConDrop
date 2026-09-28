// Read only geometry declarations, skipping vertex/texture payloads. FBXLoader
// otherwise silently drops NURBS surfaces in files that also contain meshes.
export function validateFbxGeometry(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder();
  const verify = (type: string) => {
    if (type && !["Mesh", "Shape"].includes(type)) {
      throw new Error(`FBX ${type}는 메시 출력으로 보존할 수 없습니다. 원본 앱에서 곡면·곡선을 고품질 메시로 테셀레이션해 주세요.`);
    }
  };
  if (!decoder.decode(bytes.slice(0, 20)).startsWith("Kaydara FBX Binary")) {
    const text = decoder.decode(bytes);
    for (const match of text.matchAll(/Geometry:\s*\d+\s*,\s*"[^"]*"\s*,\s*"([^"]*)"/g)) verify(match[1]);
    return;
  }
  const view = new DataView(buffer);
  const wide = view.getUint32(23, true) >= 7500;
  const size = wide ? 8 : 4;
  const number = (offset: number) => wide ? Number(view.getBigUint64(offset, true)) : view.getUint32(offset, true);
  const walk = (start: number, limit: number, inObjects: boolean) => {
    for (let offset = start; offset + size * 3 + 1 <= limit;) {
      const end = number(offset);
      if (end === 0) break;
      const count = number(offset + size);
      const propertyLength = number(offset + size * 2);
      const nameLength = view.getUint8(offset + size * 3);
      let cursor = offset + size * 3 + 1;
      const name = decoder.decode(bytes.subarray(cursor, cursor + nameLength));
      cursor += nameLength;
      const children = cursor + propertyLength;
      if (!Number.isSafeInteger(end) || end <= offset || end > buffer.byteLength || children > end) throw new Error("FBX 노드 길이가 올바르지 않습니다.");
      if (inObjects && name === "Geometry") {
        const strings: string[] = [];
        for (let i = 0; i < Math.min(count, 3); i++) {
          const type = String.fromCharCode(view.getUint8(cursor++));
          if (type === "S") {
            const length = view.getUint32(cursor, true); cursor += 4;
            if (cursor + length > children) throw new Error("FBX 속성 길이가 올바르지 않습니다.");
            strings.push(decoder.decode(bytes.subarray(cursor, cursor + length))); cursor += length;
          } else if (type === "L" || type === "D") cursor += 8;
          else if (type === "I" || type === "F") cursor += 4;
          else if (type === "Y") cursor += 2;
          else if (type === "C") cursor++;
          else break;
        }
        if (strings.length >= 2) verify(strings[1]);
      }
      if (!inObjects && name === "Objects") walk(children, end, true);
      offset = end;
    }
  };
  walk(27, buffer.byteLength, false);
}
