-- Dipper database. Safe to run again: every statement is idempotent.

create table if not exists products (
  id bigserial primary key,
  url text unique not null,
  store text not null,
  title text,
  image text,
  current_price numeric,
  currency text default 'USD',
  last_checked timestamptz,
  last_error text,
  backfilled_at timestamptz,
  backfill_note text,
  created_at timestamptz default now()
);

create table if not exists prices (
  id bigserial primary key,
  product_id bigint not null references products(id) on delete cascade,
  price numeric not null,
  seen_at timestamptz not null,
  source text not null default 'live',
  unique (product_id, seen_at, source)
);
create index if not exists prices_product_seen_idx on prices (product_id, seen_at);

create table if not exists watches (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  target_price numeric,
  any_drop boolean not null default false,
  added_price numeric,
  last_notified_price numeric,
  created_at timestamptz default now(),
  unique (user_id, product_id)
);

create table if not exists push_subs (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text unique not null,
  sub jsonb not null,
  created_at timestamptz default now()
);

create table if not exists app_config (
  key text primary key,
  value text
);

alter table products enable row level security;
alter table prices enable row level security;
alter table watches enable row level security;
alter table push_subs enable row level security;
alter table app_config enable row level security;

drop policy if exists "read products" on products;
create policy "read products" on products for select to authenticated using (true);

drop policy if exists "read prices" on prices;
create policy "read prices" on prices for select to authenticated using (true);

drop policy if exists "own watches" on watches;
create policy "own watches" on watches for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own push subs" on push_subs;
create policy "own push subs" on push_subs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table products add column if not exists last_browser_check timestamptz;
alter table products add column if not exists ss_id text;
alter table products add column if not exists asin text;
alter table products add column if not exists price_source text;
alter table products add column if not exists hint text;
alter table watches add column if not exists notify_push boolean not null default true;
alter table watches add column if not exists notify_email boolean not null default false;
alter table watches add column if not exists email text;
