# 명령과 데이터 계약

공통 엔진과 기존 HTTP/CLI 연결의 호출 계약이다.
MCP 실행 구조는 [아키텍처](architecture.md)를 참고한다.
그래프 필드의 정의와 예제는 [그래프 JSON 형식](../skills/graph-viewer/references/graph-format.md)에 있다.

## 1. 엔진 API

```javascript
const view = GraphPanel.mount(container, {
  graph,
  compact: true,
  state: {selectedNodeId: null, camera: null, query: ''},
  onAction(action) {},
  onInteraction(active) {}
});
view.update(nextGraph, nextState);
view.getState();
view.destroy();
```

camera는 {x,y,zoom}이다.
x와 y는 그래프 좌표에서 화면 중심이며 단위는 CSS px다.
zoom 1은 100%다.
처음 카메라가 null이면 화면에 맞춘다.
같은 그래프의 update에서 state를 생략하면 선택, 카메라와 검색을 유지한다.
외부 갱신은 onAction을 발생시키지 않는다.
destroy는 자신이 만든 요소, 감시자와 이벤트만 제거한다.

| 사용자 명령 | 값 | 변경 범위 |
|---|---|---|
| selectNode | nodeId 또는 null | 그래프 공통 선택 |
| setCamera | camera | 해당 뷰의 중심과 배율 |
| setQuery | query | 해당 뷰의 검색어 |

onInteraction은 카메라 조작 시작과 종료를 알린다.
드래그 종료와 애니메이션 완료 때 완성된 카메라만 전달한다.

## 2. 명령

명령 목록과 옵션은 node bin/graph.mjs --help로 확인한다.
성공은 stdout JSON, 실패는 stderr의 {error:{code,message}}와 0이 아닌 종료 코드다.
serve는 준비되면 {ready:true,port,dataDir}를 출력한다.

| 명령 | 필수 입력 | 성공 결과 |
|---|---|---|
| validate | 그래프 파일 | 검증한 그래프 |
| serve | --data-dir 절대 경로 | 루프백 서비스 시작 |
| publish | 파일, --thread, --expected-revision | committed, graphId, revision, applied |
| status | --thread | 그래프 목록과 snapshot, applied |
| show | --thread, --graph, --view | 독립 HTML 화면 URL |

호출 채팅은 {hostId,threadId}이며 기본 host는 local이다.
CLI 호출자는 요청한 채팅의 ID를 명시한다.
현재 전면 채팅을 발행 대상으로 추정하지 않는다.

## 3. HTTP

서비스는 127.0.0.1:<port>에 바인딩한다.
다른 Host와 외부 Origin은 거부하고 CORS를 제공하지 않는다.
GET /connection에서 서비스 시작마다 새로 발급한 token을 얻는다.
후속 API는 Authorization: Bearer <token>이 필요하다.
페이지는 인증이 만료되면 같은 출처에서 token과 뷰 세션을 다시 얻는다.
큰 화면 URL에는 인증 토큰을 넣지 않는다.

| 경로 | 입력 | 출력 |
|---|---|---|
| POST /api/publish | chatRef, graph, expectedRevision | committed, graphId, revision, applied |
| GET /api/status | hostId, threadId, 선택적 graphId | activeGraphId, graphs, snapshot, applied |
| POST /api/session | chatRef, graphId, view, clientId | sessionId |
| POST /api/close-session | chatRef, graphId, view, sessionId | closed |
| POST /api/state | chatRef, graphId, revision, view, sessionId, action | committed, snapshot |
| POST /api/show | chatRef, graphId, view | graphId, revision, url, applied |
| POST /api/ack | chatRef, graphId, revision, view, sessionId | acknowledged |
| GET /view | hostId, threadId, graphId | 독립 HTML 페이지 |

snapshot은 {graph,revision,state,stateRevision} 또는 null이다.
미등록 채팅의 조회는 200과 빈 목록, null snapshot을 반환한다.
없는 그래프의 표시와 상태 변경은 404다.
입력 오류는 400, 인증 만료는 401, Host/Origin 거부는 403이다.
버전 충돌과 만료된 세션은 409, 본문 크기 초과는 413이다.
손상된 저장 파일과 백업을 모두 읽지 못하면 500과 corrupt-store를 반환한다.

## 4. 저장과 상태

저장 경로는 실행 시 지정한다.
채팅 파일은 chats/<SHA-256(JSON.stringify([hostId,threadId]))>.json이다.
직전 정상 파일은 같은 이름에 .bak를 붙인다.
파일 안의 원래 채팅 키를 읽을 때 대조한다.

```text
{schemaVersion:1,chatRef,activeGraphId,graphs:[{graph,revision,state,stateRevision}]}
```

```json
{
  "selectedNodeId": null,
  "views": {
    "summary": {"camera": null, "query": ""},
    "large": {"camera": null, "query": ""}
  }
}
```

같은 채팅의 읽기와 변경은 하나의 큐에서 처리한다.
그래프 등록은 expectedRevision이 현재 revision과 같을 때만 진행하고 버전을 1 증가시킨다.
선택과 뷰별 상태 변경은 필요한 필드만 수정하고 stateRevision을 증가시킨다.
오래된 graph revision의 상태 쓰기는 거부한다.
임시 파일을 flush하고 정상 파일을 교체한 뒤 committed를 반환한다.
정상 파일을 읽지 못하면 백업을 검증하고 복구한 백업을 손상 원본으로 덮지 않는다.

뷰마다 clientId로 세션을 연다.
같은 clientId의 새 세션은 이전 세션을 무효화한다.
상태 쓰기는 채팅 큐 안에서 sessionId와 채팅/그래프/뷰를 대조한다.
큰 화면은 페이지별 clientId를 사용한다.
조회 루프는 병렬 응답을 적용하지 않는다.
조작 중이거나 미확인 조작이 남아 있으면 같은 graph revision의 조회 상태를 적용하지 않는다.
저장 확인 뒤에는 확인한 stateRevision보다 낮은 응답을 버린다.
새 그래프 버전은 옛 버전의 미확인 조작을 취소한다.

## 5. 화면 적용 확인

HTML 페이지는 /api/ack로 표시한 그래프 버전을 보고한다.
applied에는 해당 버전을 확인한 mountedViews, observedAt과 validForMs=3000을 포함한다.
마지막 확인에서 3초가 지나면 applied에서 제외한다.
이는 마지막 연결 확인 시각의 상태이며 화면 전면 표시나 백그라운드 픽셀 갱신을 보장하지 않는다.
