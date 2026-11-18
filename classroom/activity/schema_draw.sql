-- 수업 활동 모듈 추가분: 🎨 그림 활동 · 📷 사진 활동(같은 방식으로 줄인 이미지를 DB 에 저장) + 시간 제한 보존 + 작품 7일 자동 삭제.
-- 먼저 schema.sql 을 실행한 뒤 이 파일 전체를 Supabase SQL Editor 에서 한 번 실행하세요(여러 번 실행해도 안전).
--
-- 방침(사용자 결정 2026-11-17): 그림은 수업 중 바로 저장하고 오래 남기지 않는다.
--   · 그림 이미지는 만든 지 7일이 지나면 자동으로 지운다(cra_purge_old).
--   · 교사가 아직 내려받지 않은 그림 활동이 있으면 cra_admin_unsaved 로 알려 준다.
--   · 그림은 학생 브라우저에서 줄인 이미지(JPEG/PNG/WebP, 약 100~250KB)로 DB 에 저장한다(Storage 는 쓰지 않음).

alter table public.classroom_activities drop constraint if exists classroom_activities_kind_check;
alter table public.classroom_activities add constraint classroom_activities_kind_check check (kind in ('text','choice','video','draw','photo'));
alter table public.classroom_activities add column if not exists saved_at timestamptz;
-- 학생 화면이 "활동을 받을 준비가 됐는지"(옛 화면 파일로 도는 학생을 찾기 위함): 학생이 활동을 확인할 때마다 갱신(10초에 한 번만 기록)
alter table public.classroom_students add column if not exists cra_seen timestamptz;

-- ---------------------------------------------------------------- 오래된 그림 지우기
create or replace function public.cra_purge_old()
returns int language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  delete from public.classroom_responses r using public.classroom_activities a
  where r.activity_id = a.id and a.kind in ('draw','photo') and r.updated_at < now() - interval '7 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------- 교사: 활동 열기 (그림 추가, 시간 제한 보존)
create or replace function public.cra_admin_open(p_room text, p_kind text, p_title text, p_config jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_session uuid; v_cfg jsonb := coalesce(p_config,'{}'::jsonb); v_n int; v_ans jsonb; v_row public.classroom_activities; v_sec jsonb := v_cfg->'seconds';
begin
  if not public.classroom_admin_ok('') then raise exception 'unauthorized'; end if;
  select id into v_session from public.classroom_sessions where room_code = upper(p_room) and status = 'active';
  if v_session is null then raise exception 'room not found'; end if;
  if p_kind not in ('text','choice','video','draw','photo') then raise exception 'invalid kind'; end if;
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
  -- 시간 제한(초): 주관식·객관식·그림만, 10~3600 정수
  if p_kind <> 'video' and v_sec is not null and jsonb_typeof(v_sec) = 'number'
     and (v_sec#>>'{}')::numeric between 10 and 3600 and (v_sec#>>'{}')::numeric = floor((v_sec#>>'{}')::numeric) then
    v_cfg := v_cfg || jsonb_build_object('seconds', v_sec);
  end if;

  perform public.cra_purge_old();
  update public.classroom_activities set status = 'closed', closed_at = now() where session_id = v_session and status = 'open';
  insert into public.classroom_activities(session_id, kind, title, config)
  values (v_session, p_kind, btrim(p_title), v_cfg) returning * into v_row;
  return jsonb_build_object('id',v_row.id,'kind',v_row.kind,'title',v_row.title,'config',v_row.config,'status',v_row.status,'reveal',v_row.reveal,'created_at',v_row.created_at);
end;
$$;

-- ---------------------------------------------------------------- 교사: 결과 (그림은 p_images=true 일 때만 이미지 포함)
drop function if exists public.cra_admin_results(text, uuid);
create or replace function public.cra_admin_results(p_room text, p_activity uuid default null, p_images boolean default false)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_session uuid; a public.classroom_activities; v_resp jsonb; v_joined int; v_test int; v_ready int; v_ready_test int;
begin
  if not public.classroom_admin_ok('') then raise exception 'unauthorized'; end if;
  select id into v_session from public.classroom_sessions where room_code = upper(p_room) and status = 'active';
  if v_session is null then raise exception 'room not found'; end if;
  select count(*), count(*) filter (where j.student_name ~* '^\s*(테스트|test)') into v_joined, v_test from (select distinct student_no, student_name from public.classroom_students where session_id = v_session and removed_at is null) j;
  select count(*), count(*) filter (where j.student_name ~* '^\s*(테스트|test)') into v_ready, v_ready_test from (select distinct student_no, student_name from public.classroom_students where session_id = v_session and removed_at is null and cra_seen > now() - interval '20 seconds') j;
  if p_activity is null then
    select * into a from public.classroom_activities where session_id = v_session and created_at > now() - interval '6 hours' order by created_at desc limit 1;
  else
    select * into a from public.classroom_activities where id = p_activity and session_id = v_session;
  end if;
  if not found then return jsonb_build_object('activity', null, 'responses', '[]'::jsonb, 'joined', v_joined, 'joined_test', v_test, 'ready', v_ready, 'ready_test', v_ready_test); end if;

  select coalesce(jsonb_agg(jsonb_build_object('student_id',x.sid,'no',x.student_no,'name',x.student_name,
           'answer', case when a.kind in ('draw','photo') and not coalesce(p_images,false) then (x.answer - 'img') || jsonb_build_object('drawn', x.answer ? 'img') else x.answer end,
           'updated_at',x.updated_at)
           order by nullif(regexp_replace(x.student_no,'\D','','g'),'')::int nulls last, x.student_no), '[]'::jsonb)
    into v_resp
  from (
    select distinct on (s.student_no, s.student_name) s.id as sid, s.student_no, s.student_name, r.answer, r.updated_at
    from public.classroom_responses r join public.classroom_students s on s.id = r.student_id
    where r.activity_id = a.id
    order by s.student_no, s.student_name, r.updated_at desc
  ) x;
  return jsonb_build_object(
    'activity', jsonb_build_object('id',a.id,'kind',a.kind,'title',a.title,'config',a.config,'status',a.status,'reveal',a.reveal,'created_at',a.created_at,'saved_at',a.saved_at),
    'responses', v_resp, 'joined', v_joined, 'joined_test', v_test, 'ready', v_ready, 'ready_test', v_ready_test);
end;
$$;

-- 수업 전체 CSV: 그림 이미지는 빼고 "그림을 냈는지"만 담는다.
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
        select jsonb_agg(jsonb_build_object('no',x.student_no,'name',x.student_name,
                   'answer', case when a.kind in ('draw','photo') then (x.answer - 'img') || jsonb_build_object('drawn', x.answer ? 'img') else x.answer end,
                   'updated_at',x.updated_at)
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

-- 아직 내려받지 않은 그림 활동(7일 안에 지워짐). 부를 때 오래된 그림도 함께 지운다.
create or replace function public.cra_admin_unsaved()
returns jsonb language plpgsql security definer set search_path = public
as $$
begin
  if not public.classroom_admin_ok('') then raise exception 'unauthorized'; end if;
  perform public.cra_purge_old();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'kind',a.kind,'created_at',a.created_at,'count',c.n,
             'expires_at', (select min(r.updated_at) + interval '7 days' from public.classroom_responses r where r.activity_id = a.id))
           order by a.created_at)
    from public.classroom_activities a
    join lateral (select count(*) as n from public.classroom_responses r where r.activity_id = a.id and r.answer ? 'img') c on c.n > 0
    where a.kind in ('draw','photo') and a.saved_at is null
  ), '[]'::jsonb);
