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
on conflict (id) do nothing;

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

create or replace function public.classroom_admin_ok(p_code text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.student_games_admin a
    where a.id = 1
      and a.code_hash = encode(sha256(convert_to(coalesce(nullif(trim(p_code),''),'1234'), 'utf8')), 'hex')
  );
$$;

create or replace function public.classroom_admin_start(p_code text, p_title text default '오늘 수업')
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_code text; v_id uuid;
begin
  if not public.classroom_admin_ok(p_code) then raise exception 'unauthorized'; end if;
  delete from public.classroom_sessions where created_at < now()-interval '30 days';
  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists(select 1 from public.classroom_sessions where room_code = v_code and status = 'active');
  end loop;
  insert into public.classroom_sessions(room_code,title)
  values(v_code, left(coalesce(nullif(trim(p_title),''),'오늘 수업'),80)) returning id into v_id;
  return jsonb_build_object('id',v_id,'room_code',v_code,'title',p_title,'status','active');
end;
$$;

create or replace function public.classroom_admin_list(p_code text, p_room text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_session uuid; v_students jsonb;
begin
  if not public.classroom_admin_ok(p_code) then raise exception 'unauthorized'; end if;
  select id into v_session from public.classroom_sessions where room_code=upper(p_room) and status='active';
  if v_session is null then raise exception 'room not found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'student_no',s.student_no,'student_name',s.student_name,
    'joined_at',s.joined_at,'last_seen',s.last_seen,
    'online',s.last_seen > now()-interval '12 seconds',
    'tab_active',s.tab_active,'sharing',s.sharing,'current_page',s.current_page,'screenshot',s.screenshot
  ) order by s.student_no), '[]'::jsonb)
  into v_students from public.classroom_students s
  where s.session_id=v_session and s.removed_at is null;
  return jsonb_build_object('room_code',upper(p_room),'students',v_students);
end;
$$;

create or replace function public.classroom_admin_command(
  p_code text, p_room text, p_student uuid, p_kind text, p_payload jsonb default '{}'::jsonb
) returns bigint language plpgsql security definer set search_path = public
as $$
declare v_session uuid; v_command bigint;
begin
  if not public.classroom_admin_ok(p_code) then raise exception 'unauthorized'; end if;
  if p_kind not in ('notice','focus','resume','navigate','remove') then raise exception 'invalid command'; end if;
  select id into v_session from public.classroom_sessions where room_code=upper(p_room) and status='active';
  if v_session is null then raise exception 'room not found'; end if;
  if p_student is not null and not exists(select 1 from public.classroom_students where id=p_student and session_id=v_session and removed_at is null) then raise exception 'student not found'; end if;
  insert into public.classroom_commands(session_id,student_id,kind,payload)
  values(v_session,p_student,p_kind,coalesce(p_payload,'{}'::jsonb)) returning id into v_command;
  if p_kind='remove' and p_student is not null then
    update public.classroom_students set removed_at=now() where id=p_student and session_id=v_session;
  end if;
  return v_command;
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
  where room_code=upper(trim(p_room)) and status='active';
  if v_session is null then raise exception '수업 코드를 확인해 주세요.'; end if;
  if length(coalesce(p_no,'')) not between 1 and 4 or length(trim(coalesce(p_name,''))) not between 1 and 20 then raise exception '번호와 이름을 확인해 주세요.'; end if;
  if length(coalesce(p_token,'')) < 30 then raise exception '잘못된 접속 정보입니다.'; end if;
  insert into public.classroom_students(session_id,student_no,student_name,token_hash)
  values(v_session,left(trim(p_no),4),left(trim(p_name),20),encode(sha256(convert_to(p_token,'utf8')),'hex'))
  returning id into v_student;
  return jsonb_build_object('student_id',v_student,'room_code',upper(trim(p_room)),'title',v_title);
end;
$$;

create or replace function public.classroom_student_update(
  p_student uuid,p_token text,p_page text,p_active boolean,p_sharing boolean,p_screenshot text default null
) returns boolean language plpgsql security definer set search_path = public
as $$
begin
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
declare v_session uuid; v_joined timestamptz; v_items jsonb;
begin
  select s.session_id,s.joined_at into v_session,v_joined
  from public.classroom_students s join public.classroom_sessions c on c.id=s.session_id
  where s.id=p_student and s.removed_at is null and s.token_hash=encode(sha256(convert_to(coalesce(p_token,''),'utf8')),'hex');
  if v_session is null then return jsonb_build_object('removed',true,'commands','[]'::jsonb); end if;
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
grant execute on function public.classroom_admin_start(text,text) to anon,authenticated;
grant execute on function public.classroom_admin_list(text,text) to anon,authenticated;
grant execute on function public.classroom_admin_command(text,text,uuid,text,jsonb) to anon,authenticated;
grant execute on function public.classroom_admin_end(text,text) to anon,authenticated;
grant execute on function public.classroom_student_join(text,text,text,text) to anon,authenticated;
grant execute on function public.classroom_student_update(uuid,text,text,boolean,boolean,text) to anon,authenticated;
grant execute on function public.classroom_student_commands(uuid,text,bigint) to anon,authenticated;
