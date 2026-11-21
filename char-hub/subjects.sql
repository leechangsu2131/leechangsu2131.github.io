-- 과목별 레벨·맞춤 도전 (적용됨, 2026-11-22). 서버 함수 char-hub 로만 쓴다. RLS 켬, anon·authenticated 접근 없음(교사 읽기 정책만).
-- st_focus: 학생·주(월요일)당 한 줄. 교사가 정한 이번 주 도전 과목(math/korean)과 목표 점수(10~3000), 한 마디(40자).
-- st_subject_xp(학생, 기준일): 수학 = 분수 학습 앱 경험치(class_board_events), 국어 = 글쓰기 연습 미션 통과 1회 20점(writing_practice_events).
--   번호와 이름이 명단(gt_students)과 같을 때만 같은 학생으로 본다. 반환 {math:{xp,week}, korean:{xp,week}} (week = 기준일 이후 점수).
-- 레벨 곡선(서버 char-hub 코드): 레벨 n 은 누적 50·n·(n-1) 이상, 최대 20레벨. 맞춤 도전을 채우면 경험치 +10(주 1회, st_xp_add kind 'focus').
create table if not exists public.st_focus (
  student_id uuid not null references public.gt_students(id) on delete cascade,
  week_start date not null,
  subject text not null check (subject in ('math', 'korean')),
  target int not null check (target between 10 and 3000),
  note text not null default '' check (char_length(note) <= 40),
  set_at timestamptz not null default now(),
  primary key (student_id, week_start)
);
-- (함수 본문은 Supabase 마이그레이션 st_subject_focus 에 있다. 바꿀 때는 이 파일도 함께 고친다.)
