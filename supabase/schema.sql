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
