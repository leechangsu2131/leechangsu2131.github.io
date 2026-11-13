-- 단원평가 배포 단계 (프로젝트 teacherlesson-table, Supabase SQL Editor에서 실행)
-- 이미 적용되어 있으며, 새 프로젝트에 옮길 때만 다시 실행하세요. 여러 번 실행해도 안전합니다.
--   미배포(hidden)  : exam_open=false, released=false  → 시험지·오답노트·점수 잠김
--   시험 배포(exam) : exam_open=true,  released=false  → 시험지만 열림
--   완전 배포(full) : exam_open=true,  released=true   → 모두 열림
-- released는 기존대로 DB가 오답노트·점수 조회(unit_test_my_submission / unit_test_my_score)를 막는 데 쓰입니다.
-- 교사 인증은 classroom/schema.sql의 classroom_admin_ok(교사 계정 로그인 + classroom_teachers 허용 목록)를 사용합니다.

alter table public.unit_test_release add column if not exists exam_open boolean not null default true;

-- 아직 시험을 치지 않은 단원은 미배포로 둡니다 (예: 수학 4단원 분수)
-- update public.unit_test_release set exam_open = false, released = false where test_id = 'math-3-2-4-basic4';

create or replace function public.unit_test_release_status()
returns jsonb language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'test_id', test_id, 'exam_open', exam_open, 'released', released
  ) order by test_id), '[]'::jsonb) from public.unit_test_release;
$$;

create or replace function public.unit_test_release_set(p_test_id text, p_stage text)
returns jsonb language plpgsql security definer set search_path = public
as $$
begin
  if not public.classroom_admin_ok('') then raise exception 'unauthorized'; end if;
  if p_stage not in ('hidden','exam','full') then raise exception 'invalid stage'; end if;
  if coalesce(btrim(p_test_id),'') = '' or length(p_test_id) > 80 then raise exception 'invalid test'; end if;
  insert into public.unit_test_release(test_id, exam_open, released, released_at)
  values (p_test_id, p_stage <> 'hidden', p_stage = 'full', case when p_stage = 'full' then now() end)
  on conflict (test_id) do update set
    exam_open = excluded.exam_open,
    released = excluded.released,
    released_at = case when excluded.released then coalesce(public.unit_test_release.released_at, now()) else public.unit_test_release.released_at end;
  return public.unit_test_release_status();
end;
$$;

revoke all on function public.unit_test_release_status() from public, anon, authenticated;
revoke all on function public.unit_test_release_set(text,text) from public, anon, authenticated;
grant execute on function public.unit_test_release_status() to anon, authenticated;
grant execute on function public.unit_test_release_set(text,text) to authenticated;
