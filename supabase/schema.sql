create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  stripe_customer_id text unique,
  subscription_status text not null default 'free',
  subscription_price_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.map_apps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  slug text not null unique,
  description text,
  app_type text not null default 'map_tour',
  status text not null default 'draft',
  config jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.map_tour_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  map_app_id uuid references public.map_apps(id) on delete set null,
  credit_type text not null,
  stripe_checkout_session_id text not null unique,
  stripe_payment_intent_id text,
  status text not null default 'completed',
  used_at timestamptz,
  used_for_app_id uuid references public.map_apps(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint map_tour_purchases_credit_type_check
    check (credit_type in ('tour', 'points'))
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text not null unique,
  status text not null,
  price_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.super_admins (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  user_id uuid references auth.users(id) on delete set null,
  stripe_customer_id text,
  stripe_subscription_id text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists map_apps_set_updated_at on public.map_apps;
create trigger map_apps_set_updated_at
before update on public.map_apps
for each row execute function public.set_updated_at();

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

drop trigger if exists super_admins_set_updated_at on public.super_admins;
create trigger super_admins_set_updated_at
before update on public.super_admins
for each row execute function public.set_updated_at();

insert into public.super_admins (email)
values ('dave.lasike@live.com')
on conflict (email) do update
set is_active = true;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.super_admins
    where lower(email) = lower(coalesce(auth.jwt()->>'email', ''))
      and is_active = true
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name'
  )
  on conflict (id) do update
  set email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.map_apps enable row level security;
alter table public.map_tour_purchases enable row level security;
alter table public.subscriptions enable row level security;
alter table public.super_admins enable row level security;
alter table public.billing_events enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "Super admins can read all profiles" on public.profiles;
create policy "Super admins can read all profiles"
on public.profiles for select
using (public.is_super_admin());

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "Users can read their own map apps" on public.map_apps;
create policy "Users can read their own map apps"
on public.map_apps for select
using (auth.uid() = owner_id);

drop policy if exists "Super admins can read all map apps" on public.map_apps;
create policy "Super admins can read all map apps"
on public.map_apps for select
using (public.is_super_admin());

drop policy if exists "Users can create their own map apps" on public.map_apps;
create policy "Users can create their own map apps"
on public.map_apps for insert
with check (auth.uid() = owner_id);

drop policy if exists "Users can update their own map apps" on public.map_apps;
create policy "Users can update their own map apps"
on public.map_apps for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "Users can delete their own map apps" on public.map_apps;
create policy "Users can delete their own map apps"
on public.map_apps for delete
using (auth.uid() = owner_id);

drop policy if exists "Users can read their own map tour purchases" on public.map_tour_purchases;
create policy "Users can read their own map tour purchases"
on public.map_tour_purchases for select
using (auth.uid() = user_id);

drop policy if exists "Super admins can read all map tour purchases" on public.map_tour_purchases;
create policy "Super admins can read all map tour purchases"
on public.map_tour_purchases for select
using (public.is_super_admin());

drop policy if exists "Users can read their own subscriptions" on public.subscriptions;
create policy "Users can read their own subscriptions"
on public.subscriptions for select
using (auth.uid() = user_id);

drop policy if exists "Super admins can read all subscriptions" on public.subscriptions;
create policy "Super admins can read all subscriptions"
on public.subscriptions for select
using (public.is_super_admin());

drop policy if exists "Super admins can read super admin records" on public.super_admins;
create policy "Super admins can read super admin records"
on public.super_admins for select
using (public.is_super_admin());

drop policy if exists "Super admins can read billing events" on public.billing_events;
create policy "Super admins can read billing events"
on public.billing_events for select
using (public.is_super_admin());

create index if not exists map_apps_owner_updated_idx
on public.map_apps (owner_id, updated_at desc);

create index if not exists map_tour_purchases_user_created_idx
on public.map_tour_purchases (user_id, created_at desc);

create index if not exists map_tour_purchases_user_credit_used_idx
on public.map_tour_purchases (user_id, credit_type, used_at);

create index if not exists map_tour_purchases_map_app_idx
on public.map_tour_purchases (map_app_id);

create index if not exists subscriptions_user_idx
on public.subscriptions (user_id);

create index if not exists billing_events_created_idx
on public.billing_events (created_at desc);

create index if not exists billing_events_customer_idx
on public.billing_events (stripe_customer_id);
