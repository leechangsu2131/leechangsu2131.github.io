# leechangsu2131.github.io
HTTPS://leechangsu2131.github.io
https://school-api-alpha-gules.vercel.app/
https://homepage-53dd99.gitlab.io/

초등학교 3학년 담임교사가 수업과 업무에 쓰려고 만든 개인 홈페이지입니다. 위 세 주소로 같은 사이트를 열 수 있습니다.

> 페이지별 상세 명세·현재 상태·개선 방향은 **[AGENTS.MD](AGENTS.MD)** 에 정리되어 있습니다. 이 문서는 전체 지도만 보여 줍니다.

## 구조

- **정적 사이트**: 순수 HTML / CSS / JS, 페이지마다 파일 하나(빌드 도구 없음). 허브는 `index.html`, 교육 도구 모음은 `education.html`.
- **백엔드(Supabase)**: 학생 기록·설정이 필요한 페이지만 하나의 공용 Supabase 프로젝트를 씁니다. 화면에는 공개용(publishable) 키만 넣고, 서비스 키와 AI 키는 Edge Function 비밀값에만 둡니다.
- **서버리스 API(Vercel)**: `api/*.js` 는 학교정보(시간표·급식·학사일정) 조회용입니다.

## 주요 페이지

| 영역 | 페이지 |
|---|---|
| 교육 허브 | `education.html` (교육 도구 목록) |
| 수업 연습 | `multiply.html`, `DEVIDE.HTML`, `fraction*.html`, `onedraw.html` 등 |
| 분수 놀이 | `분수_놀이터.html`(허브)와 `분수_*.html` 놀이 앱 9개 — 가게놀이·징검다리·모둠릴레이·대결·빙고대결·수직선사냥·짝맞추기·손가락축구·순위표 |
| 업무 도구 | `Pdf-splitter.html`, `운동장천막배치.html`, `쿠폰생성.html`, `castle-class.html` (index.html 의 "업무" 칸) |
| 평가 | `tests/index.html` (단원평가), `tests/notebook_*.html` (오답노트) |
| 성장 발표 | `growth/index.html` — 학생 글쓰기 + AI 선생님 질문 피드백 |
| 교실 연결 | `school-tool/index.html` — 학생 접속 현황·공지·선생님↔학생 메시지 |
| 교사 관리 | `classroom/teacher.html` — 수업 화면 모니터링, 단원평가 공개 설정, 그림책 코치 설정, 교실 연결 |
| 수업 활동 | `classroom/activity/` — 수업방에서 주관식·객관식·영상 활동 띄우기, 수업 흐름 저장/불러오기, 큰 화면, CSV (교사 화면 "📋 수업 활동" 칸, 설명은 `classroom/README.md` 6번) |
| 학교정보 | `school.html` (시간표·급식·학사일정) |
| 게임·사회 | `games/`, `yut/`, `oldlife.html` |
| 투자·기타 | `dcf*.html`, `investment-dashboard.html`, `exercise.html`, `Pdf-splitter.html` 등 |

## 학생 입장 방식

