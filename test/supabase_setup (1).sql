-- 이미 teacherlesson-table 프로젝트에 적용됨(마이그레이션 unit_test_submissions). 새 프로젝트에 다시 만들 때만 실행.
-- 학생(익명 키)=제출만 가능, 교사=unit_test_teachers 허용 목록에 있는 로그인 계정만 열람/채점.
create table public.unit_test_submissions (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  test_id                text   not null,
  class_label            text   not null default '',
  student_no             int    not null check (student_no between 1 and 60),
  student_name           text   not null check (char_length(student_name) between 1 and 20),
  answers                jsonb  not null,
  meta                   jsonb  not null default '{}',
  manual_scores          jsonb  not null default '{}',
  class_manage_synced_at timestamptz
);
create index unit_test_submissions_test_idx on public.unit_test_submissions (test_id, student_no);

create table public.unit_test_teachers (email text primary key);

alter table public.unit_test_submissions enable row level security;
alter table public.unit_test_teachers enable row level security;

create or replace function public.is_unit_test_teacher()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.unit_test_teachers t where lower(t.email) = lower(coalesce(auth.jwt() ->> 'email', ''))); $$;
revoke all on function public.is_unit_test_teacher() from public, anon;
grant execute on function public.is_unit_test_teacher() to authenticated;

revoke all on public.unit_test_submissions from anon, authenticated;
revoke all on public.unit_test_teachers from anon, authenticated;
grant insert on public.unit_test_submissions to anon;
grant select, update on public.unit_test_submissions to authenticated;

create policy "student insert" on public.unit_test_submissions for insert to anon
  with check (manual_scores = '{}'::jsonb and class_manage_synced_at is null and pg_column_size(answers) < 20000);
create policy "teacher read" on public.unit_test_submissions for select to authenticated using (public.is_unit_test_teacher());
create policy "teacher update" on public.unit_test_submissions for update to authenticated
  using (public.is_unit_test_teacher()) with check (public.is_unit_test_teacher());

-- 교사 등록(본인 이메일로 한 번): Authentication > Users 에서 같은 이메일로 계정을 만든 뒤
-- insert into public.unit_test_teachers (email) values ('선생님 이메일');

-- ===== 문항별 분석 구조 (마이그레이션 unit_test_items_and_results, 적용 완료) =====
-- 채점·기록은 별도 프로그램(서비스 키 또는 Supabase 연결 도구)이 처리하므로 두 테이블에는 정책을 만들지 않는다(익명·로그인 사용자 접근 불가).
create table public.unit_test_items (
  test_id text not null, no int not null, type text not null,
  topic text, page text, level text, points int not null,
  answer jsonb, grading jsonb not null default '{}',
  primary key (test_id, no)
);
create table public.unit_test_item_results (
  submission_id uuid not null references public.unit_test_submissions(id) on delete cascade,
  test_id text not null, student_no int not null, student_name text not null,
  no int not null, topic text, points int not null, score numeric,
  verdict text not null default '미채점' check (verdict in ('정답','부분','오답','미응답','미채점')),
  note text, graded_at timestamptz not null default now(), graded_by text,
  primary key (submission_id, no)
);
create index unit_test_item_results_test_idx on public.unit_test_item_results (test_id, no);
create index unit_test_item_results_student_idx on public.unit_test_item_results (test_id, student_no);
alter table public.unit_test_items enable row level security;
alter table public.unit_test_item_results enable row level security;
revoke all on public.unit_test_items from anon, authenticated;
revoke all on public.unit_test_item_results from anon, authenticated;
-- 문항 기준표 입력: python3 build.py 가 만드는 dist/unit_test_items.sql 을 실행한다.
-- (더 이상 쓰지 않는 교사 허용목록 unit_test_teachers / is_unit_test_teacher() / teacher read·update 정책은 정리 대기 중)
