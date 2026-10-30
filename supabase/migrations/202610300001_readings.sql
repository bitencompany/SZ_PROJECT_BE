-- 신규 Supabase 프로젝트에 적용. 회원 식별자는 auth.users.id이며 분석 대상 이름과 분리합니다.
begin;
create table public.reading_requests (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  input jsonb not null check (jsonb_typeof(input) = 'object' and octet_length(input::text) <= 8192),
  catalog_status text not null check (catalog_status in ('preview', 'verified')),
  catalog_version text not null,
  consent_version text not null,
  created_at timestamptz not null default now(),
  unique(id, user_id)
);
create index reading_requests_user_created on public.reading_requests(user_id, created_at desc);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  request_id uuid not null,
  amount integer not null check (amount > 0),
  currency text not null default 'KRW' check (currency = 'KRW'),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
  provider_payment_id text unique,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique(id, user_id),
  foreign key(request_id, user_id) references public.reading_requests(id, user_id),
  check (status <> 'paid' or (paid_at is not null and provider_payment_id is not null))
);
create index orders_user_created on public.orders(user_id, created_at desc);
create unique index orders_one_active_request on public.orders(request_id) where status in ('pending', 'paid');

create table public.readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  order_id uuid not null unique,
  subject_name text not null,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  created_at timestamptz not null default now(),
  foreign key(order_id, user_id) references public.orders(id, user_id)
);
create index readings_user_created on public.readings(user_id, created_at desc);

alter table public.reading_requests enable row level security;
alter table public.orders enable row level security;
alter table public.readings enable row level security;
revoke all on public.reading_requests, public.orders, public.readings from anon, authenticated;
grant select, insert on public.reading_requests to authenticated;
grant select on public.orders, public.readings to authenticated;
grant all on public.reading_requests, public.orders, public.readings to service_role;

create policy request_owner_read on public.reading_requests for select to authenticated using ((select auth.uid()) = user_id);
create policy request_owner_insert on public.reading_requests for insert to authenticated with check ((select auth.uid()) = user_id);
create policy order_owner_read on public.orders for select to authenticated using ((select auth.uid()) = user_id);
create policy paid_reading_owner_read on public.readings for select to authenticated using (
  (select auth.uid()) = user_id and exists (
    select 1 from public.orders where orders.id = readings.order_id and orders.user_id = (select auth.uid()) and orders.status = 'paid'
  )
);
-- 주문 생성·승인·환불·결과 저장은 검증된 BE에서만 service_role로 실행합니다.
-- reading_requests의 내용/카탈로그 표시는 결제 권한의 근거가 아닙니다. BE는 결제 전에 전부 재검증해야 합니다.
commit;
