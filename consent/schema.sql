-- 보호자 동의 기록(물물장터 'swap', 영상 모음 'video'). 접두어 st_ (교실 연결 계열)
-- 종이 동의서(parent-consent.html)를 받은 뒤 선생님이 교사 화면 「📝 보호자 동의 확인」에서 학생별로 표시한다.
-- st_consent_rules.required 가 true 인 기능은 동의가 표시된 학생만 쓸 수 있다(서버 swap-market·board-post 가 확인). 기본은 false(지금처럼 모두 사용).
-- 서명 사진·보호자 연락처는 저장하지 않는다. 학생 접근은 Edge Function(서비스 키)로만, 교사는 gt_is_teacher() 로 직접.
create table if not exists public.st_consent_rules (
  class_id uuid not null references public.gt_classes(id) on delete cascade,
  kind text not null check (kind in ('swap','video')),
  required boolean not null default false,
  primary key (class_id, kind)
);
create table if not exists public.st_consents (
  student_id uuid not null references public.gt_students(id) on delete cascade,
  kind text not null check (kind in ('swap','video')),
  agreed boolean not null default false,
  signed_on date,
  noted_at timestamptz not null default now(),
  primary key (student_id, kind)
);
alter table public.st_consent_rules enable row level security;
alter table public.st_consents enable row level security;
revoke all on public.st_consent_rules, public.st_consents from anon, authenticated;
grant select, insert, update, delete on public.st_consent_rules, public.st_consents to authenticated;
create policy st_consent_rules_teacher on public.st_consent_rules for all to authenticated using (gt_is_teacher()) with check (gt_is_teacher());
create policy st_consents_teacher on public.st_consents for all to authenticated using (gt_is_teacher()) with check (gt_is_teacher());
