-- 매너온도·해금 (2026-11-20). Supabase 프로젝트 teacherlesson-table 에 이미 적용된 내용을 기록해 둔 문서다.
-- 규칙은 st_manner 한 곳에만 둔다(swap-market · char-hub 가 호출). school-tool 의 myTemp 는 옛 계산(모임 칭찬 누적)이라 화면에서 쓰지 않는다.
--  - 최근 28일에 받은 칭찬만 센다(모이자 st_meetup_praise + 바꾸자 st_swap_praise).
--  - 같은 친구가 준 칭찬은 28일 안에 최대 2개까지만 센다(칭찬 품앗이 방지).
--  - 온도 = 36.5 + 0.5 × min(n,7) + 0.25 × max(n-7,0), 최소 36.5(내려가도 이 아래로 안 간다), 최대 99.9.
--  - count = 최근 28일 반영된 칭찬 수, total = 전체 기간 받은 칭찬 수.
create or replace function public.st_manner(p_student uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with p as (
    select from_id, created_at from public.st_meetup_praise where to_id = p_student
    union all
    select from_id, created_at from public.st_swap_praise where to_id = p_student
  ),
  rec as (
    select row_number() over (partition by from_id order by created_at desc) as rn
    from p where created_at > now() - interval '28 days'
  ),
  c as (select count(*) filter (where rn <= 2)::int as n from rec),
  t as (select count(*)::int as n from p)
  select jsonb_build_object(
    'temp', least(99.9, round((36.5 + 0.5 * least(c.n, 7) + 0.25 * greatest(c.n - 7, 0))::numeric, 1)),
    'count', c.n,
    'total', t.n
  ) from c, t;
$$;
revoke all on function public.st_manner(uuid) from public, anon, authenticated;
grant execute on function public.st_manner(uuid) to service_role;

-- 해금(영구): 한 번 열린 기능은 온도가 내려가도 그대로 쓴다. 서버(service_role)만 쓰고, 교사는 읽기만 한다.
-- st_unlock(student_id uuid, key text, unlocked_at timestamptz), 키 예: special_char(온도 38℃ 도달)
-- RLS 켜짐, anon·authenticated 접근 없음, 정책 st_unlock_teacher(select, gt_is_teacher()).
