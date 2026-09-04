# ConDrop — File Converter

브라우저 안에서 이미지와 3D 파일을 변환하는 정적 GitHub Pages 프로젝트입니다. 파일은 서버로 업로드되지 않으며 사용자의 PC에서 처리됩니다.

## GitHub Pages 게시

1. 이 폴더 안의 파일과 폴더를 GitHub 저장소의 최상위 경로에 업로드합니다.
2. 기본 브랜치를 `main`으로 설정합니다.
3. 저장소의 **Settings → Pages → Build and deployment → Source**에서 **GitHub Actions**를 선택합니다.
4. `main` 브랜치에 변경 사항을 푸시하면 배포가 자동으로 시작됩니다.

워크플로는 의존성을 설치하고 정적 사이트를 빌드한 뒤 GitHub Pages에 게시합니다. 별도의 API 키나 서버 환경 변수가 필요하지 않습니다.

## 로컬 실행

Node.js 22 이상과 pnpm이 필요합니다.

```bash
pnpm install
pnpm dev
```

프로덕션 빌드는 다음 명령으로 확인할 수 있습니다.

```bash
pnpm build
```

## 포함하지 않은 항목

- ChatGPT/Sites 프로젝트 ID와 호스팅 설정
- API 키, 환경 변수 및 인증 코드
- 서버·데이터베이스 코드
- 테스트, 예제, 빌드 결과물 및 개발 캐시
