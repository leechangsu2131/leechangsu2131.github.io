-- 수업 활동 모듈(주관식·객관식·영상 보기, 수업 흐름 저장/불러오기, 결과 모아 보기).
-- 먼저 classroom/schema.sql(수업방)을 실행한 뒤, 이 파일 전체를 Supabase SQL Editor 에서 한 번 실행하세요.
-- 새 테이블 3개와 함수 10개만 추가하며 기존 수업방 테이블·함수는 건드리지 않습니다(여러 번 실행해도 안전).
--
-- 구조 요약
--   classroom_flows       교사가 저장해 둔 수업 흐름(단계 목록)
--   classroom_activities  수업 중 학생에게 낸 활동 하나(주관식/객관식/영상)
--   classroom_responses   학생이 낸 답(활동·학생당 1건, 열려 있는 동안 고쳐 낼 수 있음)
-- 모든 테이블은 직접 접근을 막고, 아래 함수(Security Definer)로만 읽고 씁니다.
--   교사 함수(cra_admin_*)  : 로그인한 교사 계정 중 classroom_teachers 허용 이메일만 통과
--   학생 함수(cra_student_*): 수업방 입장 때 받은 학생 번호표(학생 id + 토큰) 확인
-- 객관식 정답(config.answer)은 교사가 '공개'하기 전까지 학생 쪽 함수가 돌려주지 않습니다.

create table if not exists public.classroom_flows (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.classroom_activities (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.classroom_sessions(id) on delete cascade,
  kind text not null check (kind in ('text','choice','video')),
  title text not null default '',
  config jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','closed')),
  reveal boolean not null default false,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists classroom_activities_session_idx on public.classroom_activities(session_id, created_at);

create table if not exists public.classroom_responses (
  id bigint generated always as identity primary key,
  activity_id uuid not null references public.classroom_activities(id) on delete cascade,
  student_id uuid not null references public.classroom_students(id) on delete cascade,
  answer jsonb not null,
  updated_at timestamptz not null default now(),
  unique (activity_id, student_id)
);

alter table public.classroom_flows enable row level security;
alter table public.classroom_activities enable row level security;
alter table public.classroom_responses enable row level security;
revoke all on public.classroom_flows, public.classroom_activities, public.classroom_responses from anon, authenticated;

-- ---------------------------------------------------------------- 교사: 수업 흐름 저장/불러오기
create or replace function public.cra_admin_flows_list()
returns jsonb language plpgsql security definer set search_path = public
as $$
begin
  if not public.classroom_admin_ok('') then raise exception 'unauthorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'title',f.title,'steps',f.steps,'updated_at',f.updated_at) order by f.updated_at desc)
                   from public.classroom_flows f), '[]'::jsonb);
end;
$$;

