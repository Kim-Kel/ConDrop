# ConDrop 3D 지원 범위와 조사 기록

2026-09-28 기준. 변환 코드는 GitHub Actions에서 정적 JavaScript로 빌드되고, 방문자의 브라우저에서 실행됩니다. 방문자에게 SketchUp, Blender, Python, WASM 런타임, 확장 프로그램 설치를 요구하지 않습니다. 파일 업로드 API나 외부 변환 서버를 사용하지 않습니다. 필요한 라이브러리는 사이트 파일로 함께 배포됩니다.

## 지원 형식

| 형식 | 입력 | 출력 | 보존 범위 |
|---|---|---|---|
| FBX | 바이너리·ASCII | 바이너리 FBX를 포함한 ZIP | 메시, 법선, UV, 재질, 지원 텍스처, 계층, 지원되는 스킨·모프·애니메이션 |
| USD / USDA / USDC / USDZ | 지원 | `.usd`(USDA 텍스트 인코딩) + 레이어·PNG 텍스처 ZIP | 정적 메시, 계층, UV, 법선, 양면 설정, Preview Surface 재질 |
| SKP | 지원, 일부 버전·요소 제한 | 없음 | 면 삼각분할, 컴포넌트 배치, 법선, UV, 색·투명도, 포함된 PNG/JPEG 텍스처 |
| STL | ASCII·바이너리 | 없음 | 저장된 삼각형과 법선. 지원되는 Magics 색상 확장 |
| GLB / GLTF | 기존 입력 보완 | GLB | 텍스처와 재질, 계층, 지원되는 애니메이션. 외부 버퍼는 ZIP 필요 |
| OBJ | 기존 입력 보완 | OBJ + MTL + 기본 색상 텍스처 ZIP | 정적 메시, 법선, UV, 기본 색·투명도 |

### 사용 방법

- Image / 3D 탭 어디에서든 파일을 드롭하거나 선택하면 종류에 맞는 탭으로 이동합니다. 혼합 선택은 각각의 큐에 보관하며 첫 번째 지원 파일의 탭을 표시합니다.
- 외부 텍스처, `.mtl`, `.bin`, USD 참조 레이어가 있으면 모델과 함께 ZIP에 넣고 상대 폴더 구조를 유지합니다. 최상위 모델은 하나여야 합니다. USD 내부 참조 메시 레이어는 하위 폴더에 둘 수 있습니다.
- PNG/JPEG 텍스처의 해상도를 자동 축소하지 않습니다. 출력 재인코딩에는 PNG를 사용합니다. 이는 이미 손실 압축된 JPEG를 복원한다는 의미는 아닙니다.
- FBX의 단위 정보와 SKP의 인치 좌표를 미터 기준으로 정규화합니다. 단위 메타데이터가 없는 STL/OBJ는 원본 좌표 숫자를 유지하며 Scale factor로 조절합니다.
- FBX 결과 ZIP에는 `.fbx`, `condrop-materials.json`, `textures/`가 들어 있습니다. FBX에 지원 텍스처를 내장하고, FBX 표준 Phong으로 충분히 표현할 수 없는 PBR 설정과 맵을 JSON/PNG에도 보존합니다. 이 ZIP을 ConDrop에 다시 넣으면 보조 재질 정보를 복원합니다. 다른 DCC 앱에서는 PBR 맵을 수동 연결해야 할 수 있습니다.
- USD 결과 ZIP은 압축을 푼 뒤 `.usd`를 엽니다. `geometries/`와 `textures/`를 함께 유지해야 합니다. `.usd`는 표준상 텍스트 USDA와 바이너리 USDC 모두를 담을 수 있으며 이번 출력은 USDA입니다.

## 구현하지 않은 범위와 품질 한계

**모든 원본 데이터의 무손실 보존을 보장하지 않습니다.** 변환 라이브러리가 읽어들인 장면과 출력 포맷의 공통 기능 범위에서 보존합니다. 원본 편집 이력, 응용 프로그램 전용 데이터와 임의의 셰이더 그래프를 동일하게 복원하는 기능은 없습니다.

