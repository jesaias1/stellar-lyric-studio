-- Stellar Lyric Studio: accounts, saved projects and linked social accounts.
-- Run once in the Supabase SQL editor. Safe to run again.

-- ---------- private settings (not reachable through the API) ----------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.settings (key text primary key, value text not null);
grant usage on schema private to supabase_auth_admin;

-- ---------- sign-up needs the team code ----------
-- The sign-up form sends the code as user metadata; this runs inside Supabase before the user is created,
-- so it can't be skipped by calling the sign-up API directly. The code itself is not kept on the user.
create or replace function private.check_team_code() returns trigger
language plpgsql security definer set search_path = '' as $$
declare want text;
begin
  select value into want from private.settings where key = 'team_code';
  -- capitals and spaces around it don't matter
  if want is not null and upper(btrim(coalesce(new.raw_user_meta_data->>'team_code', ''))) <> upper(btrim(want)) then
    raise exception 'wrong_team_code' using errcode = 'P0001';
  end if;
  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'team_code';
  return new;
end $$;
drop trigger if exists sls_check_team_code on auth.users;
create trigger sls_check_team_code before insert on auth.users for each row execute function private.check_team_code();
-- Supabase Auth writes the user once more right after creating it (with the sign-up data again): strip the code there too
create or replace function private.strip_team_code() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.raw_user_meta_data ? 'team_code' then new.raw_user_meta_data := new.raw_user_meta_data - 'team_code'; end if;
  return new;
end $$;
drop trigger if exists sls_strip_team_code on auth.users;
create trigger sls_strip_team_code before update on auth.users for each row execute function private.strip_team_code();

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '' check (char_length(name) <= 80),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create or replace function private.new_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name) values (new.id, left(coalesce(new.raw_user_meta_data->>'name', ''), 80))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists sls_new_profile on auth.users;
create trigger sls_new_profile after insert on auth.users for each row execute function private.new_profile();
grant execute on function private.check_team_code(), private.strip_team_code(), private.new_profile() to supabase_auth_admin;

-- ---------- saved projects (the edit only: lyrics, timing, style, cuts; no audio or footage) ----------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  local_id text not null check (char_length(local_id) <= 64),
  name text not null default '' check (char_length(name) <= 200),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, local_id),
  check (pg_column_size(data) < 2000000)
);
create index if not exists projects_user on public.projects (user_id, updated_at desc);
alter table public.projects enable row level security;
drop policy if exists "own projects" on public.projects;
create policy "own projects" on public.projects for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------- linked social media accounts ----------
-- "sealed" is encrypted by the website's server (AES-GCM with its TOKEN_KEY) and tied to this user,
-- so the database never holds a readable token, and one user's sealed account is useless to anyone else.
create table if not exists public.social_accounts (
  id text not null check (char_length(id) <= 64),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  platform text not null check (platform in ('youtube', 'instagram', 'tiktok')),
  name text not null default '' check (char_length(name) <= 200),
  avatar text not null default '' check (char_length(avatar) <= 2000),
  artist text not null default '' check (char_length(artist) <= 120),
  sealed text not null check (char_length(sealed) <= 20000),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.social_accounts enable row level security;
drop policy if exists "own social accounts" on public.social_accounts;
create policy "own social accounts" on public.social_accounts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- only signed-in users reach these tables; nothing for visitors who aren't logged in
revoke all on public.profiles, public.projects, public.social_accounts from anon;
grant select, insert, update, delete on public.profiles, public.projects, public.social_accounts to authenticated;

-- the team code people need to sign up. To change it later, run just this line with the new code:
-- insert into private.settings (key, value) values ('team_code', 'NEW-CODE') on conflict (key) do update set value = excluded.value;

-- ---------- posts: scheduled ones (the calendar) and ones already made (history and results) ----------
-- The studio adds a row when you schedule a post, or after posting right away. Every 5 minutes the website's
-- server (/api/cron, called by pg_cron below) posts the ones that are due, checks on ones still processing,
-- and now and then reads back views and likes. The server uses the Supabase secret key for this; people only
-- ever see their own rows.
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  platform text not null check (platform in ('youtube', 'instagram', 'tiktok')),
  account_id text not null check (char_length(account_id) <= 64),
  account_name text not null default '' check (char_length(account_name) <= 200),
  project_name text not null default '' check (char_length(project_name) <= 200),
  artist text not null default '' check (char_length(artist) <= 120),
  video_url text check (char_length(video_url) <= 2000),
  video_type text not null default 'video/mp4' check (char_length(video_type) <= 60),
  cover_url text check (char_length(cover_url) <= 2000),
  meta jsonb not null default '{}'::jsonb check (pg_column_size(meta) <= 20000),
  publish_at timestamptz not null default now(),
  status text not null default 'scheduled' check (status in ('scheduled', 'posting', 'working', 'posted', 'failed', 'cancelled')),
  ref text check (char_length(ref) <= 300),
  result_url text check (char_length(result_url) <= 2000),
  note text check (char_length(note) <= 1000),
  attempts int not null default 0,
  stats jsonb,
  stats_at timestamptz,
  mailed boolean not null default false,          -- already in a daily summary email
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists posts_due on public.posts (status, publish_at);
create index if not exists posts_user on public.posts (user_id, publish_at desc);
alter table public.posts enable row level security;
drop policy if exists "own posts" on public.posts;
create policy "own posts" on public.posts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.posts from anon;
grant select, insert, update, delete on public.posts to authenticated;

-- a few values the scheduler keeps for itself (when the last daily summary email went out); only the server's
-- secret key can read or change it
create table if not exists public.studio_state (key text primary key, value text not null default '', updated_at timestamptz not null default now());
alter table public.studio_state enable row level security;
revoke all on public.studio_state from anon, authenticated;

-- every 5 minutes: ask the website to post what's due (needs the pg_cron and pg_net extensions)
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('sls-posts') where exists (select 1 from cron.job where jobname = 'sls-posts');
select cron.schedule('sls-posts', '*/5 * * * *', $$ select net.http_post(url := 'https://lyrics.stellarmusic.dk/api/cron', headers := '{"content-type": "application/json"}'::jsonb, body := '{}'::jsonb) $$);
