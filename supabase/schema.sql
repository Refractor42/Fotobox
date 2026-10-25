-- ============================================================
-- SnapBox — global daily streak
-- Run once in the Supabase SQL editor (Project → SQL Editor → New query),
-- then reload the app. The dev server reads/writes this table with the
-- service role key; the browser never talks to Supabase directly.
--
-- The streak is shared by the whole photobox, so it lives in one row: id = 1.
-- `id` is text to stay compatible with databases created by the earlier
-- per-device version of this table; `where id = 1` still matches.
-- ============================================================

create table if not exists public.profiles (
  id                   text primary key,
  current_streak       integer not null default 0,
  highest_streak       integer not null default 0,
  last_photo_timestamp timestamptz,
  created_at           timestamptz not null default now()
);

-- The single global streak row, created empty so the first read works.
insert into public.profiles (id) values ('1')
on conflict (id) do nothing;

-- Rows are only touched by the server's service role key, which bypasses RLS.
-- Leaving RLS on with no policies keeps the table closed to anon/authenticated.
alter table public.profiles enable row level security;