### NURBS와 테셀레이션

STL은 이미 삼각형으로 저장되어 있으며 원래 NURBS의 제어점·매듭·트림 곡선을 갖고 있지 않습니다. SKP의 면 기반 형상도 기존 면을 삼각분할하는 방식으로 읽습니다. 이 파일들에서 곡면 정보를 새로 복원한 것처럼 분할 수만 늘리면 원본에 없는 형상을 추정하게 되므로, 임의 평활화·단순화·재메시를 하지 않고 저장된 면 해상도를 유지합니다.

실제 FBX NURBS/패치, USD NurbsPatch/NurbsCurves/일부 곡선, USD subdivision surface의 범용 고품질 테셀레이션은 이번 변환 경로에 없습니다. 지원되는 메시와 함께 있어도 이러한 요소를 조용히 누락하지 않도록 감지 가능한 경우 오류를 표시합니다. 고품질로 테셀레이션된 메시 입력이 필요합니다. SKP/STL 전용 NURBS 품질 슬라이더는 제공하지 않습니다.

### 셰이딩·동작

- FBX의 사용자 정의 셰이더, V-Ray/Arnold/MaterialX 전체 그래프, 렌더러 전용 노드와 절차적 텍스처는 변환하지 않습니다. Phong/PBR 간 셰이딩은 근사이며 앱별로 차이가 있습니다. FBX 보조 재질 아카이브도 **입력 파서가 이미 읽지 못한 데이터**까지 복원하지는 못합니다.
- USD 출력은 현재 포즈의 정적 메시입니다. 리깅·애니메이션·모프 편집 정보는 유지하지 않습니다. 포즈가 변형된 메시의 법선은 다시 계산됩니다. 애니메이션이 중요하면 GLB 또는 FBX를 선택합니다.
- USD 출력의 주요 맵은 기본 색, 법선, roughness, metallic, AO, emission, opacity 및 지원되는 clearcoat입니다. bump/displacement, 모든 확장 PBR 특성, HDR/고비트 심도 텍스처, UV별 모든 렌더러 특성의 완전한 재현은 보장하지 않습니다.
- USD 전체 composition 엔진은 아닙니다. subLayers, 모든 variant·payload·instance 조합과 모든 crate 버전을 보장하지 않습니다. 명시적인 subLayers 등 감지된 미지원 요소와 누락된 참조는 오류를 냅니다. 참조 및 텍스처는 ZIP에 포함해야 하며 파일 내용이 지정한 외부 URL을 요청하지 않습니다.
- SKP는 OpenSKP 1.3.0의 읽기 범위에 따릅니다. 공식 SketchUp SDK가 아니며 모든 과거·미래 버전을 지원한다고 주장하지 않습니다. 구버전, 특수 요소, 비 PNG/JPEG 텍스처, 동적 컴포넌트 동작, 스타일·장면·치수·가이드·전용 재질은 차이가 있거나 누락될 수 있습니다.
- 브라우저 메모리와 장치 성능이 처리 가능한 파일 크기를 결정합니다. 대형 파일 파싱 일부는 메인 스레드에서 실행되어 화면 반응이 일시적으로 느려질 수 있습니다.

## 선택 근거와 1차 자료

