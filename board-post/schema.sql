-- 학급 온라인 게시판(3-2 매체 단원 「온라인 상황에서 글을 써요」 실습용). 접두어 bd_
-- 모든 접근은 Edge Function board-post(서비스 키)로만. 학생·익명 접근 없음, 교사는 gt_is_teacher() 로 직접 접근 가능.
create table if not exists public.bd_topics (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.gt_classes(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 40),
  guide text not null default '' check (char_length(guide) <= 200),
  open boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.bd_posts (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.gt_classes(id) on delete cascade,
  topic_id uuid not null references public.bd_topics(id) on delete cascade,
  author_id uuid not null references public.gt_students(id) on delete cascade,
  show_real boolean not null default true,                       -- true: 실명, false: 별명으로 보임(교사는 항상 실명을 봄)
  nick text not null default '' check (char_length(nick) <= 10),
  title text not null check (char_length(title) between 1 and 30),
  body text not null check (char_length(body) between 1 and 500),
  size text not null default 'normal' check (size in ('normal','big')),
  color text not null default 'black' check (color in ('black','red','blue','green','purple','orange')),
  emojis text not null default '' check (char_length(emojis) <= 24),
  photo_path text,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create table if not exists public.bd_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.bd_posts(id) on delete cascade,
  class_id uuid not null references public.gt_classes(id) on delete cascade,
  author_id uuid not null references public.gt_students(id) on delete cascade,
  show_real boolean not null default true,
  nick text not null default '' check (char_length(nick) <= 10),
  kind text not null check (kind in ('question','praise','thanks','story')),   -- 질문·칭찬·감사·경험
  body text not null check (char_length(body) between 1 and 100),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.bd_likes (
  post_id uuid not null references public.bd_posts(id) on delete cascade,
  student_id uuid not null references public.gt_students(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, student_id)
);
create index if not exists bd_posts_topic_idx on public.bd_posts(topic_id, created_at desc);
create index if not exists bd_comments_post_idx on public.bd_comments(post_id, created_at);

alter table public.bd_topics enable row level security;
alter table public.bd_posts enable row level security;
alter table public.bd_comments enable row level security;
alter table public.bd_likes enable row level security;
revoke all on public.bd_topics, public.bd_posts, public.bd_comments, public.bd_likes from anon, authenticated;
grant select, insert, update, delete on public.bd_topics, public.bd_posts, public.bd_comments, public.bd_likes to authenticated;
create policy bd_topics_teacher on public.bd_topics for all to authenticated using (gt_is_teacher()) with check (gt_is_teacher());
create policy bd_posts_teacher on public.bd_posts for all to authenticated using (gt_is_teacher()) with check (gt_is_teacher());
create policy bd_comments_teacher on public.bd_comments for all to authenticated using (gt_is_teacher()) with check (gt_is_teacher());
create policy bd_likes_teacher on public.bd_likes for all to authenticated using (gt_is_teacher()) with check (gt_is_teacher());

-- 사진: 비공개 보관함(JPEG, 300KB 이하). 서버 함수만 올리고 읽음(1시간짜리 임시 주소).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('board-photos', 'board-photos', false, 300000, array['image/jpeg'])
on conflict (id) do nothing;
