-- 그림책 제작 코치 (프로젝트 teacherlesson-table, Supabase SQL Editor에서 실행)
-- 여러 번 실행해도 안전합니다. 교사 인증은 classroom/schema.sql의 classroom_admin_ok를 사용합니다.
--   설정: 차시별 코치 사용 방식, Gem 링크, 안내 문구 (학생은 읽기만, 교사만 변경)
--   막힘 기록: 이름 없이 차시·칸·종류만 저장 (학생은 추가만, 교사만 조회·삭제)

create table if not exists public.picture_book_coach_config (
  id integer primary key default 1 check (id = 1),
  cfg jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.picture_book_coach_config(id) values (1) on conflict (id) do nothing;

create table if not exists public.picture_book_coach_log (
  id bigserial primary key,
  session_no integer not null check (session_no between 1 and 12),
  part_no integer not null check (part_no between -1 and 20),
  kind text not null check (kind in ('hint','example','coach','hand')),
  created_at timestamptz not null default now()
);

alter table public.picture_book_coach_config enable row level security;
alter table public.picture_book_coach_log enable row level security;
revoke all on public.picture_book_coach_config from public, anon, authenticated;
revoke all on public.picture_book_coach_log from public, anon, authenticated;

create or replace function public.picture_book_coach_get()
returns jsonb language sql stable security definer set search_path = public
as $$ select coalesce((select cfg from public.picture_book_coach_config where id = 1), '{}'::jsonb); $$;

create or replace function public.picture_book_coach_set(p_cfg jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare g text; n text; m jsonb; k text; v text; clean jsonb := '{}'::jsonb; modes jsonb := '{}'::jsonb;
begin
  if not public.classroom_admin_ok('') then raise exception 'unauthorized'; end if;
  g := coalesce(p_cfg->>'gem', '');
  if g <> '' and g !~ '^https://gemini\.google\.com/' then raise exception 'invalid gem url'; end if;
  n := left(coalesce(p_cfg->>'note', ''), 120);
  m := coalesce(p_cfg->'modes', '{}'::jsonb);
  for k, v in select key, value #>> '{}' from jsonb_each(m) loop
    if k ~ '^([1-9]|1[0-2])$' and v in ('direct','side','off') then modes := modes || jsonb_build_object(k, v); end if;
  end loop;
  clean := jsonb_build_object('gem', g, 'note', n, 'modes', modes);
  update public.picture_book_coach_config set cfg = clean, updated_at = now() where id = 1;
  return clean;
end;
$$;

create or replace function public.picture_book_coach_log_add(p_session integer, p_part integer, p_kind text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if (select count(*) from public.picture_book_coach_log where created_at > now() - interval '1 minute') > 300 then return; end if;
  insert into public.picture_book_coach_log(session_no, part_no, kind) values (p_session, p_part, p_kind);
end;
$$;

create or replace function public.picture_book_coach_log_summary()
returns jsonb language plpgsql security definer set search_path = public
as $$
begin
  if not public.classroom_admin_ok('') then raise exception 'unauthorized'; end if;
  return coalesce((select jsonb_agg(t) from (
    select session_no as n, part_no as p, kind as k, count(*) as c
    from public.picture_book_coach_log group by 1,2,3 order by 1,2,3) t), '[]'::jsonb);
end;
$$;

create or replace function public.picture_book_coach_log_clear()
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.classroom_admin_ok('') then raise exception 'unauthorized'; end if;
  delete from public.picture_book_coach_log where true;
end;
$$;

revoke all on function public.picture_book_coach_get() from public, anon, authenticated;
revoke all on function public.picture_book_coach_set(jsonb) from public, anon, authenticated;
revoke all on function public.picture_book_coach_log_add(integer,integer,text) from public, anon, authenticated;
revoke all on function public.picture_book_coach_log_summary() from public, anon, authenticated;
revoke all on function public.picture_book_coach_log_clear() from public, anon, authenticated;
grant execute on function public.picture_book_coach_get() to anon, authenticated;
grant execute on function public.picture_book_coach_log_add(integer,integer,text) to anon, authenticated;
grant execute on function public.picture_book_coach_set(jsonb) to authenticated;
grant execute on function public.picture_book_coach_log_summary() to authenticated;
grant execute on function public.picture_book_coach_log_clear() to authenticated;