| 검토한 기술 | 결론 | 근거 |
|---|---|---|
| Three.js FBXLoader | 기존 입력 개선. 비동기 텍스처 완료·단위 보정·NURBS 미지원 감지 추가 | [공식 FBXLoader 문서](https://threejs.org/docs/pages/FBXLoader.html) |
| Comfy FBX exporter | 브라우저 내 바이너리 출력, 스킨/애니메이션 및 내장 PNG. 부족한 PBR 맵은 별도 아카이브 | [제작자 저장소](https://github.com/Comfy-Org/fbx-exporter-three) |
| Three.js USDLoader / USDZExporter | USDA/USDC/USDZ 읽기, Preview Surface 쓰기. 기본 1024px 제한을 해제하고 PNG 출력으로 고정 | [USDLoader](https://threejs.org/docs/pages/USDLoader.html), [USDZExporter](https://threejs.org/docs/pages/USDZExporter.html) |
| OpenUSD | 확장자·텍스처 연결·NURBS/메시 모델 확인. 출력은 공식 파서로 독립 검증 | [USD FAQ](https://openusd.org/dev/usdfaq.html), [셰이딩](https://openusd.org/dev/tut_simple_shading.html), [NurbsPatch](https://openusd.org/dev/api/class_usd_geom_nurbs_patch.html) |
| SketchUp Desktop SDK | 직접 SKP 읽기는 가능하지만 배포된 네이티브 SDK만으로 정적 브라우저 실행 요구 충족 불가 | [공식 Desktop SDK](https://extensions.sketchup.com/en/developer_center/sketchup_sdk) |
| OpenSKP | MIT 라이선스의 브라우저용 파서 발견. 인스턴스 보존 API와 `textures: true`를 사용하므로 SKP 입력 제외 불필요 | [제작자 저장소·지원 범위](https://github.com/iamahsanmehmood/openskp), [라이선스](https://github.com/iamahsanmehmood/openskp/blob/main/LICENSE) |
| Assimp / assimpjs | 대안으로 검토. FBX 출력이 실험적이며 이번에는 Three 장면에서 직접 변환하는 경로 선택 | [지원 포맷](https://github.com/assimp/assimp/blob/master/doc/Fileformats.md), [assimpjs](https://github.com/kovacsv/assimpjs) |
| STL / SKP 메시 | 저장된 삼각형·면을 유지. 없는 NURBS·UV 텍스처를 생성하지 않음 | [미국 의회도서관 STL 명세 정리](https://www.loc.gov/preservation/digital/formats/fdd/fdd000504.shtml), [SketchUp PolygonMesh API](https://ruby.sketchup.com/Geom/PolygonMesh.html) |

## 검증

- Playwright 실제 Edge 브라우저: 양방향 드롭/선택, 혼합 큐, STL ASCII/바이너리, SKP 내장 텍스처·인스턴스, OBJ 상대 텍스처 경로, GLB 애니메이션, FBX 재입력(크기·2048px 텍스처·PBR·UV·애니메이션), USD 재입력(재질 그룹·PBR·양면·참조 레이어), 실패 입력.
- 공식 OpenUSD 26.8에서 생성한 USDC를 `.usdc`, `.usd`, `.usdz`로 읽어 형상을 검사했습니다. 작은 자체 생성 바이너리 fixture를 테스트에 포함했습니다.
- 공식 OpenUSD 26.8으로 생성된 USD 출력의 실제 stage를 열어 12개 삼각형, 양면 메시 3개, 법선 및 material binding을 별도 확인했습니다. Python 도구는 개발 검증에만 사용하며 웹사이트에는 배포되지 않습니다.
- 외부 공개 샘플: OpenSKP `chair_and_table.skp`(704개 삼각형), Three.js `saeukkang.usdz`(25,000개 삼각형·텍스처 1개). 이 샘플은 로컬 검증용으로만 내려받았으며 배포 아카이브에는 포함하지 않습니다.
- GitHub Actions에 타입 검사와 브라우저 회귀 검사를 추가했습니다. CI는 Chromium을 사용합니다. 실제 GitHub의 배포 실행은 별도로 push해야 합니다.
- 완성된 정적 빌드를 `/ConDrop/` 하위 경로에서 실행해 STL → GLB/FBX/USD, SKP → GLB 다운로드를 확인했습니다. 이 과정에서 외부 네트워크 요청과 브라우저 예외는 없었습니다.
- Three.js 0.185.1의 USD Preview Surface 해석을 보정해 선형 색상 상수, roughness/metallic 텍스처 배율, 노멀 강도까지 수치 비교합니다. [OpenUSD Preview Surface 규격](https://openusd.org/dev/spec_usdpreviewsurface.html)을 기준으로 하며 검증한 라이브러리 버전을 고정했습니다.
