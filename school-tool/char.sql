-- 학생 캐릭터(조합형) 표(적용됨, 2026-11-20). 학생당 1행, 조합 코드만 저장(그림 파일 없음).
-- RLS 켬, anon·authenticated 직접 접근 없음(교사 읽기 정책만). 학생은 char-hub 함수(get/save/list)로만.
create table if not exists public.st_char (
  student_id uuid primary key references public.gt_students(id) on delete cascade,
  parts jsonb not null,
  hidden boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.st_char enable row level security;
revoke all on public.st_char from anon, authenticated;
drop policy if exists st_char_teacher on public.st_char;
create policy st_char_teacher on public.st_char for select to authenticated using (public.gt_is_teacher());
