begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;
-- 입력 저장은 BE의 검증/빈도 제한을 반드시 통과해야 합니다.
revoke insert on public.reading_requests from authenticated;
drop policy request_owner_insert on public.reading_requests;

create table private.catalogs (
  version text primary key,
  status text not null check(status in ('preview','verified')),
  metadata jsonb not null,
  created_at timestamptz not null default now()
);
create table private.catalog_entries (
  version text not null references private.catalogs(version),
  id text not null,
  reading text not null,
  entry jsonb not null,
  evidence jsonb not null,
  primary key(version, id)
);
create index catalog_reading on private.catalog_entries(version, reading);
create table private.active_catalog (
  singleton boolean primary key default true check(singleton),
  version text not null references private.catalogs(version)
);
create table private.usage_limits (
  key text not null, bucket bigint not null, count integer not null,
  expires_at timestamptz not null, primary key(key,bucket)
);
create index usage_expiry on private.usage_limits(expires_at);
create table private.previews (
  id uuid primary key default gen_random_uuid(),
  input_hash text not null unique,
  result jsonb not null,
  provider_version text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index preview_expiry on private.previews(expires_at);
create table private.request_metadata (
  request_id uuid primary key references public.reading_requests(id) on delete cascade,
  input_hash text not null,
  preview_id uuid,
  expires_at timestamptz not null default now() + interval '30 days'
);
create table private.products (
  code text primary key,
  title text not null,
  amount integer not null check(amount > 0),
  currency text not null check(currency = 'KRW'),
  active boolean not null default false
);
alter table public.orders add column payment_provider text;
alter table public.orders add column product_code text references private.products(code);
alter table public.orders add column idempotency_key uuid;
alter table public.orders add column generation_status text check(generation_status in ('queued','processing','ready','failed'));
create unique index order_idempotency on public.orders(user_id,idempotency_key);
create table private.order_snapshots (
  order_id uuid primary key references public.orders(id),
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create table private.payment_events (
  provider text not null,
  event_id text not null,
  order_id uuid not null references public.orders(id),
  state text not null,
  created_at timestamptz not null default now(),
  primary key(provider,event_id)
);
create table private.generation_jobs (
  order_id uuid primary key references public.orders(id),
  status text not null default 'queued' check(status in ('queued','processing','ready','failed')),
  attempts integer not null default 0,
  lease_token uuid,
  lease_until timestamptz,
  available_at timestamptz not null default now(),
  last_error text,
  updated_at timestamptz not null default now()
);
create index generation_due on private.generation_jobs(status,available_at);
alter table public.readings add column provenance jsonb not null default '{}'::jsonb;

create function private.reject_update() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'IMMUTABLE_RECORD'; end;
$$;
create trigger immutable_request before update on public.reading_requests for each row execute function private.reject_update();
create trigger immutable_catalog before update on private.catalogs for each row execute function private.reject_update();
create trigger immutable_entry before update on private.catalog_entries for each row execute function private.reject_update();
create trigger immutable_snapshot before update on private.order_snapshots for each row execute function private.reject_update();
revoke all on all tables in schema private from public, anon, authenticated;
grant select,insert,update,delete on all tables in schema private to service_role;
revoke all on all functions in schema private from public, anon, authenticated;
commit;
