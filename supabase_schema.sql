-- Tennis-Olympiade schema, RLS-first design (no service_role key needed anywhere).
-- The app's serverless functions use only the public anon/publishable key.
-- Admin-gated mutations (setup/players/games) go through SECURITY DEFINER RPCs
-- that check the shared admin code server-side and never leak it back out.

create extension if not exists "pgcrypto";

create table if not exists config (
  key text primary key,
  value text not null
);

insert into config (key, value) values
  ('eventTitle', 'Tennis-Olympiade'),
  ('eventSub', 'Live-Scoreboard'),
  ('eventDate', '04.10.2026'),
  ('adminCode', 'CHANGE_ME') -- set a real admin code manually after running this schema
on conflict (key) do nothing;

create table if not exists players (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  name_key text generated always as (lower(regexp_replace(trim(name), '\s+', ' ', 'g'))) stored,
  created_at timestamptz not null default now()
);
create unique index if not exists players_name_key_uidx on players (name_key);

create table if not exists games (
  id text primary key,
  name text not null,
  unit text not null default '',
  direction text not null default 'high', -- 'high' = mehr ist besser, 'low' = weniger ist besser
  sort_order int not null default 0
);

insert into games (id, name, unit, direction, sort_order) values
  ('game_golf', 'Tennisgolf', 'Schläge', 'low', 1),
  ('game_netzroller', 'Netzroller', 'cm zum Netz', 'low', 2),
  ('game_quiz', 'Tennis Quiz', 'Punkte', 'high', 3),
  ('game_falschehand', 'Falsche Hand', 'Matchsiege', 'high', 4),
  ('game_falscherueckhand', 'Falsche Rückhand', 'Matchsiege', 'high', 5),
  ('game_handicap', 'Handicap Tennis', 'Siege', 'high', 6),
  ('game_aufschlagziel', 'Aufschlag-Ziel-Contest', 'Punkte', 'high', 7),
  ('game_bierstaffel', 'Bierglas-Balance-Staffel', 'Sekunden', 'low', 8)
on conflict (id) do nothing;

create table if not exists entries (
  game_id text not null references games(id) on delete cascade,
  player_id text not null references players(id) on delete cascade,
  value numeric not null,
  updated_at timestamptz not null default now(),
  primary key (game_id, player_id)
);

alter table config enable row level security;
alter table players enable row level security;
alter table games enable row level security;
alter table entries enable row level security;

drop policy if exists config_select_public on config;
create policy config_select_public on config for select
  using (key <> 'adminCode'); -- the admin code itself is never selectable, even via the anon key

drop policy if exists players_select_public on players;
create policy players_select_public on players for select using (true);
drop policy if exists players_insert_public on players;
create policy players_insert_public on players for insert with check (true); -- self-registration
-- no update/delete policy for players: renaming/removing only via admin_save_setup() below

drop policy if exists games_select_public on games;
create policy games_select_public on games for select using (true);
-- no insert/update/delete policy for games: only via admin_save_setup() below

-- entries stay fully open (read + write), matching the app's existing "convenience gate,
-- not real security" model: any player can already save any entry, and admins bulk-write
-- entries for everyone from the same table.
drop policy if exists entries_select_public on entries;
create policy entries_select_public on entries for select using (true);
drop policy if exists entries_insert_public on entries;
create policy entries_insert_public on entries for insert with check (true);
drop policy if exists entries_update_public on entries;
create policy entries_update_public on entries for update using (true) with check (true);
drop policy if exists entries_delete_public on entries;
create policy entries_delete_public on entries for delete using (true);

-- ---------- admin RPCs: the only way to read/act on the admin code or touch config/players/games writes ----------

create or replace function check_admin_code(input_code text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from config where key = 'adminCode' and value = input_code);
$$;

create or replace function admin_save_setup(
  input_code text,
  new_event_title text,
  new_event_sub text,
  new_event_date text,
  new_admin_code text,
  new_players jsonb, -- [{"id": "...", "name": "..."}, ...] or null to leave players untouched
  new_games jsonb    -- [{"id": "...", "name": "...", "unit": "...", "direction": "high"|"low"}, ...] or null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ok boolean;
  desired_player_ids text[];
  desired_game_ids text[];
begin
  select exists (select 1 from config where key = 'adminCode' and value = input_code) into ok;
  if not ok then
    raise exception 'wrong_code';
  end if;

  if new_event_title is not null then
    update config set value = new_event_title where key = 'eventTitle';
  end if;
  if new_event_sub is not null then
    update config set value = new_event_sub where key = 'eventSub';
  end if;
  if new_event_date is not null then
    update config set value = new_event_date where key = 'eventDate';
  end if;
  if new_admin_code is not null and length(trim(new_admin_code)) > 0 then
    update config set value = trim(new_admin_code) where key = 'adminCode';
  end if;

  if new_players is not null then
    begin
      insert into players (id, name)
      select p->>'id', p->>'name' from jsonb_array_elements(new_players) as p
      on conflict (id) do update set name = excluded.name;
    exception when unique_violation then
      raise exception 'duplicate_name';
    end;

    select coalesce(array_agg(p->>'id'), array[]::text[]) into desired_player_ids
    from jsonb_array_elements(new_players) as p;
    delete from players where not (id = any(desired_player_ids));
  end if;

  if new_games is not null then
    insert into games (id, name, unit, direction, sort_order)
    select g->>'id', g->>'name', coalesce(g->>'unit', ''), coalesce(g->>'direction', 'high'), ord::int
    from jsonb_array_elements(new_games) with ordinality as t(g, ord)
    on conflict (id) do update set
      name = excluded.name, unit = excluded.unit, direction = excluded.direction, sort_order = excluded.sort_order;

    select coalesce(array_agg(g->>'id'), array[]::text[]) into desired_game_ids
    from jsonb_array_elements(new_games) as g;
    delete from games where not (id = any(desired_game_ids));
  end if;
end;
$$;

grant execute on function check_admin_code(text) to anon, authenticated;
grant execute on function admin_save_setup(text, text, text, text, text, jsonb, jsonb) to anon, authenticated;
