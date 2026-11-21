-- Run this once in the Supabase SQL Editor for an existing Roxy deployment.
-- Roles: free, premium, owner. Only the project owner should run the final promotion query.

alter table public.profiles add column if not exists role text not null default 'free';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('free','premium','owner'));

-- Preserve existing admin and Premium accounts.
update public.profiles set role='owner' where is_admin=true;
update public.profiles set role='premium' where is_admin=false and plan='premium' and role='free';
update public.profiles set role='free' where is_admin=false and plan='free' and role='premium';

-- IMPORTANT: replace this with the email address of the actual owner account, then run.
-- This is the only intended way to grant owner from the SQL editor; the web Admin UI cannot create owners.
update public.profiles p
set role='owner', is_admin=true, plan='premium', premium_expires_at=null
from auth.users u
where p.id=u.id and lower(u.email)=lower('YOUR_OWNER_EMAIL@example.com');
