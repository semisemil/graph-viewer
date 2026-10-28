# 그래프 JSON

```json
{
  "schemaVersion": 1,
  "graphId": "system-map",
  "kind": "architecture",
  "title": "시스템 구조",
  "nodes": [
    {"id": "ui", "type": "모듈", "label": "사용자 화면", "details": "화면을 표시합니다."},
    {"id": "service", "type": "모듈", "label": "서비스", "sources": [{"label": "설계 문서", "href": "docs/design.md"}]}
  ],
  "edges": [
    {"id": "ui-service", "source": "ui", "target": "service", "type": "의존", "label": "호출"}
  ],
  "groups": [
    {"id": "application", "label": "애플리케이션", "nodeIds": ["ui", "service"]}
  ]
}
```

| 필드 | 형식과 의미 |
|---|---|
| schemaVersion | 정수 1 |
| graphId | 채팅 안의 그래프 ID. 최대 200자 |
| title | 표시 제목. 최대 2000자 |
| kind | 선택적 분류 문자열. 최대 200자. 엔진 동작과 독립적 |
| nodes | 노드 배열. 최대 500개 |
| node.id, type, label | 필수 문자열. ID/type 최대 200자, label 최대 2000자 |
| node.details, status | 선택적 설명과 상태. 각각 최대 30000자와 500자 |
| node.sources | 선택적 출처 배열. 최대 30개. label/href는 표시할 텍스트 |
| edges | 관계 배열. 최대 2000개 |
| edge.id, source, target | 필수 문자열. 최대 200자. 양 끝은 존재하는 노드 또는 그룹 ID |
| edge.type, label | 선택적 관계 종류와 이름. 각각 최대 200자와 2000자 |
| edge.direction | 선택적 화살표 방향. forward(기본), both(양방향), none(방향 없음) |
| groups | 선택적 그룹 배열. 최대 500개 |
| group.id, label | 필수 문자열. ID 최대 200자, label 최대 2000자 |
| group.nodeIds | 이 그룹에 직접 속한 노드 ID 배열. 빈 배열 허용 |
| group.parentId | 선택적 부모 그룹 ID. 중첩 테두리 표시 |

ID와 필수 문자열은 비어 있으면 안 된다.
노드 ID와 관계 ID는 각 배열 안에서 고유하다.
그룹 ID는 그룹과 노드 전체에서 고유하다.
각 노드는 한 그룹에 직접 속할 수 있으며, 부모 그룹은 자식 그룹의 영역을 포함한다.
부모 그룹의 순환 참조는 허용하지 않는다.
좌표는 엔진이 계산한다.
빈 그래프, 여러 루트, 순환과 분리 노드도 허용한다.
전체 그래프 JSON은 최대 1 MiB이다.
기존 HTTP 요청의 같은 크기 제한을 사용할 때는 전달용 필드의 공간도 남긴다.
사용자 문자열과 출처는 텍스트로 표시한다.
HTML이나 실행 코드를 넣어 화면을 구성하지 않는다.

자료의 의미는 type, label과 명시적 관계로 표현한다.
도메인별 규칙은 원본 자료를 이 형식으로 변환하는 쪽에서 처리한다.