create or replace function public.cra_admin_flow_save(p_id uuid, p_title text, p_steps jsonb)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if not public.classroom_admin_ok('') then raise exception 'unauthorized'; end if;
  if length(btrim(coalesce(p_title,''))) not between 1 and 60 then raise exception 'bad title'; end if;
  if jsonb_typeof(p_steps) is distinct from 'array' or jsonb_array_length(p_steps) > 40 or length(p_steps::text) > 60000 then
    raise exception 'bad steps';
  end if;
  if p_id is not null and exists (select 1 from public.classroom_flows where id = p_id) then
    update public.classroom_flows set title = btrim(p_title), steps = p_steps, updated_at = now() where id = p_id returning id into v_id;
  else
    insert into public.classroom_flows(title, steps) values (btrim(p_title), p_steps) returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.cra_admin_flow_delete(p_id uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if not public.classroom_admin_ok('') then raise exception 'unauthorized'; end if;
  delete from public.classroom_flows where id = p_id;
  return found;
end;
$$;

-- ---------------------------------------------------------------- 교사: 활동 열기/마감/공개/결과/내보내기
create or replace function public.cra_admin_open(p_room text, p_kind text, p_title text, p_config jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_session uuid; v_cfg jsonb := coalesce(p_config,'{}'::jsonb); v_n int; v_ans jsonb; v_row public.classroom_activities;
begin
  if not public.classroom_admin_ok('') then raise exception 'unauthorized'; end if;
  select id into v_session from public.classroom_sessions where room_code = upper(p_room) and status = 'active';
  if v_session is null then raise exception 'room not found'; end if;
  if p_kind not in ('text','choice','video') then raise exception 'invalid kind'; end if;
  if length(btrim(coalesce(p_title,''))) not between 1 and 300 then raise exception 'bad title'; end if;
  if jsonb_typeof(v_cfg) is distinct from 'object' or length(v_cfg::text) > 6000 then raise exception 'bad config'; end if;

  if p_kind = 'choice' then
    if jsonb_typeof(v_cfg->'choices') is distinct from 'array' then raise exception 'bad choices'; end if;
    v_n := jsonb_array_length(v_cfg->'choices');
    if v_n not between 2 and 6 then raise exception 'bad choices'; end if;
    v_ans := v_cfg->'answer';
    if v_ans is null or jsonb_typeof(v_ans) = 'null' then
      v_cfg := jsonb_build_object('choices', v_cfg->'choices');
    else
      if jsonb_typeof(v_ans) is distinct from 'number' or (v_ans#>>'{}')::numeric not between 0 and v_n - 1
         or (v_ans#>>'{}')::numeric <> floor((v_ans#>>'{}')::numeric) then raise exception 'bad answer'; end if;
      v_cfg := jsonb_build_object('choices', v_cfg->'choices', 'answer', v_ans);
    end if;
  elsif p_kind = 'video' then
    if left(coalesce(v_cfg->>'url',''), 8) <> 'https://' then raise exception 'bad url'; end if;
    v_cfg := jsonb_build_object('url', v_cfg->>'url');
  else
    v_cfg := '{}'::jsonb;
  end if;

  -- 한 번에 하나만 열어 둔다(이전에 열린 활동은 마감)
  update public.classroom_activities set status = 'closed', closed_at = now() where session_id = v_session and status = 'open';
  insert into public.classroom_activities(session_id, kind, title, config)
  values (v_session, p_kind, btrim(p_title), v_cfg) returning * into v_row;
  return jsonb_build_object('id',v_row.id,'kind',v_row.kind,'title',v_row.title,'config',v_row.config,'status',v_row.status,'reveal',v_row.reveal,'created_at',v_row.created_at);
end;
$$;

create or replace function public.cra_admin_close(p_room text, p_activity uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if not public.classroom_admin_ok('') then raise exception 'unauthorized'; end if;
  update public.classroom_activities a set status = 'closed', closed_at = coalesce(a.closed_at, now())
  from public.classroom_sessions s
  where a.id = p_activity and a.session_id = s.id and s.room_code = upper(p_room);
  return found;
end;
$$;

-- 공개하면 마감도 함께 한다(공개 뒤에는 더 낼 수 없음). 공개를 끄면 학생 화면의 정답·결과가 다시 가려진다.
create or replace function public.cra_admin_reveal(p_room text, p_activity uuid, p_reveal boolean)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if not public.classroom_admin_ok('') then raise exception 'unauthorized'; end if;
  update public.classroom_activities a set
    reveal = coalesce(p_reveal, false),
    status = case when coalesce(p_reveal,false) then 'closed' else a.status end,
    closed_at = case when coalesce(p_reveal,false) then coalesce(a.closed_at, now()) else a.closed_at end
  from public.classroom_sessions s
  where a.id = p_activity and a.session_id = s.id and s.room_code = upper(p_room);
  return found;
end;
$$;

-- 한 활동의 응답. p_activity 를 비우면 이 수업방의 가장 최근 활동(6시간 안).
create or replace function public.cra_admin_results(p_room text, p_activity uuid default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_session uuid; a public.classroom_activities; v_resp jsonb; v_joined int;
begin
  if not public.classroom_admin_ok('') then raise exception 'unauthorized'; end if;
  select id into v_session from public.classroom_sessions where room_code = upper(p_room) and status = 'active';
  if v_session is null then raise exception 'room not found'; end if;
  if p_activity is null then
    select * into a from public.classroom_activities where session_id = v_session and created_at > now() - interval '6 hours' order by created_at desc limit 1;
  else
    select * into a from public.classroom_activities where id = p_activity and session_id = v_session;
  end if;
  if not found then return jsonb_build_object('activity', null, 'responses', '[]'::jsonb, 'joined', 0); end if;

  select coalesce(jsonb_agg(jsonb_build_object('student_id',x.sid,'no',x.student_no,'name',x.student_name,'answer',x.answer,'updated_at',x.updated_at)
           order by nullif(regexp_replace(x.student_no,'\D','','g'),'')::int nulls last, x.student_no), '[]'::jsonb)
    into v_resp
  from (
    select distinct on (s.student_no, s.student_name) s.id as sid, s.student_no, s.student_name, r.answer, r.updated_at
    from public.classroom_responses r join public.classroom_students s on s.id = r.student_id
    where r.activity_id = a.id
    order by s.student_no, s.student_name, r.updated_at desc
  ) x;
  select count(*) into v_joined from (select distinct student_no, student_name from public.classroom_students where session_id = v_session and removed_at is null) j;
  return jsonb_build_object(
    'activity', jsonb_build_object('id',a.id,'kind',a.kind,'title',a.title,'config',a.config,'status',a.status,'reveal',a.reveal,'created_at',a.created_at),
    'responses', v_resp, 'joined', v_joined);
end;
$$;

-- 수업 전체 저장용: p_since 이후에 낸 모든 활동과 응답(최대 200개 활동)
create or replace function public.cra_admin_export(p_room text, p_since timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_session uuid;
begin
  if not public.classroom_admin_ok('') then raise exception 'unauthorized'; end if;
  select id into v_session from public.classroom_sessions where room_code = upper(p_room);
  if v_session is null then raise exception 'room not found'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',a.id,'kind',a.kind,'title',a.title,'config',a.config,'status',a.status,'reveal',a.reveal,'created_at',a.created_at,
      'responses', coalesce((
        select jsonb_agg(jsonb_build_object('no',x.student_no,'name',x.student_name,'answer',x.answer,'updated_at',x.updated_at)
                 order by nullif(regexp_replace(x.student_no,'\D','','g'),'')::int nulls last, x.student_no)
        from (
          select distinct on (s.student_no, s.student_name) s.student_no, s.student_name, r.answer, r.updated_at
          from public.classroom_responses r join public.classroom_students s on s.id = r.student_id
          where r.activity_id = a.id
          order by s.student_no, s.student_name, r.updated_at desc
        ) x), '[]'::jsonb)
    ) order by a.created_at)
    from (select * from public.classroom_activities
          where session_id = v_session and created_at >= coalesce(p_since, now() - interval '24 hours')
          order by created_at desc limit 200) a
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- 학생: 지금 활동 보기 / 답 내기
create or replace function public.cra_student_current(p_student uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_session uuid; a public.classroom_activities; v_cfg jsonb; v_my jsonb; v_counts jsonb;
begin
  select s.session_id into v_session
  from public.classroom_students s join public.classroom_sessions c on c.id = s.session_id
  where s.id = p_student and s.removed_at is null and c.status = 'active'
    and s.token_hash = encode(sha256(convert_to(coalesce(p_token,''),'utf8')),'hex');
  if v_session is null then return jsonb_build_object('removed', true); end if;

  select * into a from public.classroom_activities
  where session_id = v_session and created_at > now() - interval '6 hours'
  order by created_at desc limit 1;
  if not found then return jsonb_build_object('activity', null); end if;

  v_cfg := a.config;
  if not a.reveal then v_cfg := v_cfg - 'answer'; end if;   -- 정답은 공개 전에는 학생에게 보내지 않는다
  select r.answer into v_my from public.classroom_responses r where r.activity_id = a.id and r.student_id = p_student;
  if a.reveal and a.kind = 'choice' then
    select coalesce(jsonb_object_agg(t.k, t.c), '{}'::jsonb) into v_counts
    from (select r.answer->>'choice' as k, count(*) as c from public.classroom_responses r where r.activity_id = a.id group by 1) t;
  end if;
  return jsonb_build_object(
    'activity', jsonb_build_object('id',a.id,'kind',a.kind,'title',a.title,'config',v_cfg,'status',a.status,'reveal',a.reveal,'created_at',a.created_at),
    'my', v_my, 'counts', v_counts, 'now', now());
end;
$$;

create or replace function public.cra_student_submit(p_student uuid, p_token text, p_activity uuid, p_answer jsonb)
returns boolean language plpgsql security definer set search_path = public
as $$
declare v_session uuid; v_kind text; v_cfg jsonb; v_n int; v_ans jsonb;
begin
  select s.session_id into v_session
  from public.classroom_students s join public.classroom_sessions c on c.id = s.session_id
  where s.id = p_student and s.removed_at is null and c.status = 'active'
    and s.token_hash = encode(sha256(convert_to(coalesce(p_token,''),'utf8')),'hex');
  if v_session is null then raise exception 'unauthorized'; end if;

  select a.kind, a.config into v_kind, v_cfg from public.classroom_activities a
  where a.id = p_activity and a.session_id = v_session and a.status = 'open';
  if v_kind is null then raise exception 'closed'; end if;

  if v_kind = 'text' then
    if coalesce(jsonb_typeof(p_answer->'text'),'') <> 'string' or length(btrim(p_answer->>'text')) not between 1 and 1000 then
      raise exception 'bad answer';
    end if;
    v_ans := jsonb_build_object('text', btrim(p_answer->>'text'));
  elsif v_kind = 'choice' then
    v_n := jsonb_array_length(v_cfg->'choices');
    if coalesce(jsonb_typeof(p_answer->'choice'),'') <> 'number'
       or (p_answer->>'choice')::numeric not between 0 and v_n - 1
       or (p_answer->>'choice')::numeric <> floor((p_answer->>'choice')::numeric) then
      raise exception 'bad answer';
    end if;
    v_ans := jsonb_build_object('choice', (p_answer->>'choice')::int);
  else
    raise exception 'no answer needed';
  end if;

  insert into public.classroom_responses(activity_id, student_id, answer) values (p_activity, p_student, v_ans)
  on conflict (activity_id, student_id) do update set answer = excluded.answer, updated_at = now();
  return true;
end;
$$;

-- ---------------------------------------------------------------- 권한
revoke all on function public.cra_admin_flows_list() from public, anon, authenticated;
revoke all on function public.cra_admin_flow_save(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.cra_admin_flow_delete(uuid) from public, anon, authenticated;
revoke all on function public.cra_admin_open(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.cra_admin_close(text, uuid) from public, anon, authenticated;
revoke all on function public.cra_admin_reveal(text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.cra_admin_results(text, uuid) from public, anon, authenticated;
revoke all on function public.cra_admin_export(text, timestamptz) from public, anon, authenticated;
revoke all on function public.cra_student_current(uuid, text) from public, anon, authenticated;
revoke all on function public.cra_student_submit(uuid, text, uuid, jsonb) from public, anon, authenticated;

grant execute on function public.cra_admin_flows_list() to authenticated;
grant execute on function public.cra_admin_flow_save(uuid, text, jsonb) to authenticated;
grant execute on function public.cra_admin_flow_delete(uuid) to authenticated;
grant execute on function public.cra_admin_open(text, text, text, jsonb) to authenticated;
grant execute on function public.cra_admin_close(text, uuid) to authenticated;
grant execute on function public.cra_admin_reveal(text, uuid, boolean) to authenticated;
grant execute on function public.cra_admin_results(text, uuid) to authenticated;
grant execute on function public.cra_admin_export(text, timestamptz) to authenticated;
grant execute on function public.cra_student_current(uuid, text) to anon, authenticated;
grant execute on function public.cra_student_submit(uuid, text, uuid, jsonb) to anon, authenticated;
