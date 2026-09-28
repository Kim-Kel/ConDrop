# ConDrop — File Converter

브라우저 안에서 이미지와 3D 파일을 변환하는 정적 GitHub Pages 프로젝트입니다. 파일은 서버로 업로드되지 않으며 사용자의 PC에서 처리됩니다.

## 변환 기능과 제약

- 파일 종류에 따라 Image ↔ 3D 탭이 자동으로 전환됩니다. 혼합 파일은 각각의 큐에 보관합니다.
- FBX 입력·출력, USD/USDA/USDC/USDZ 입력·USD 출력, SKP/STL 입력을 지원합니다.
- 외부 텍스처·재질·버퍼·USD 참조 레이어는 모델과 같은 ZIP에 넣고 폴더 구조를 유지하세요.
- FBX 출력 ZIP에는 모델과 PBR 재질 보조 JSON/PNG가 들어 있습니다. USD 출력 ZIP에는 `.usd`와 참조 레이어·PNG가 포함됩니다.
- NURBS 원본 곡면, 일부 SKP 버전, 렌더러 전용 셰이더의 완전한 보존은 지원하지 않습니다. USD 출력은 정적 메시입니다.


Windows 테스트는 Edge를, GitHub Actions는 Chromium을 사용합니다. 이 설치 과정은 개발·CI용이며 사이트 방문자에게 요구되지 않습니다.

## 포함하지 않은 항목

- ChatGPT/Sites 프로젝트 ID와 호스팅 설정
- API 키, 환경 변수 및 인증 코드
- 서버·데이터베이스 코드
- 외부 테스트 샘플, 빌드 결과물 및 개발 캐시



by Codex
