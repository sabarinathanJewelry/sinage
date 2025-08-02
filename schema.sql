
-- Screens
create table if not exists screens (
  id uuid primary key default uuid_generate_v4(),
  name text,
  orientation text default 'landscape',
  last_seen timestamp
);

-- Media
create table if not exists media (
  id uuid primary key default uuid_generate_v4(),
  file_url text not null,
  type text check (type in ('image','video')),
  width int,
  height int,
  created_at timestamp default now()
);

-- Layouts
create table if not exists layouts (
  id uuid primary key default uuid_generate_v4(),
  name text,
  json jsonb
);

-- Playlists
create table if not exists playlists (
  id uuid primary key default uuid_generate_v4(),
  name text,
  created_at timestamp default now()
);

-- Playlist items
create table if not exists playlist_items (
  id serial primary key,
  playlist_id uuid references playlists(id) on delete cascade,
  media_id uuid references media(id) on delete cascade,
  layout_id uuid references layouts(id),
  duration_sec int default 10,
  ordering int
);

-- Screen playlists
create table if not exists screen_playlists (
  screen_id uuid references screens(id) on delete cascade,
  playlist_id uuid references playlists(id) on delete cascade,
  primary key (screen_id, playlist_id)
);

-- Function to get playlist for screen
create or replace function get_playlist_for_screen(p_screen uuid)
returns json as $$
declare
  pl json;
begin
  select json_agg(json_build_object(
    'duration', pi.duration_sec,
    'layout', l.json || jsonb_build_object('id', l.id),
    'mediaId', m.id,
    'url', m.file_url,
    'type', m.type
  ) order by pi.ordering)
  into pl
  from playlist_items pi
  join screen_playlists sp on sp.playlist_id = pi.playlist_id
  join media m on m.id = pi.media_id
  join layouts l on l.id = pi.layout_id
  where sp.screen_id = p_screen;

  return coalesce(pl, '[]'::json);
end;
$$ language plpgsql security definer;

-- Realtime RLS
alter publication supabase_realtime add table playlist_items;
