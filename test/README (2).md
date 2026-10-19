# 단원평가 HTML 평가 시스템

hwpx 단원평가지 + 정답표 → 학생용 HTML(정답 없음) + 교사용 채점 HTML.

## 사용 순서
1. (완료) Supabase 프로젝트 teacherlesson-table에 `unit_test_submissions` 테이블과 권한을 만들어 두었다. `supabase_setup.sql`은 기록용.
2. 교사 로그인: Authentication > Users에서 교사 계정(이메일/비밀번호)을 만들고, SQL Editor에서 `insert into public.unit_test_teachers (email) values ('교사 이메일');` 을 한 번 실행한다. (등록된 이메일만 답안을 읽을 수 있다. 이 프로젝트에는 다른 앱의 로그인 사용자도 있어서 필요한 장치)
3. `config.json`에 Supabase 주소와 공개(anon) 키가 들어 있다. 바꾸면 `python3 build.py`로 다시 빌드한다.
4. `python3 build.py` → `dist/`에 학생용 3개(`student_*.html`)와 `teacher.html`이 만들어진다.
5. 학생용 HTML을 학생 기기에서 열 수 있게 배포(웹 호스팅·공유 드라이브 등)한다.
6. 학생: 번호·이름 입력 → 풀이 → 제출 시 답안 파일(.json)이 기기에 저장되고 Supabase로도 전송된다.
7. 교사: `teacher.html` → 학생 파일을 끌어다 놓거나 Supabase 로그인 후 불러오기 → 자동 채점, 서술형·풀이 점수 입력, CSV 내보내기.
8. 채점 후 내보내기 탭의 "class-manage에 점수 요약 추가"로 학생별 관찰기록 시트에 점수 요약을 한 줄씩 추가한다(미리보기·중복 방지 포함).

## 새 단원 추가(스킬화 때 반복할 절차)
1. 평가지 hwpx와 정답표 hwpx의 본문·그림을 추출한다. (`section0.xml`의 `hp:t`, `BinData/`)
2. `tests/<id>.json`을 만든다. 문항 유형: `choice`(pick 1/n/0=모두, labelStyle `sym`=㉠㉡), `ox`, `short`(parts, partial), `symbol`, `match`, `written`(scoreSteps), `work`(풀이+답).
3. 문항 그림은 `assets/`에 두고 문항의 `image`에 파일명을 쓴다.
4. `python3 build.py` (배점 합계 100점 검증 포함) → 가상 답안으로 채점이 정답표와 같은지 확인.

## 구조
- `tests/*.json` 문항·정답·배점·교과서 쪽수
- `templates/student.html`, `templates/teacher.html` 화면 틀
- 학생용 HTML에는 정답·채점기준이 들어가지 않는다(빌드 시 제거).

> 학생 제출 + Supabase 기록 + 문항별 분석 구조만 쓰는 가벼운 버전은 `unit-test-light/` 폴더에 있다.