- **구글 로그인(기본):** 학교 계정(`262a160`~`262a178@sc.gyo6.net` = 1~19번, 4번 제외)은 교사가 미리 등록해 두어 처음 로그인할 때 자동 연결됩니다. 본인 휴대폰 구글 계정은 번호를 적고 이메일 수집에 동의해 신청 → 교사가 승인하면 같은 번호로 연결됩니다. 로그인은 `school-tool/index.html` 한 곳이고, 성장 발표(`growth/`)와 교육 도구 모음(`education.html`)이 같은 로그인(`sessionStorage st_s`)을 씁니다.
- **번호 + 이름(보조):** 명단(`gt_students`)과 일치해야 합니다. 서버 설정 `ST_ALLOW_NAME_LOGIN=0` 으로 끌 수 있습니다.
- **교사 계정:** 교사 계정(구글)으로 학생 로그인 화면에 들어가면 번호 신청 없이 `education.html`(또는 가려던 페이지)로 들어갑니다. 서버가 `app_metadata.role='teacher'` 로 알아봅니다(2026-11-17, `ISSUE_LOG.md` I-10). 성장 발표는 아직 학생 전용입니다.
- **게스트:** `education.html` 에서 로그인 없이 둘러보면 일부 도구(🔒)가 잠깁니다. 이 잠금은 화면 안내일 뿐이고 진짜 보호는 서버/교사 로그인입니다(`access.js`).
- **교사:** 교사 계정(이메일·비밀번호). 교사 메뉴는 첫 화면 `index.html` 에만 있습니다.
- **교실 연결 기능:** 로그인한 학생 화면 오른쪽 아래 🙋 버튼(도움 신호), `school.html` 「이야기방」(반 친구들과 대화, 교사 관리), 교사가 수업을 시작하면 로그인한 학생이 자동으로 수업 화면 공유에 들어옴.
- 학생 화면 오른쪽 아래 🙋 메뉴에서 선생님 메시지 확인·친구 이야기방 이동·내 접속 숨기기를 할 수 있고, `school.html` 「이야기방」에서 전체방·1:1(선생님이 볼 수 있음)·접속 중인 친구를 볼 수 있습니다.
- 개인정보 처리방침: `privacy.html`

## 서버 함수와 비밀값 (Supabase Edge Functions)

| 함수 | 용도 |
|---|---|
| `growth-tutor` | 성장 발표 AI 피드백(Gemini 우선, 실패 시 Groq) |
| `school-tool` | 교실 연결(접속 현황·메시지). 소스: `school-tool/function.ts` |
| `unit-test-tutor` | 오답노트(분수 기본4) AI 튜터 대화. 소스: `tests/tutor-function.ts` |

- 두 함수는 `GT_ALLOW_ORIGIN` 비밀값에 적힌 주소에서 온 요청만 받습니다. **학생이 접속하는 주소를 모두 쉼표로 넣어야 합니다.** 예: `https://school-api-alpha-gules.vercel.app,https://leechangsu2131.github.io,https://homepage-53dd99.gitlab.io`
- AI 키(`GEMINI_API_KEY`, `GROQ_API_KEY`)와 모델 이름은 같은 곳의 비밀값입니다. 저장소에 올리지 않습니다.
- 공용 DB 테이블은 기능별 접두어를 씁니다(`gt_*` 성장 발표, `st_*` 교실 연결, `unit_test_*` 단원평가). 다른 앱의 테이블을 건드리지 않습니다.

## 배포

- GitHub `main` 에 올리면 GitHub Pages 와 Vercel 이 자동 배포합니다.
- GitLab 주소는 저장소의 `Upload_to_GitLab.bat` 로 따로 올리는 방식입니다. GitHub 에만 올리면 GitLab 쪽에는 반영되지 않을 수 있으니 확인해 주세요.

## 작업할 때 지킬 점

- 학생 이름·번호·글은 외부 AI 서비스에 보내지 않거나, 보내기 전에 전화번호·이메일을 가립니다.
- 새 페이지를 만들면 `AGENTS.MD` 의 목차와 해당 영역에 한 줄씩 추가합니다.


> 방과후 페이지(school.html)는 지금 3학년 2반 전용입니다. 다른 반 허용: school.html의 `//LOCK_CLASS=null;` 앞 `//` 삭제.

> 이야기방에 🎈 모이자 탭(같이 모이자: 같이 놀자/같이 공부하자)이 있습니다. 장소는 학교·동네 공공장소만 고를 수 있고, 선생님 화면에서 관리합니다.
> 이야기방에 🔁 바꾸자 탭(물물장터)이 있습니다. 안 쓰는 물건을 사진과 올리고 친구가 바꿀 물건을 제안합니다. 돈 거래는 안 되고 약속은 학교 안에서만 정하며, 선생님 화면(교실 관리)에서 숨기기·한 주 기록 저장·기록 삭제를 합니다.

> 방과후 페이지(school.html)의 🎮 게임 탭에서 친구들이 만든 게임(게임 극장)으로 연결되고, 방과후에는 하루 30분까지 할 수 있습니다(shared/after-budget.js).
