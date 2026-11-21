create extension if not exists pgcrypto;
do $$ begin create type public.account_plan as enum ('free','premium'); exception when duplicate_object then null; end $$;
do $$ begin create type public.account_status as enum ('active','disabled'); exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 username text unique not null,
 plan public.account_plan not null default 'free',
 status public.account_status not null default 'active',
 is_admin boolean not null default false,
 premium_expires_at timestamptz,
 custom_daily_limit integer check (custom_daily_limit is null or custom_daily_limit >= 0),
 created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists is_admin boolean not null default false;
create table if not exists public.api_keys (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 key_hash text unique not null, key_prefix text not null, is_active boolean not null default true, created_at timestamptz not null default now(), last_used_at timestamptz
);
create table if not exists public.api_categories (id uuid primary key default gen_random_uuid(),name text unique not null,slug text unique not null,sort_order int not null default 0);
create table if not exists public.api_endpoints (
 id uuid primary key default gen_random_uuid(),name text not null,path text unique not null,method text not null check(method in ('GET','POST','PUT','PATCH','DELETE')),
 category text not null,plan text not null check(plan in ('Free','Premium','Both')),description text not null default '',handler text not null,
 is_active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.api_parameters (id uuid primary key default gen_random_uuid(),endpoint_id uuid not null references public.api_endpoints(id) on delete cascade,name text not null,location text not null,required boolean not null default false,schema jsonb not null default '{}'::jsonb);
create table if not exists public.api_examples (id uuid primary key default gen_random_uuid(),endpoint_id uuid not null references public.api_endpoints(id) on delete cascade,kind text not null check(kind in ('request','success','error')),body jsonb not null default '{}'::jsonb);
create table if not exists public.api_usage_daily (user_id uuid not null references public.profiles(id) on delete cascade,usage_date date not null,request_count integer not null default 0,primary key(user_id,usage_date));
create table if not exists public.api_logs (id bigint generated always as identity primary key,user_id uuid references public.profiles(id) on delete set null,endpoint text not null,method text not null,status_code int not null,response_time_ms int not null,ip_address inet,created_at timestamptz not null default now());
create table if not exists public.admin_audit_logs (id bigint generated always as identity primary key,admin_id uuid references public.profiles(id),action text not null,target_user_id uuid references public.profiles(id),metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());
create table if not exists public.site_settings (key text primary key,value jsonb not null default '{}'::jsonb,updated_at timestamptz not null default now());

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.profiles(id,username) values(new.id,coalesce(nullif(new.raw_user_meta_data->>'username',''),'user_'||substr(new.id::text,1,8))) on conflict(id) do nothing;
 return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- Atomic quota reservation prevents parallel requests exceeding the daily allowance.
create or replace function public.consume_api_quota(p_user_id uuid,p_usage_date date,p_daily_limit integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
 if p_daily_limit <= 0 then return jsonb_build_object('allowed',false,'used',0); end if;
 insert into public.api_usage_daily(user_id,usage_date,request_count) values(p_user_id,p_usage_date,1)
 on conflict(user_id,usage_date) do update set request_count=api_usage_daily.request_count+1
 where api_usage_daily.request_count < p_daily_limit
 returning request_count into v_count;
 if v_count is null then return jsonb_build_object('allowed',false,'used',p_daily_limit); end if;
 return jsonb_build_object('allowed',true,'used',v_count);
end; $$;
revoke all on function public.consume_api_quota(uuid,date,integer) from public,anon,authenticated;
grant execute on function public.consume_api_quota(uuid,date,integer) to service_role;

create index if not exists api_logs_created_at_idx on public.api_logs(created_at desc);
create index if not exists api_logs_user_id_idx on public.api_logs(user_id);
create index if not exists api_usage_date_idx on public.api_usage_daily(usage_date);
create index if not exists api_endpoints_active_idx on public.api_endpoints(is_active);

alter table public.profiles enable row level security;
alter table public.api_keys enable row level security;
alter table public.api_usage_daily enable row level security;
alter table public.api_logs enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.api_endpoints enable row level security;
alter table public.api_categories enable row level security;
alter table public.api_parameters enable row level security;
alter table public.api_examples enable row level security;
alter table public.site_settings enable row level security;
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select using(auth.uid()=id);
drop policy if exists "read own api key metadata" on public.api_keys;
create policy "read own api key metadata" on public.api_keys for select using(auth.uid()=user_id);
drop policy if exists "read own daily usage" on public.api_usage_daily;
create policy "read own daily usage" on public.api_usage_daily for select using(auth.uid()=user_id);
drop policy if exists "read own logs" on public.api_logs;
create policy "read own logs" on public.api_logs for select using(auth.uid()=user_id);
drop policy if exists "public read active endpoint docs" on public.api_endpoints;
create policy "public read active endpoint docs" on public.api_endpoints for select using(is_active=true);
drop policy if exists "public read categories" on public.api_categories;
create policy "public read categories" on public.api_categories for select using(true);
drop policy if exists "public read parameters" on public.api_parameters;
create policy "public read parameters" on public.api_parameters for select using(true);
drop policy if exists "public read examples" on public.api_examples;
create policy "public read examples" on public.api_examples for select using(true);
-- Admin writes are exclusively performed by backend service-role routes after verified JWT + profiles.is_admin checks.
