-- Supabase SQL Editor에서 전체를 복사하여 한 번 실행하세요.
-- 교사 인증은 기존 student_games_admin.code_hash를 사용합니다 (테이블이 없으면 기본 비밀번호 1234로 자동 생성됩니다).

create table if not exists public.student_games_admin (
  id integer primary key default 1,
  code_hash text not null default encode(sha256(convert_to('1234', 'utf8')), 'hex'),
  auto_games boolean not null default false,
  auto_feedback boolean not null default false
);
insert into public.student_games_admin (id, code_hash)
values (1, encode(sha256(convert_to('1234', 'utf8')), 'hex'))
on conflict (id) do update set code_hash = excluded.code_hash;

-- 수업 시작 시각(2026-11-17 추가): alter table public.classroom_sessions add column if not exists started_at timestamptz not null default now();
create table if not exists public.classroom_sessions (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  title text not null default '오늘 수업',
  status text not null default 'active' check (status in ('active','ended')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists public.classroom_students (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.classroom_sessions(id) on delete cascade,
  student_no text not null,
  student_name text not null,
  token_hash text not null,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  tab_active boolean not null default true,
  sharing boolean not null default true,
  current_page text not null default '',
  screenshot text,
  removed_at timestamptz
);
alter table public.classroom_students add column if not exists sharing boolean not null default true;
alter table public.classroom_students add column if not exists kicked boolean not null default false;   -- 교사가 내보낸 학생(수업 재시작으로 닫힌 입장과 구별)
create index if not exists classroom_students_session_idx on public.classroom_students(session_id, joined_at);

create table if not exists public.classroom_commands (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.classroom_sessions(id) on delete cascade,
  student_id uuid references public.classroom_students(id) on delete cascade,
  kind text not null check (kind in ('notice','focus','resume','navigate','remove')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists classroom_commands_session_idx on public.classroom_commands(session_id, id);

alter table public.classroom_sessions enable row level security;
alter table public.classroom_students enable row level security;
alter table public.classroom_commands enable row level security;
revoke all on public.classroom_sessions, public.classroom_students, public.classroom_commands from anon, authenticated;
grant usage on schema public to anon, authenticated;

-- [교사 계정 인증]
-- Supabase Auth(이메일/비밀번호)로 로그인한 계정 중, 아래 허용 목록에 있는 이메일만 교사 기능을 쓸 수 있습니다.
-- 허용 이메일은 공개 저장소에 올리지 않도록 SQL Editor에서 직접 추가하세요:
--   insert into public.classroom_teachers(email) values ('교사이메일@example.com');
create table if not exists public.classroom_teachers (
  email text primary key
);
alter table public.classroom_teachers enable row level security;
revoke all on public.classroom_teachers from anon, authenticated;

-- p_code 인자는 기존 호출 형식과의 호환을 위해 남겨 두며, 인증에는 쓰지 않습니다.
create or replace function public.classroom_admin_ok(p_code text)
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce(auth.role(), '') = 'authenticated'
     and exists (
       select 1 from public.classroom_teachers t
       where lower(t.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
     );
$$;

create or replace function public.classroom_admin_start(p_code text, p_title text default '오늘 수업')
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_code text := 'HC302'; v_id uuid; v_status text;
begin
  if not public.classroom_admin_ok(p_code) then raise exception 'unauthorized'; end if;

  -- [단일 고정 수업 코드: HC302 로 항상 통일]
  select id, status into v_id, v_status from public.classroom_sessions where room_code = v_code;
  if v_id is null then
    insert into public.classroom_sessions(room_code, title, status, started_at)
    values(v_code, left(coalesce(nullif(trim(p_title),''),'오늘 수업'),80), 'active', now())
    returning id into v_id;
  elsif v_status = 'active' then
    -- 이미 수업 중인데 다시 '수업방 열기'를 누른 경우(교사 화면을 새로 고친 뒤 등): 들어와 있는 학생을 지우지 않는다
    update public.classroom_sessions
    set title = left(coalesce(nullif(trim(p_title),''),title),80), started_at = now()
    where id = v_id;
  else
    update public.classroom_sessions
    set status = 'active', ended_at = null, started_at = now(), title = left(coalesce(nullif(trim(p_title),''),'오늘 수업'),80)
    where id = v_id;
    -- 끝난 수업을 새로 시작할 때만 이전 학생 목록 정리
    update public.classroom_students set removed_at = now() where session_id = v_id and removed_at is null;
  end if;

  return jsonb_build_object('id',v_id,'room_code',v_code,'title',p_title,'status','active');
end;
$$;

create or replace function public.classroom_admin_end(p_code text, p_room text)
returns boolean language plpgsql security definer set search_path = public
as $$
declare v_session uuid;
begin
  if not public.classroom_admin_ok(p_code) then raise exception 'unauthorized'; end if;
  update public.classroom_sessions set status='ended',ended_at=now()
  where room_code=upper(p_room) and status='active' returning id into v_session;
  if v_session is null then return false; end if;
  insert into public.classroom_commands(session_id,kind,payload)
  values(v_session,'notice',jsonb_build_object('text','수업이 종료되었습니다.'));
  update public.classroom_students set screenshot=null where session_id=v_session;
  return true;
end;
$$;

create or replace function public.classroom_student_join(p_room text,p_no text,p_name text,p_token text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_session uuid; v_student uuid; v_title text;
begin
  select id,title into v_session,v_title from public.classroom_sessions
  where room_code=upper(trim(p_room)) and status='active' and started_at > now() - interval '8 hours';   -- 수업 시작 8시간 뒤에는 자동 입장 불가(방과후 공유 방지)
  if v_session is null then raise exception '수업 코드를 확인해 주세요.'; end if;
  if length(coalesce(p_no,'')) not between 1 and 4 or length(trim(coalesce(p_name,''))) not between 1 and 20 then raise exception '번호와 이름을 확인해 주세요.'; end if;
  if length(coalesce(p_token,'')) < 30 then raise exception '잘못된 접속 정보입니다.'; end if;
  insert into public.classroom_students(session_id,student_no,student_name,token_hash)
  values(v_session,left(trim(p_no),4),left(trim(p_name),20),encode(sha256(convert_to(p_token,'utf8')),'hex'))
  returning id into v_student;
  return jsonb_build_object('student_id',v_student,'room_code',upper(trim(p_room)),'title',v_title);
end;
$$;

-- 시작한 지 8시간이 지난 수업은 종료 처리(들어와 있는 학생도 끊김). 학생 화면이 신호를 보낼 때마다 확인한다.
create or replace function public.classroom_expire_old() returns void language sql security definer set search_path = public
as $$ update public.classroom_sessions set status='ended', ended_at=now() where status='active' and started_at < now() - interval '8 hours'; $$;
revoke all on function public.classroom_expire_old() from public,anon,authenticated;

create or replace function public.classroom_student_update(
  p_student uuid,p_token text,p_page text,p_active boolean,p_sharing boolean,p_screenshot text default null
) returns boolean language plpgsql security definer set search_path = public
as $$
begin
  perform public.classroom_expire_old();
  if p_screenshot is not null and length(p_screenshot)>110000 then raise exception '화면 이미지가 너무 큽니다.'; end if;
  update public.classroom_students s set
    last_seen=now(), tab_active=coalesce(p_active,false), sharing=coalesce(p_sharing,false),
    current_page=left(coalesce(p_page,''),180),
    screenshot=case when not coalesce(p_sharing,false) or p_screenshot='' then null else coalesce(p_screenshot,s.screenshot) end
  from public.classroom_sessions c
  where s.id=p_student and s.session_id=c.id and c.status='active'
    and s.removed_at is null
    and s.token_hash=encode(sha256(convert_to(coalesce(p_token,''),'utf8')),'hex');
  return found;
end;
$$;

create or replace function public.classroom_student_commands(p_student uuid,p_token text,p_after bigint default 0)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_session uuid; v_joined timestamptz; v_items jsonb; v_kicked boolean;
begin
  perform public.classroom_expire_old();
  select s.session_id,s.joined_at into v_session,v_joined
  from public.classroom_students s join public.classroom_sessions c on c.id=s.session_id
  where s.id=p_student and s.removed_at is null and s.token_hash=encode(sha256(convert_to(coalesce(p_token,''),'utf8')),'hex');
  if v_session is null then
    select coalesce(s.kicked,false) into v_kicked from public.classroom_students s
    where s.id=p_student and s.token_hash=encode(sha256(convert_to(coalesce(p_token,''),'utf8')),'hex');
    return jsonb_build_object('removed',true,'kicked',coalesce(v_kicked,false),'commands','[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'kind',x.kind,'payload',x.payload) order by x.id),'[]'::jsonb)
  into v_items from public.classroom_commands x
  where x.session_id=v_session and x.id>coalesce(p_after,0) and x.created_at>=v_joined
    and (x.student_id is null or x.student_id=p_student);
  return jsonb_build_object('removed',false,'ended',not exists(select 1 from public.classroom_sessions where id=v_session and status='active'),'commands',v_items);
end;
$$;

revoke all on function public.classroom_admin_ok(text) from public,anon,authenticated;
revoke all on function public.classroom_admin_start(text,text) from public,anon,authenticated;
revoke all on function public.classroom_admin_list(text,text) from public,anon,authenticated;
revoke all on function public.classroom_admin_command(text,text,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.classroom_admin_end(text,text) from public,anon,authenticated;
revoke all on function public.classroom_student_join(text,text,text,text) from public,anon,authenticated;
revoke all on function public.classroom_student_update(uuid,text,text,boolean,boolean,text) from public,anon,authenticated;
revoke all on function public.classroom_student_commands(uuid,text,bigint) from public,anon,authenticated;
-- 교사 기능은 로그인한 계정(authenticated)에게만 열고, 그중 허용 목록 이메일만 classroom_admin_ok를 통과합니다.
grant execute on function public.classroom_admin_start(text,text) to authenticated;
grant execute on function public.classroom_admin_list(text,text) to authenticated;
grant execute on function public.classroom_admin_command(text,text,uuid,text,jsonb) to authenticated;
grant execute on function public.classroom_admin_end(text,text) to authenticated;
grant execute on function public.classroom_student_join(text,text,text,text) to anon,authenticated;
grant execute on function public.classroom_student_update(uuid,text,text,boolean,boolean,text) to anon,authenticated;
grant execute on function public.classroom_student_commands(uuid,text,bigint) to anon,authenticated;
