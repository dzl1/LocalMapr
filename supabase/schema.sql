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
    check (credit_type = 'tour')
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

drop policy if exists "Anyone can read published map apps" on public.map_apps;
create policy "Anyone can read published map apps"
on public.map_apps for select
using (status = 'published');

grant usage on schema public to anon, authenticated;
grant select on table public.map_apps to anon, authenticated;

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

create or replace function public.is_super_admin_user(user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles profile
    join public.super_admins admin
      on lower(admin.email) = lower(coalesce(profile.email, ''))
    where profile.id = user_id
      and admin.is_active = true
  );
$$;

create or replace function public.is_paid_map_tour_credit(status text)
returns boolean
language sql
immutable
as $$
  select status in ('paid', 'completed');
$$;

create or replace function public.enforce_map_tour_point_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  point_count integer;
  user_is_admin boolean;
begin
  if new.app_type <> 'map_tour' then
    return new;
  end if;

  user_is_admin := public.is_super_admin_user(new.owner_id);

  if jsonb_typeof(coalesce(new.config, '{}'::jsonb)->'cards') = 'array' then
    point_count := jsonb_array_length(new.config->'cards');
  else
    point_count := 0;
  end if;

  if not user_is_admin then
    if point_count > 4 then
      raise exception 'Map Stories can include up to 4 points.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.consume_map_tour_creation_credit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_tour_count integer;
  tour_credit_id uuid;
  user_is_admin boolean;
begin
  if new.app_type <> 'map_tour' then
    return new;
  end if;

  user_is_admin := public.is_super_admin_user(new.owner_id);

  if user_is_admin then
    return new;
  end if;

  select count(*)
  into existing_tour_count
  from public.map_apps
  where owner_id = new.owner_id
    and app_type = 'map_tour';

  if existing_tour_count <= 2 then
    return new;
  end if;

  select id
  into tour_credit_id
  from public.map_tour_purchases
  where user_id = new.owner_id
    and credit_type = 'tour'
    and used_at is null
    and public.is_paid_map_tour_credit(status)
  order by created_at asc
  limit 1
  for update skip locked;

  if tour_credit_id is null then
    raise exception 'Your 2 free Map Stories are used. Buy a $1 story credit to create another.';
  end if;

  update public.map_tour_purchases
  set used_at = now(),
      used_for_app_id = new.id
  where id = tour_credit_id;

  return new;
end;
$$;

drop trigger if exists map_tour_billing_limits on public.map_apps;
drop function if exists public.enforce_map_tour_billing_limits();
drop trigger if exists map_tour_point_limits on public.map_apps;
create trigger map_tour_point_limits
before insert or update on public.map_apps
for each row execute function public.enforce_map_tour_point_limits();

drop trigger if exists map_tour_creation_credit on public.map_apps;
create trigger map_tour_creation_credit
after insert on public.map_apps
for each row execute function public.consume_map_tour_creation_credit();
