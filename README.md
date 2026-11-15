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
| 평가 | `tests/index.html` (단원평가), `tests/notebook_*.html` (오답노트) |
| 성장 발표 | `growth/index.html` — 학생 글쓰기 + AI 선생님 질문 피드백 |
| 교실 연결 | `school-tool/index.html` — 학생 접속 현황·공지·선생님↔학생 메시지 |
| 교사 관리 | `classroom/teacher.html` — 수업 화면 모니터링, 단원평가 공개 설정, 그림책 코치 설정, 교실 연결 |
| 학교정보 | `school.html` (시간표·급식·학사일정) |
| 게임·사회 | `games/`, `yut/`, `oldlife.html` |
| 투자·기타 | `dcf*.html`, `investment-dashboard.html`, `exercise.html`, `Pdf-splitter.html` 등 |

## 학생 입장 방식

학생은 계정 없이 **번호 + 이름**으로 들어갑니다. 이름은 교사가 등록한 명단(`gt_students`)과 일치해야 합니다. 교사용 화면은 교사 계정(이메일·비밀번호)으로 로그인합니다. 나중에 필요하면 개인 코드나 구글 로그인 신청·승인 방식을 더할 계획입니다.

## 서버 함수와 비밀값 (Supabase Edge Functions)

| 함수 | 용도 |
|---|---|
| `growth-tutor` | 성장 발표 AI 피드백(Gemini 우선, 실패 시 Groq) |
| `school-tool` | 교실 연결(접속 현황·메시지). 소스: `school-tool/function.ts` |

- 두 함수는 `GT_ALLOW_ORIGIN` 비밀값에 적힌 주소에서 온 요청만 받습니다. **학생이 접속하는 주소를 모두 쉼표로 넣어야 합니다.** 예: `https://school-api-alpha-gules.vercel.app,https://leechangsu2131.github.io,https://homepage-53dd99.gitlab.io`
- AI 키(`GEMINI_API_KEY`, `GROQ_API_KEY`)와 모델 이름은 같은 곳의 비밀값입니다. 저장소에 올리지 않습니다.
- 공용 DB 테이블은 기능별 접두어를 씁니다(`gt_*` 성장 발표, `st_*` 교실 연결, `unit_test_*` 단원평가). 다른 앱의 테이블을 건드리지 않습니다.

## 배포

- GitHub `main` 에 올리면 GitHub Pages 와 Vercel 이 자동 배포합니다.
- GitLab 주소는 저장소의 `Upload_to_GitLab.bat` 로 따로 올리는 방식입니다. GitHub 에만 올리면 GitLab 쪽에는 반영되지 않을 수 있으니 확인해 주세요.

## 작업할 때 지킬 점

- 학생 이름·번호·글은 외부 AI 서비스에 보내지 않거나, 보내기 전에 전화번호·이메일을 가립니다.
- 새 페이지를 만들면 `AGENTS.MD` 의 목차와 해당 영역에 한 줄씩 추가합니다.
