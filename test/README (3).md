# 단원평가 HTML (학생 제출 + Supabase 기록 + 문항별 분석 구조)

hwpx 단원평가지 + 정답표 → 학생용 HTML(정답 없음) + 문항 기준표 SQL.
채점과 기록 정리는 별도 프로그램이 Supabase를 읽어서 처리한다. 이 도구는 "시험 보기"와 "답안 저장"을 맡는다.

## 데이터 흐름
1. 학생이 `dist/student_<id>.html`에서 번호·이름 입력 → 풀이 → 제출.
2. 제출하면 백업 파일(.json)이 기기에 저장되고, Supabase `unit_test_submissions`에 답안이 한 행으로 저장된다(익명 키는 입력만 가능).
3. 채점 프로그램이 `unit_test_items`(문항 기준표: 평가 요소·쪽수·난이도·배점·정답·부분점수·서술형 기준)와 `unit_test_submissions`를 읽어 채점한다.
4. 결과를 `unit_test_item_results`에 문항별 한 행으로 쓴다: 득점, 판정(정답/부분/오답/미응답/미채점), 평가 요소.
   서술형과 풀이 과정은 먼저 '미채점'으로 두고 기준(rubric)을 보고 점수를 매긴다.
5. 분석 예: 학생별 평가 요소별 득점률, 반에서 많이 틀린 문항.
   `select topic, avg(score/points) from unit_test_item_results where student_no=7 group by topic;`

## 테이블 (프로젝트 teacherlesson-table)
- `unit_test_submissions`: 학생 원본 답안. 익명 키는 insert만 가능.
- `unit_test_items`: 문항 기준표. 서비스 키나 연결 도구로만 접근(정책 없음, 익명·로그인 사용자 모두 불가).
- `unit_test_item_results`: 문항별 결과. 서비스 키나 연결 도구로만 접근.

## 새 단원 추가
1. 평가지 hwpx와 정답표 hwpx의 본문·그림을 추출한다(`section0.xml`의 `hp:t`, `BinData/`).
2. `tests/<id>.json`을 만든다. 유형: `choice`, `ox`, `short`, `symbol`, `match`, `written`, `work`. 각 문항에 `topic`(평가 요소), `page`, `level`을 정답표에서 옮긴다.
3. 문항 그림은 `assets/`에 두고 문항의 `image`에 파일명을 쓴다.
4. `python3 build.py --review`로 확인용 페이지를 만들어 선생님과 먼저 검증한다.
5. 검증 후 `python3 build.py` → `dist/`에 학생용 HTML과 `unit_test_items.sql`이 만들어진다.
   `unit_test_items.sql`을 Supabase에 실행한다(같은 시험을 다시 실행해도 덮어쓰기라 안전하다).
6. `python3 e2e_check.py`로 가상 학생 제출 흐름을 점검한다.

## 구조
- `tests/*.json` 문항·정답·배점·교과서 쪽수·평가 요소
- `templates/student.html` 학생 화면 틀
- `build.py` 학생용 HTML과 문항 기준표 SQL 생성
- 학생용 HTML에는 정답·채점 기준이 들어가지 않는다(빌드 시 제거).
- 결과: 학생용 HTML을 학생 기기에서 열 수 있게 배포(웹 호스팅·공유 드라이브 등)한다.
