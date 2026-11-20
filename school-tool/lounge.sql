-- 🏫 라운지 위치 표(적용됨, 2026-11-20). 학생당 1행, 위치(x,y)만 저장. 15초 넘게 신호가 없으면 화면에서 사라진다.
-- RLS 켬, anon·authenticated 직접 접근 없음(교사 읽기 정책만). 학생은 school-tool 함수(lounge_sync)로만.
create table if not exists public.st_lounge (
  student_id uuid primary key references public.gt_students(id) on delete cascade,
  class_id uuid not null,
  x int not null check (x between 0 and 1000),
  y int not null check (y between 0 and 1000),
  updated_at timestamptz not null default now()
);
create index if not exists st_lounge_class_idx on public.st_lounge (class_id, updated_at desc);
alter table public.st_lounge enable row level security;
revoke all on public.st_lounge from anon, authenticated;
grant select on public.st_lounge to authenticated;
drop policy if exists st_lounge_teacher on public.st_lounge;
create policy st_lounge_teacher on public.st_lounge for select to authenticated using (public.gt_is_teacher());
