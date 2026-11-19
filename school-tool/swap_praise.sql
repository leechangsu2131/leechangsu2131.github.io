-- 바꾸자(물물장터) 뒤 매너온도 칭찬(적용됨, 2026-11-19)
-- st_swap_praise(item_id, from_id, to_id, tag thanks|fun|kind|rule|lead) unique(item_id,from_id,to_id)
-- item_id 에는 외래키를 걸지 않는다: 교사가 주 1회 기록을 지워도 받은 칭찬(온도)은 남는다.
-- RLS 켬, anon·authenticated 직접 접근 없음(교사 읽기 정책만). 학생은 swap-market 함수(praise/temp/list)로만.
create table if not exists public.st_swap_praise (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  from_id uuid not null references public.gt_students(id) on delete cascade,
  to_id uuid not null references public.gt_students(id) on delete cascade,
  tag text not null check (tag in ('thanks','fun','kind','rule','lead')),
  created_at timestamptz not null default now(),
  unique (item_id, from_id, to_id),
  check (from_id <> to_id)
);
create index if not exists st_swap_praise_to_idx on public.st_swap_praise(to_id);
alter table public.st_swap_praise enable row level security;
revoke all on public.st_swap_praise from anon, authenticated;
drop policy if exists st_swap_praise_teacher on public.st_swap_praise;
create policy st_swap_praise_teacher on public.st_swap_praise for select to authenticated using (public.gt_is_teacher());