end;
$$;

create or replace function public.cra_admin_mark_saved(p_activity uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if not public.classroom_admin_ok('') then raise exception 'unauthorized'; end if;
  update public.classroom_activities set saved_at = now() where id = p_activity and kind in ('draw','photo');
  return found;
end;
$$;

-- ---------------------------------------------------------------- 학생: 지금 활동 (그림은 내 이미지를 돌려주지 않고 "그렸는지"만)
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
  update public.classroom_students set cra_seen = now() where id = p_student and (cra_seen is null or cra_seen < now() - interval '10 seconds');

  select * into a from public.classroom_activities
  where session_id = v_session and created_at > now() - interval '6 hours'
  order by created_at desc limit 1;
  if not found then return jsonb_build_object('activity', null); end if;

  v_cfg := a.config;
  if not a.reveal then v_cfg := v_cfg - 'answer'; end if;
  select r.answer into v_my from public.classroom_responses r where r.activity_id = a.id and r.student_id = p_student;
  if a.kind in ('draw','photo') and v_my is not null then v_my := jsonb_build_object('drawn', true); end if;
  if a.reveal and a.kind = 'choice' then
    select coalesce(jsonb_object_agg(t.k, t.c), '{}'::jsonb) into v_counts
    from (select r.answer->>'choice' as k, count(*) as c from public.classroom_responses r where r.activity_id = a.id group by 1) t;
  end if;
  return jsonb_build_object(
    'activity', jsonb_build_object('id',a.id,'kind',a.kind,'title',a.title,'config',v_cfg,'status',a.status,'reveal',a.reveal,'created_at',a.created_at),
    'my', v_my, 'counts', v_counts, 'now', now());
end;
$$;

-- ---------------------------------------------------------------- 학생: 답 내기 (그림 추가)
create or replace function public.cra_student_submit(p_student uuid, p_token text, p_activity uuid, p_answer jsonb)
returns boolean language plpgsql security definer set search_path = public
as $$
declare v_session uuid; v_kind text; v_cfg jsonb; v_n int; v_ans jsonb; v_img text;
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
  elsif v_kind in ('draw','photo') then
    if coalesce(jsonb_typeof(p_answer->'img'),'') <> 'string' then raise exception 'bad answer'; end if;
    v_img := p_answer->>'img';
    if length(v_img) not between 200 and 400000 or v_img !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$' then
      raise exception 'bad answer';
    end if;
    v_ans := jsonb_build_object('img', v_img);
  else
    raise exception 'no answer needed';
  end if;

  insert into public.classroom_responses(activity_id, student_id, answer) values (p_activity, p_student, v_ans)
  on conflict (activity_id, student_id) do update set answer = excluded.answer, updated_at = now();
  return true;
end;
$$;

-- ---------------------------------------------------------------- 권한
revoke all on function public.cra_purge_old() from public, anon, authenticated;
revoke all on function public.cra_admin_open(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.cra_admin_results(text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.cra_admin_export(text, timestamptz) from public, anon, authenticated;
revoke all on function public.cra_admin_unsaved() from public, anon, authenticated;
revoke all on function public.cra_admin_mark_saved(uuid) from public, anon, authenticated;
revoke all on function public.cra_student_current(uuid, text) from public, anon, authenticated;
revoke all on function public.cra_student_submit(uuid, text, uuid, jsonb) from public, anon, authenticated;

grant execute on function public.cra_admin_open(text, text, text, jsonb) to authenticated;
grant execute on function public.cra_admin_results(text, uuid, boolean) to authenticated;
grant execute on function public.cra_admin_export(text, timestamptz) to authenticated;
grant execute on function public.cra_admin_unsaved() to authenticated;
grant execute on function public.cra_admin_mark_saved(uuid) to authenticated;
grant execute on function public.cra_student_current(uuid, text) to anon, authenticated;
grant execute on function public.cra_student_submit(uuid, text, uuid, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- 수업 흐름 목록: 마지막 사용일
alter table public.classroom_flows add column if not exists last_used_at timestamptz;

create or replace function public.cra_admin_flows_list()
returns jsonb language plpgsql security definer set search_path = public
as $$
begin
  if not public.classroom_admin_ok('') then raise exception 'unauthorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'title',f.title,'steps',f.steps,'updated_at',f.updated_at,'last_used_at',f.last_used_at)
                                    order by coalesce(f.last_used_at, f.updated_at) desc)
                   from public.classroom_flows f), '[]'::jsonb);
end;
$$;

create or replace function public.cra_admin_flow_touch(p_id uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if not public.classroom_admin_ok('') then raise exception 'unauthorized'; end if;
  update public.classroom_flows set last_used_at = now() where id = p_id;
  return found;
end;
$$;

revoke all on function public.cra_admin_flows_list() from public, anon, authenticated;
revoke all on function public.cra_admin_flow_touch(uuid) from public, anon, authenticated;
grant execute on function public.cra_admin_flows_list() to authenticated;
grant execute on function public.cra_admin_flow_touch(uuid) to authenticated;

-- ---------------------------------------------------------------- 친구들에게 공개(그림·사진 갤러리)
-- 교사가 cra_admin_reveal 로 공개해 둔 그림·사진 활동에 한해, 같은 수업방 학생이 이름 없이 작품을 볼 수 있다.
-- 이름·번호는 돌려주지 않고(내 것만 mine 표시), 순서는 활동마다 고정된 무작위, 최대 40장. 시험용 학생("테스트"/test)은 뺀다.
create or replace function public.cra_student_gallery(p_student uuid, p_token text, p_activity uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_session uuid; a public.classroom_activities;
begin
  select s.session_id into v_session
  from public.classroom_students s join public.classroom_sessions c on c.id = s.session_id
  where s.id = p_student and s.removed_at is null and c.status = 'active'
    and s.token_hash = encode(sha256(convert_to(coalesce(p_token,''),'utf8')),'hex');
  if v_session is null then return jsonb_build_object('items', '[]'::jsonb); end if;
  select * into a from public.classroom_activities where id = p_activity and session_id = v_session;
  if not found or not a.reveal or a.kind not in ('draw','photo') then return jsonb_build_object('items', '[]'::jsonb); end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('img', t.img, 'mine', t.mine) order by t.k)
    from (
      select r.answer->>'img' as img, (r.student_id = p_student) as mine, md5(r.student_id::text || a.id::text) as k
      from public.classroom_responses r join public.classroom_students s on s.id = r.student_id
      where r.activity_id = a.id and r.answer ? 'img'
        and s.student_name !~* '^\s*(테스트|test)'
      order by md5(r.student_id::text || a.id::text) limit 40
    ) t), '[]'::jsonb));
end;
$$;
revoke all on function public.cra_student_gallery(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.cra_student_gallery(uuid, text, uuid) to anon, authenticated;
