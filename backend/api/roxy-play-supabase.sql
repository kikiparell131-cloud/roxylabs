-- Run in Supabase SQL Editor. Create the Storage bucket named roxy-play
-- (private) in Storage UI, or use the dashboard to create the bucket.

create table if not exists public.roxy_play_files (
  id bigint generated always as identity primary key,
  storage_path text not null unique,
  filename text,
  title text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.roxy_play_files add column if not exists filename text;
create unique index if not exists roxy_play_files_filename_idx on public.roxy_play_files (filename) where filename is not null;

create index if not exists roxy_play_files_expires_at_idx
  on public.roxy_play_files (expires_at);

alter table public.roxy_play_files enable row level security;
-- Keep this table inaccessible to anon/authenticated users. Backend uses service role.

create or replace function public.roxy_play_expired_paths()
returns table(storage_path text)
language sql
security definer
set search_path = public
as $$
  select f.storage_path
  from public.roxy_play_files f
  where f.expires_at <= now()
  order by f.expires_at
  limit 500;
$$;
