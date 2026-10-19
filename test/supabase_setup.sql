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
