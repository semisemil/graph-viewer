# Graph Viewer

**Codex에서 코드 구조와 조사 과정을 탐색하는 그래프 뷰어.**

모듈의 의존관계, 조사 결과의 근거, 다음 작업으로 이어지는 경로를 그래프로 확인합니다.
Windows Codex Desktop의 그래프 탭에서 사용합니다.

![조사 기록에서 선택한 관찰과 연결 경로를 강조한 그래프](docs/images/investigation.jpg)

## 🧭 왜 필요한가

긴 대화에서 결론을 찾는 것과 그 결론의 근거를 확인하는 것은 다른 일입니다.
어떤 관찰이 수정으로 이어졌는지, 어느 조사 분기를 확인했는지, 변경할 모듈과 무엇이 연결되는지 다시 읽어야 합니다.

Graph Viewer는 이런 관계를 한 화면에 표시합니다.
노드를 선택하면 전체 선행 경로와 후행 경로가 강조되어, 관련 내용을 따라가며 확인할 수 있습니다.

| 작업 | 그래프로 확인할 내용 |
|---|---|
| 장애 조사 | 증상 → 관찰 → 검증 → 수정의 연결 |
| 코드 구조 탐색 | 모듈 간 호출과 의존관계 |
| 설계 검토 | 요구사항, 설계 선택과 근거 |

## ✨ 주요 기능

- **연결 경로 강조:** 선택한 노드와 연결된 전체 경로, 흐름 애니메이션.
- **미니맵:** 전체 구조, 선택한 경로와 현재 보고 있는 영역.
- **검색과 상세 보기:** 긴 제목, 설명과 출처 확인.
- **그래프 갱신:** 열린 탭에서 새 자료 반영.
- **상태 저장:** 프로젝트와 채팅별 그래프, 선택, 확대, 이동과 검색 상태 보관.
- **Mermaid와 JSON:** Mermaid 흐름도 또는 상세 정보를 포함한 그래프 JSON 사용.

## 📦 설치

GitHub marketplace를 등록한 뒤 플러그인을 설치합니다.

```powershell
codex plugin marketplace add OWNER/REPO
codex plugin add graph-viewer@graph-viewer
```

`OWNER/REPO`는 공개 저장소가 정해지면 실제 경로로 교체합니다.
설치한 플러그인이 표시되지 않으면 Codex를 다시 엽니다.
명령의 사용법은 [Codex 공식 설치 안내](https://learn.chatgpt.com/docs/developer-commands#codex-plugin-marketplace)를 참고하세요.

## 🚀 사용법

설치한 스킬에 그래프 생성을 요청합니다.

```text
$graph-viewer:graph-viewer
이 프로젝트의 주요 모듈과 의존관계를 그래프로 보여줘.
```

```text
지금까지 확인한 관찰, 검증 결과와 수정 작업을 그래프로 정리해줘.
각 결론을 뒷받침하는 근거를 연결해줘.
```

```text
examples/request-latency.mmd를 그래프 탭으로 열어줘.
```

이미 열린 그래프에 결과를 추가하거나 상태를 갱신할 수도 있습니다.

### Mermaid 입력

다음과 같은 Mermaid 흐름도를 그래프 뷰어로 볼 수 있습니다.

```mermaid
flowchart LR
    Symptom[응답 지연] --> Observation[캐시 키 불일치]
    Observation -->|검증| Result[중복 조회 확인]
    Result --> Fix[키 생성 수정]
```

`flowchart`와 `graph`의 노드, 연결, 라벨을 읽어 뷰어의 카드와 선으로 표시합니다.
Mermaid의 도형, 스타일과 그룹 테두리는 그대로 재현하지 않습니다.
상세 설명, 상태와 출처가 필요하면 [그래프 JSON 형식](skills/graph-viewer/references/graph-format.md)을 사용합니다.

## 💾 저장 위치

그래프와 보기 상태는 작업 프로젝트의 **`.graph-viewer/`**에 저장합니다.
프로젝트 안에서도 채팅별로 자료를 구분합니다.
플러그인을 교체해도 프로젝트의 자료는 유지됩니다.

이 폴더에는 생성 시 Git 제외 설정이 들어갑니다.
공유할 원본 `.mmd`나 `.json` 파일은 프로젝트의 원하는 위치에 두면 됩니다.

## 🖥️ 지원 범위

- Windows Codex Desktop의 로컬 MCP 플러그인과 별도 그래프 탭.
- 그래프당 최대 1 MiB, 노드 500개, 관계 2,000개.
- 서버 재연결과 그래프 재열기에서 상태 복구 확인.
  Codex 앱 전체 종료 후 복구 검증은 남아 있습니다.

## 🛠️ 개발

개발 소스와 검사는 `dev` 브랜치에서 관리합니다.
`main` 브랜치에는 설치할 플러그인을 저장소 루트에 배치합니다.
소스 수정, 플러그인 빌드와 검사는 [개발 안내](docs/development.md)를 참고하세요.
표시 엔진은 MCP와 분리되어 자체 HTML 화면에서도 사용할 수 있습니다.

- [아키텍처](docs/architecture.md)
- [에이전트용 사용 스킬](skills/graph-viewer/SKILL.md)
- [그래프 JSON 형식](skills/graph-viewer/references/graph-format.md)
