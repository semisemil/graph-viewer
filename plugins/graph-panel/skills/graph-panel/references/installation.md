# 설치와 연결

GitHub marketplace를 등록하고 플러그인을 설치한다.

```powershell
codex plugin marketplace add OWNER/REPO
codex plugin add graph-panel@graph-panel
```

OWNER/REPO는 공개 저장소가 정해지면 실제 경로로 교체한다.
설치한 플러그인이 표시되지 않으면 Codex를 다시 연다.

Codex는 평소 아이콘으로 실행한다.
앱이 stdio MCP 프로세스를 관리한다.
실행기는 Codex 번들 Node를 먼저 찾고, 없으면 PATH의 Node 22.12 이상을 사용한다.
플러그인 사용에 별도 Codex CLI 설치는 필요하지 않다.

## 저장 위치

모델 도구에 projectPath로 현재 프로젝트의 절대 폴더 경로를 전달한다.
그 아래 .graph-viewer에 그래프와 보기 상태를 저장한다.
projectPath는 플러그인 설치 폴더가 아니라 사용자가 작업하는 프로젝트다.

이전 설치에서 GRAPH_PANEL_DATA_DIR을 명시했다면 projectPath를 생략한 호출만 그 경로를 사용한다.
기존 자료를 자동 이동하지 않는다.

## 연결 확인

- 도구 없음: 플러그인 설치와 활성 상태를 확인한다.
- missing-project: 현재 작업 프로젝트의 절대 경로를 projectPath로 전달한다.
- missing-chat-context: 호스트가 요청 채팅 ID를 전달하지 않았다.
- stale-session: 같은 projectPath와 graphId로 open_graph를 다시 호출한다.

현재 Windows 번들에서 MCP 2026-07-28을 사용하려면 Codex의 mcp_2026_07_28 기능이 켜져 있어야 한다.
플러그인의 서버 설정은 CODEX_MCP_PROTOCOL_VERSION을 지정한다.
실제 연결 버전은 graph_status.protocolVersion으로 확인한다.
