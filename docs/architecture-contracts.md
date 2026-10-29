# 명령과 데이터 계약

공통 엔진과 기존 HTTP/CLI 연결의 호출 계약이다.
HTTP 서버와 CLI는 dev 브랜치에서 제공한다.
main 브랜치는 MCP 플러그인을 배포하며, HTTP 서버와 CLI를 포함하지 않는다.
MCP 실행 구조는 [아키텍처](architecture.md)를 참고한다.
그래프 필드의 정의와 예제는 [그래프 JSON 형식](../skills/graph-viewer/references/graph-format.md)에 있다.

## 1. 엔진 API

```javascript
const view = GraphPanel.mount(container, {
  graph,
  compact: true,
  state: {selectedNodeId: null, camera: null, query: '', layout: 'layered', direction: 'vertical'},
  onAction(action) {},
  onInteraction(active) {}
});
view.update(nextGraph, nextState);
view.setHostTheme('light');
view.getState();
await view.exportImage();
view.destroy();
```

camera는 {x,y,zoom}이다.
x와 y는 그래프 좌표에서 화면 중심이며 단위는 CSS px다.
zoom 1은 100%다.
처음 카메라가 null이면 화면에 맞추되, 배율은 75% 이상으로 시작한다.
전체를 표시하기에 화면이 작으면 선택한 노드 또는 시작 노드 주변을 보여준다.
‘전체 맞춤’은 배율 제한 없이 그래프 전체를 표시하고, 배율 숫자를 누르면 현재 중심에서 100%로 전환한다.
같은 그래프의 update에서 state를 생략하면 선택, 카메라와 검색을 유지한다.
layout은 layered, tree, radial 또는 network다.
direction은 horizontal 또는 vertical이며, 계층형과 트리형에 적용한다.
compact는 카드 크기를 정하고, 명시한 direction과 별도로 동작한다.
설정이 없으면 계층형을 사용하며, 기본 방향은 compact 화면에서 세로, 큰 화면에서 가로다.
배치 변경은 선택과 검색을 유지하고 전체 구조에 맞춰 카메라를 조정한다.
외부 갱신은 onAction을 발생시키지 않는다.
destroy는 자신이 만든 요소, 감시자와 이벤트만 제거한다.
제거한 그래프의 노드, 연결과 옵션 참조도 해제한다.

확대 비율이 20% 미만이면 노드 카드의 글자, 연결 이름, 연결점과 흐름 애니메이션을 생략한다.
확대하면 다시 표시하며, 축소 상태에서도 노드 선택과 검색은 유지한다.
선택 경로의 흐름 애니메이션은 본문 그래프에서 재생한다.
선택 경로는 굵고 선명한 선으로 표시하고, 관련 없는 선은 흐린 회색으로 표시한다.
흐르는 빛은 두 테마 모두 옅은 하늘색으로 표시하며, 애니메이션이 꺼져도 정적 강조는 유지한다.
화면 밖 경로는 정적 강조를 유지하며, 화면 안에 들어오면 애니메이션을 재생한다.
미니맵은 선택 노드와 연결 경로를 정적으로 표시하며, 선택 경로와 관련 없는 선도 색과 굵기로 구분한다.
단계를 건너뛰는 연결은 카드 바깥 통로로 우회하며, 순환과 자기 연결도 카드 내부를 지나지 않는다.
본문과 미니맵은 같은 연결 경로를 사용한다.
그룹은 제목과 테두리로 표시하며, 중첩 그룹과 직접 포함한 노드를 안에 배치한다.
그룹 자체를 가리키는 연결은 그룹 테두리에 연결하고, 노드를 선택하면 관련 그룹과 경로를 본문과 미니맵에서 강조한다.

테마는 화면 상단에서 자동, 라이트 또는 다크를 선택한다.
자동은 mount의 hostTheme 또는 setHostTheme으로 전달한 앱 테마를 따르며, 앱 테마가 없으면 운영체제 설정을 따른다.
선택한 테마는 브라우저 저장소를 사용할 수 있을 때 같은 출처의 다음 화면에도 적용한다.
onThemeChange(theme)는 적용된 light 또는 dark 값을 전달한다.
테마 변경은 그래프의 선택, 카메라와 검색 상태를 바꾸지 않는다.

| 사용자 명령 | 값 | 변경 범위 |
|---|---|---|
| selectNode | nodeId 또는 null | 그래프 공통 선택 |
| setCamera | camera | 해당 뷰의 중심과 배율 |
| setQuery | query | 해당 뷰의 검색어 |
| setLayout | layout, direction, 선택적 camera | 해당 뷰의 배치와 카메라 |

onInteraction은 카메라 조작 시작과 종료를 알린다.
드래그 종료와 애니메이션 완료 때 완성된 카메라만 전달한다.

exportImage는 전체 그래프의 PNG Blob과 파일명을 {blob,filename}으로 반환한다.
현재 배치, 테마, 선택 강조와 검색에 따른 흐림을 포함한다.
화면의 확대 비율과 중심은 이미지 범위를 바꾸지 않으며, 이미지 생성도 보기 상태를 바꾸지 않는다.
도구 모음, 미니맵, 툴팁과 흐름 애니메이션은 이미지에 포함하지 않는다.
기본 배율은 2배이며, 한 변 16,384 px와 총 33,554,432 픽셀 한도에 맞춰 축소한다.
이미지 저장 버튼은 PNG를 만든 뒤 onExport({blob,filename}) 옵션을 호출한다.
onExport가 없으면 브라우저 다운로드를 사용한다.
MCP UI는 [ui/download-file](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx#requests-view--host)로 앱에 파일 저장을 요청한다.
비어 있거나 제거한 뷰에서는 exportImage가 오류를 반환한다.

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
{schemaVersion:1,chatRef,activeGraphId,graphs:[{graph,revision,state,stateRevision}],nativeViews:[{graphId,sessionId,lastReport?}]}
```

```json
{
  "selectedNodeId": null,
  "views": {
    "summary": {"camera": null, "query": "", "layout": "layered", "direction": "vertical"},
    "large": {"camera": null, "query": "", "layout": "layered", "direction": "horizontal"}
  }
}
```

같은 채팅의 읽기와 변경은 하나의 큐에서 처리한다.
nativeViews는 MCP의 그래프별 연결이며, 같은 그래프를 다시 열 때 연결 토큰을 재사용한다.
이전 저장 자료에 배치 설정이 없으면 기본값을 적용한다.
그래프 등록은 expectedRevision이 현재 revision과 같을 때만 진행하고 버전을 1 증가시킨다.
선택과 뷰별 상태 변경은 필요한 필드만 수정하고 stateRevision을 증가시킨다.
오래된 graph revision의 상태 쓰기는 거부한다.
임시 파일을 flush하고 정상 파일을 교체한 뒤 committed를 반환한다.
정상 파일을 읽지 못하면 백업을 검증하고 복구한 백업을 손상 원본으로 덮지 않는다.

HTTP 뷰마다 clientId로 세션을 연다.
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
