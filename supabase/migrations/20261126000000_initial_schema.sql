-- Ayvu: ebook -> audiobook
-- Reads happen straight from the client (RLS). Every write except listening progress goes
-- through the Modal API / workers with the service role.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.book_status as enum (
  'uploaded', 'preparing', 'queued', 'generating', 'completed', 'failed', 'cancelled'
);
create type public.chapter_status as enum (
  'pending', 'generating', 'completed', 'failed', 'cancelled'
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Books
-- ---------------------------------------------------------------------------
create table public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  author text,
  source_path text not null,
  source_filename text not null,
  source_format text not null check (source_format in ('pdf', 'epub', 'mobi', 'azw', 'azw3', 'txt')),
  language_override text,          -- chosen by the user at upload; null = auto-detect
  language_code text,              -- language actually narrated
  voice text,                      -- Kokoro voice id; null = language default
  status public.book_status not null default 'uploaded',
  total_chapters integer not null default 0,
  completed_chapters integer not null default 0,
  failed_chapters integer not null default 0,
  total_duration_seconds integer not null default 0,
  cover_path text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index books_user_created_idx on public.books (user_id, created_at desc);

create trigger books_updated_at before update on public.books
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Chapters (the queue unit)
-- ---------------------------------------------------------------------------
create table public.chapters (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  chapter_index integer not null,
  title text,
  word_count integer not null default 0,
  status public.chapter_status not null default 'pending',
  attempt_count integer not null default 0,
  last_error text,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  audio_path text,
  duration_seconds real,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, chapter_index)
);

create index chapters_user_idx on public.chapters (user_id);
create index chapters_pending_idx on public.chapters (user_id, available_at) where status = 'pending';
create index chapters_generating_idx on public.chapters (locked_at) where status = 'generating';

create trigger chapters_updated_at before update on public.chapters
  for each row execute function public.set_updated_at();

-- Chapter text lives apart so clients never pull it by accident. RLS on, no policies:
-- only the service role can read or write it.
create table public.chapter_texts (
  chapter_id uuid primary key references public.chapters (id) on delete cascade,
  content text not null
);

