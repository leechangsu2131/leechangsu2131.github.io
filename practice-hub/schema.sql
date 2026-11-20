-- 덕목 실천 카드 (적용됨, 2026-11-20). 서버 함수 practice-hub 로만 쓴다. RLS 켬, anon·authenticated 직접 접근 없음(교사 읽기 정책만).
-- st_virtue_week: 교사가 고른 주(월요일 날짜)별 덕목. 없으면 함수가 순서대로 자동으로 정한다.
-- st_practice: 학생 실천 카드. 학생·덕목·날짜당 한 장(unique). status = pending(확인 기다림) / ok(교사 확인) / redo(다시 써 보기).
create table if not exists public.st_virtue_week (
  week_start date primary key,
  virtue text not null check (char_length(virtue) <= 20),
  set_at timestamptz not null default now()
);
create table if not exists public.st_practice (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.gt_students(id) on delete cascade,
  virtue text not null check (char_length(virtue) <= 20),
  day date not null default ((now() at time zone 'Asia/Seoul')::date),
  choice text not null default '' check (char_length(choice) <= 40),
  note text not null default '' check (char_length(note) <= 100),
  status text not null default 'pending' check (status in ('pending', 'ok', 'redo')),
  created_at timestamptz not null default now(),
  unique (student_id, virtue, day)
);
create index if not exists st_practice_day_idx on public.st_practice(day, status);
alter table public.st_virtue_week enable row level security;
alter table public.st_practice enable row level security;
revoke all on public.st_virtue_week from anon, authenticated;
revoke all on public.st_practice from anon, authenticated;
create policy st_virtue_week_teacher on public.st_virtue_week for select to authenticated using (public.gt_is_teacher());
create policy st_practice_teacher on public.st_practice for select to authenticated using (public.gt_is_teacher());

-- 우리 반 함께 모으기(2026-11-21 적용): 주마다 교사가 정하는 학급 목표(장 수)와 보상 글(40자). 없으면 목표 20장·보상 없음.
alter table public.st_virtue_week
  add column if not exists goal int not null default 20 check (goal between 1 and 500),
  add column if not exists reward text not null default '' check (char_length(reward) <= 40);
