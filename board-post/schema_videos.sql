-- 게시판 영상 모음(유튜브 링크만 연결, 영상 파일은 올리지 않음). 접두어 bd_
-- 영상 번호(11글자)만 저장하고 썸네일·재생은 유튜브에서 빌려 온다. 기본은 꺼짐(bd_settings.videos_enabled=false), 선생님이 승인한 영상만 보임.
-- 모든 접근은 Edge Function board-post(서비스 키)로만. 교사는 gt_is_teacher() 로 직접 접근 가능.
create table if not exists public.bd_settings (
  class_id uuid primary key references public.gt_classes(id) on delete cascade,
  videos_enabled boolean not null default false
);
create table if not exists public.bd_videos (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.gt_classes(id) on delete cascade,
  author_id uuid not null references public.gt_students(id) on delete cascade,
  show_real boolean not null default true,
  nick text not null default '' check (char_length(nick) <= 10),
  yt_id text not null check (yt_id ~ '^[A-Za-z0-9_-]{11}$'),
  kind text not null default 'video' check (kind in ('video','short')),
  title text not null default '' check (char_length(title) <= 100),
  note text not null default '' check (char_length(note) <= 100),
  approved boolean not null default false,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.bd_video_likes (
  video_id uuid not null references public.bd_videos(id) on delete cascade,
  student_id uuid not null references public.gt_students(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (video_id, student_id)
);
create index if not exists bd_videos_class_idx on public.bd_videos(class_id, created_at desc);
alter table public.bd_settings enable row level security;
alter table public.bd_videos enable row level security;
alter table public.bd_video_likes enable row level security;
revoke all on public.bd_settings, public.bd_videos, public.bd_video_likes from anon, authenticated;
grant select, insert, update, delete on public.bd_settings, public.bd_videos, public.bd_video_likes to authenticated;
create policy bd_settings_teacher on public.bd_settings for all to authenticated using (gt_is_teacher()) with check (gt_is_teacher());
create policy bd_videos_teacher on public.bd_videos for all to authenticated using (gt_is_teacher()) with check (gt_is_teacher());
create policy bd_video_likes_teacher on public.bd_video_likes for all to authenticated using (gt_is_teacher()) with check (gt_is_teacher());
