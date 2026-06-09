-- Arcade Basketball — database schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
--
-- After running, copy your Project URL and anon key into
-- src/environments/environment.ts.

-- ---------------------------------------------------------------------------
-- players: people who can play on a hoop
-- ---------------------------------------------------------------------------
create table if not exists public.players (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) > 0),
  color       text not null default '#3b82f6',
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- games: one row per completed game (written only when the timer hits 0)
-- ---------------------------------------------------------------------------
create table if not exists public.games (
  id                uuid primary key default gen_random_uuid(),
  mode              text not null,
  duration_seconds  int  not null,
  -- Nullable: a single-player game leaves the unmanned hoop's player empty.
  -- At least one is always set (enforced by the app).
  hoop1_player_id   uuid references public.players (id),
  hoop2_player_id   uuid references public.players (id),
  hoop1_score       int  not null default 0,
  hoop2_score       int  not null default 0,
  hoop1_shots       int  not null default 0,
  hoop2_shots       int  not null default 0,
  winner_player_id  uuid references public.players (id),
  created_at        timestamptz not null default now()
);

create index if not exists games_created_at_idx on public.games (created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- The app uses the public anon key, so RLS must be enabled and explicit
-- policies granted. This first draft is a trusted single-kiosk app, so anon
-- is allowed full read/write. Tighten these once auth is introduced.
-- ---------------------------------------------------------------------------
alter table public.players enable row level security;
alter table public.games   enable row level security;

drop policy if exists "players anon full access" on public.players;
create policy "players anon full access"
  on public.players for all
  to anon
  using (true)
  with check (true);

drop policy if exists "games anon full access" on public.games;
create policy "games anon full access"
  on public.games for all
  to anon
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- Migration: allow single-player games
-- Run this against an existing database to let one hoop be left unmanned.
-- (Adjust the schema name to match your project — the app uses
-- the `arcade_basketball` schema; swap `public` below if yours differs.)
-- ---------------------------------------------------------------------------
alter table public.games alter column hoop1_player_id drop not null;
alter table public.games alter column hoop2_player_id drop not null;
