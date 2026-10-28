---
name: graph-viewer
description: Create and update interactive graphs from Mermaid flowcharts or JSON, including architecture and public investigation records in Codex.
---

# Graph Viewer

설치된 graph-viewer MCP 도구로 그래프를 저장하고 그래프 탭을 연다.
모든 모델 도구 호출에 **현재 작업 프로젝트의 절대 경로인 projectPath**를 전달한다.
자료와 보기 상태는 그 프로젝트의 .graph-viewer에 저장된다.

## 생성과 갱신

1. 단순한 노드와 연결은 Mermaid flowchart 또는 graph로 작성한다.
   프로젝트나 영역을 한 그래프 안에서 구분하려면 subgraph를 사용한다.
   그룹 제목, 중첩 테두리와 그룹 간 연결을 지원한다.
   상세 설명, 상태나 출처가 필요하면 [그래프 JSON 형식](references/graph-format.md)을 읽고 JSON을 작성한다.
   같은 그래프를 갱신할 때 graphId와 유지할 노드 ID를 보존한다.
   탐색 기록은 사용자에게 설명할 목표, 관찰, 실행 결과와 결론을 사용한다.
2. `graph_status({projectPath,graphId})`로 현재 revision을 확인한다.
   본문이 필요할 때 `graph_read({projectPath,graphId})`를 사용한다.
3. `graph_publish({projectPath,graphPath,expectedRevision})`로 JSON 또는 Mermaid 파일의 절대 경로를 전달한다.
   Mermaid 파일은 .mmd 또는 .mermaid 확장자를 사용하고 필요하면 graphId와 title을 함께 지정한다.
   인라인 Mermaid는 `{projectPath,mermaid,graphId,title,expectedRevision}`, 인라인 JSON은 `{projectPath,graph,expectedRevision}`으로 전달한다.
   첫 저장의 expectedRevision은 0이다.
   버전 충돌이면 최신 문서를 읽고 변경을 합친다.
4. 처음 표시하거나 닫은 그래프를 다시 열 때 `open_graph({projectPath,graphId})`를 호출한다.
   열린 그래프를 갱신할 때는 publish만 호출한다.
   다른 그래프를 함께 표시하려면 다른 graphId로 저장하고 각각 open_graph를 호출한다.
   기존 뷰어는 각자의 그래프에 계속 연결되며, 같은 그래프를 여러 번 열면 선택과 보기 상태를 공유한다.

채팅은 호스트가 결정한다.
채팅 ID를 도구 인자로 복사하거나 활성 창에서 추정하지 않는다.

## 결과 확인

committed:true는 저장 완료, requested:true는 탭 열기 요청이다.
graph_status({projectPath,graphId}).lastReport는 해당 그래프의 UI가 마지막으로 적용했다고 보고한 버전이다.
실제 화면 확인이 필요하면 그래프 탭의 노드 렌더링을 확인한다.
선택과 탐색 위치는 자동으로 저장되며, 다시 열 때 복구된다.

도구가 없거나 missing-chat-context가 발생하면 [설치와 연결](references/installation.md)을 확인한다.
