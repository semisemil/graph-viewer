# 개발 안내

## 준비와 빌드

소스 개발에는 Node.js 22.12 이상과 npm이 필요합니다.
플러그인 사용자는 아래 빌드 과정을 실행하지 않습니다.

```powershell
npm ci --ignore-scripts
npm run build:plugin
npm test
```

빌드는 plugins/graph-viewer의 서버 번들, 렌더러, 실행기와 스킬을 갱신합니다.
배포 폴더에 외부 node_modules는 필요하지 않습니다.
이 폴더와 루트 .agents/plugins/marketplace.json이 marketplace 배포 대상입니다.

## 검사

기본 검사는 CLI, HTTP, MCP와 Mermaid 입력을 다룹니다.
프로젝트별 저장, 상태 복구, 이동한 배포본과 PATH에 Node가 없는 실행도 확인합니다.

브라우저 통합 검사는 GRAPH_PANEL_PLAYWRIGHT에 Playwright 패키지의 절대 경로를 지정하면 실행합니다.
GRAPH_PANEL_CHROMIUM에는 사용할 Chromium 실행 파일을 지정할 수 있습니다.
렌더러의 별도 검사는 scripts/verify-browser.mjs에서 실행합니다.

## 개발용 패키지 복사

설정을 따로 시험하려면 다음 명령으로 새 패키지 폴더를 만듭니다.

```powershell
node scripts/package-mcp.mjs --output '<새 패키지 절대 경로>'
```

--data-dir와 --log는 기존 저장 경로나 진단 파일을 명시하는 개발 옵션입니다.
기본 설치는 도구가 전달한 프로젝트 안에 자료를 저장합니다.

GitHub 저장소 이름이 정해지면 해당 저장소를 Codex marketplace로 등록할 수 있습니다.
등록용 Codex CLI 명령은 그래프 기능의 실행 의존성이 아닙니다.
배포 절차는 [공식 플러그인 문서](https://developers.openai.com/plugins/build/plugins)를 따릅니다.

## MCP 프로토콜

서버는 2026-07-28과 이전 프로토콜의 호환 경로를 제공합니다.
현재 검증한 Codex 번들에서 새 프로토콜을 사용하려면 mcp_2026_07_28 기능 설정이 필요합니다.
graph_status의 protocolVersion으로 실제 연결 버전을 확인합니다.

## 엔진 직접 사용

높이가 지정된 HTML 컨테이너에서 src/model.js와 src/renderer.js를 로드합니다.

```javascript
const view = GraphPanel.mount(container, {
  graph,
  compact: false,
  onAction(action) {
    // 애플리케이션의 저장 경로에 연결합니다.
  }
});
view.update(nextGraph);
view.destroy();
```

compact:true는 좁은 화면에 맞는 세로 배치입니다.
자료 공급과 상태 저장은 엔진을 사용하는 애플리케이션이 담당합니다.