-- Keep book counters and status in sync with its chapters.
create or replace function public.refresh_book_progress(p_book_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_completed integer;
  v_failed integer;
  v_active integer;
  v_generating integer;
  v_duration integer;
  v_total integer;
begin
  select
    count(*) filter (where status = 'completed'),
    count(*) filter (where status = 'failed'),
    count(*) filter (where status in ('pending', 'generating')),
    count(*) filter (where status = 'generating'),
    coalesce(sum(duration_seconds) filter (where status = 'completed'), 0)::integer,
    count(*)
  into v_completed, v_failed, v_active, v_generating, v_duration, v_total
  from public.chapters
  where book_id = p_book_id;

  update public.books b
  set
    completed_chapters = v_completed,
    failed_chapters = v_failed,
    total_duration_seconds = v_duration,
    status = case
      when b.status in ('cancelled', 'uploaded', 'preparing') then b.status
      when v_active > 0 and (v_generating > 0 or v_completed > 0) then 'generating'::public.book_status
      when v_active > 0 then 'queued'::public.book_status
      when v_failed > 0 then 'failed'::public.book_status
      when v_total > 0 and v_completed = v_total then 'completed'::public.book_status
      else b.status
    end
  where b.id = p_book_id;
end;
$$;

create or replace function public.chapters_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_book_progress(coalesce(new.book_id, old.book_id));
  return null;
end;
$$;

create trigger chapters_refresh_book
  after update of status, duration_seconds on public.chapters
  for each row execute function public.chapters_after_change();

-- ---------------------------------------------------------------------------
-- Fair queue: one chapter per user per turn (round-robin), oldest book first,
-- chapters in reading order so the first chapters are ready to play early.
-- ---------------------------------------------------------------------------
create table public.scheduler_state (
  id integer primary key default 1 check (id = 1),
  last_user_id uuid,
  updated_at timestamptz not null default now()
);
insert into public.scheduler_state (id) values (1);

create or replace function public.claim_next_chapter()
returns setof public.chapters
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last uuid;
  v_user uuid;
  v_id uuid;
begin
  -- Serializes claimers so the round-robin pointer stays consistent.
  select last_user_id into v_last from public.scheduler_state where id = 1 for update;

  select c.user_id into v_user
  from public.chapters c
  join public.books b on b.id = c.book_id
  where c.status = 'pending'
    and c.available_at <= now()
    and b.status in ('queued', 'generating')
  group by c.user_id
  order by (c.user_id <= coalesce(v_last, '00000000-0000-0000-0000-000000000000'::uuid)), c.user_id
  limit 1;

  if v_user is null then
    return;
  end if;

  select c.id into v_id
  from public.chapters c
  join public.books b on b.id = c.book_id
  where c.user_id = v_user
    and c.status = 'pending'
    and c.available_at <= now()
    and b.status in ('queued', 'generating')
  order by b.created_at, c.chapter_index
  limit 1
  for update of c skip locked;

  if v_id is null then
    return;
  end if;

  update public.scheduler_state set last_user_id = v_user, updated_at = now() where id = 1;

  return query
  update public.chapters
  set status = 'generating', locked_at = now(), attempt_count = attempt_count + 1, last_error = null
  where id = v_id
  returning *;
end;
$$;

-- Workers that died mid-chapter: hand the chapter back (or fail it after 3 attempts).
create or replace function public.reset_stale_chapters(p_stale_minutes integer default 20)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with stale as (
    update public.chapters
    set
      status = case when attempt_count >= 3 then 'failed'::public.chapter_status else 'pending'::public.chapter_status end,
      last_error = coalesce(last_error, 'Worker stopped while generating this chapter.'),
      locked_at = null
    where status = 'generating'
      and locked_at < now() - make_interval(mins => p_stale_minutes)
    returning 1
  )
  select count(*) into v_count from stale;
  return v_count;
end;
$$;

create or replace function public.queue_stats()
returns table (pending bigint, generating bigint)
language sql
security definer
set search_path = ''
as $$
  select
    count(*) filter (where c.status = 'pending' and c.available_at <= now() and b.status in ('queued', 'generating')),
    count(*) filter (where c.status = 'generating')
  from public.chapters c
  join public.books b on b.id = c.book_id;
$$;

-- ---------------------------------------------------------------------------
-- Listening progress (written by the client; last writer by timestamp wins,
-- so a stale offline sync never overwrites newer progress).
-- ---------------------------------------------------------------------------
create table public.listening_progress (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  chapter_index integer not null,
  position_seconds real not null default 0 check (position_seconds >= 0),
  playback_rate real not null default 1 check (playback_rate between 0.5 and 3),
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

create index listening_progress_book_idx on public.listening_progress (book_id);

create or replace function public.listening_progress_keep_newest()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.updated_at is null or new.updated_at > now() + interval '5 minutes' then
    new.updated_at = now();
  end if;
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return old;
  end if;
  return new;
end;
$$;

create trigger listening_progress_newest before insert or update on public.listening_progress
  for each row execute function public.listening_progress_keep_newest();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.books enable row level security;
alter table public.chapters enable row level security;
alter table public.chapter_texts enable row level security;
alter table public.scheduler_state enable row level security;
alter table public.listening_progress enable row level security;

create policy "Users read their profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "Users update their profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke update on public.profiles from authenticated, anon;
grant update (display_name) on public.profiles to authenticated;

create policy "Users read their books" on public.books
  for select to authenticated using (user_id = (select auth.uid()));

create policy "Users read their chapters" on public.chapters
  for select to authenticated using (user_id = (select auth.uid()));

create policy "Users read their progress" on public.listening_progress
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users insert their progress" on public.listening_progress
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.books b where b.id = book_id and b.user_id = (select auth.uid()))
  );
create policy "Users update their progress" on public.listening_progress
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "Users delete their progress" on public.listening_progress
  for delete to authenticated using (user_id = (select auth.uid()));

-- Worker-only functions
revoke execute on function public.claim_next_chapter() from public, anon, authenticated;
revoke execute on function public.reset_stale_chapters(integer) from public, anon, authenticated;
revoke execute on function public.queue_stats() from public, anon, authenticated;
revoke execute on function public.refresh_book_progress(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.chapters_after_change() from public, anon, authenticated;
grant execute on function public.claim_next_chapter() to service_role;
grant execute on function public.reset_stale_chapters(integer) to service_role;
grant execute on function public.queue_stats() to service_role;
grant execute on function public.refresh_book_progress(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Realtime: library and book screens update live while chapters generate.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.books, public.chapters;

-- ---------------------------------------------------------------------------
-- Storage: {user_id}/{book_id}/... in every bucket.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('uploads', 'uploads', false, 52428800),
  ('audio', 'audio', false, null),
  ('covers', 'covers', false, 5242880)
on conflict (id) do nothing;

create policy "Users upload books to their folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users read their uploads" on storage.objects
  for select to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users read their audio" on storage.objects
  for select to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users read their covers" on storage.objects
  for select to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
