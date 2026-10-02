-- ============================================================
-- NYUMBAKE — consolidated schema
-- Run this once in the Supabase SQL Editor, top to bottom.
-- Safe to re-run: every statement uses if-not-exists / or-replace.
-- ============================================================

-- ---------- Landlords ----------
create table if not exists landlords (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists landlord_verification (
  landlord_id uuid primary key references landlords(id) on delete cascade,
  id_number text,
  kra_pin text,
  proof_of_ownership_url text,
  status text not null default 'unsubmitted'
    check (status in ('unsubmitted','pending','approved','rejected')),
  review_notes text,
  submitted_at timestamptz,
  reviewed_at timestamptz
);

-- ---------- Launch-area gating ----------
create table if not exists market_areas (
  id uuid primary key default gen_random_uuid(),
  county text not null,
  sub_county text,
  neighbourhood text,
  active boolean not null default true,
  launch_available boolean not null default true,
  created_at timestamptz not null default now()
);
insert into market_areas (county, sub_county, neighbourhood)
select 'Nairobi', null, null
where not exists (select 1 from market_areas where county = 'Nairobi' and sub_county is null and neighbourhood is null);

-- ---------- Properties & units ----------
create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references landlords(id) on delete cascade,
  market_area_id uuid references market_areas(id),
  name text not null,
  city text not null,
  estate text not null,
  lat double precision,
  lng double precision,
  contact_phone text not null,
  water_price_per_unit numeric(10,2),
  listing_status text not null default 'draft'
    check (listing_status in ('draft','published','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists units (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  unit_type text not null check (unit_type in (
    'single_room','double_room','bedsitter',
    'one_bedroom','two_bedroom','three_bedroom'
  )),
  size_label text,
  quantity int not null check (quantity > 0),
  rent numeric(10,2) not null,
  deposit numeric(10,2) not null,
  water_deposit numeric(10,2),
  availability text not null default 'vacant' check (availability in ('vacant','rented')),
  availability_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists unit_photos (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete cascade,
  category text not null,
  is_required boolean not null default true,
  storage_path text not null,
  media_type text not null default 'image' check (media_type in ('image','video')),
  created_at timestamptz not null default now()
);

create table if not exists property_audit_log (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  landlord_id uuid references landlords(id),
  actor_id uuid references auth.users(id),
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create or replace function touch_property_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists trg_touch_property on properties;
create trigger trg_touch_property before update on properties
for each row execute function touch_property_updated_at();

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

-- ---------- Tenants ----------
create table if not exists tenants (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  created_at timestamptz not null default now()
);

-- ---------- Admins ----------
-- No insert/update policy for ordinary users anywhere in this file —
-- admin status is only grantable by inserting a row directly via the
-- Supabase dashboard (Table Editor or SQL Editor), never through the app.
create table if not exists admins (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function is_admin() returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (select 1 from admins where id = auth.uid());
$$;

-- ---------- Enquiries & viewing requests ----------
create table if not exists enquiries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  landlord_id uuid not null references landlords(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  unit_id uuid references units(id),
  message text not null,
  tenant_contact text,
  status text not null default 'new' check (status in ('new','responded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_touch_enquiries on enquiries;
create trigger trg_touch_enquiries before update on enquiries
for each row execute function touch_updated_at();

create table if not exists viewing_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  landlord_id uuid not null references landlords(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  unit_id uuid references units(id),
  requested_at timestamptz not null,
  tenant_contact text,
  status text not null default 'pending' check (status in ('pending','confirmed','declined')),
  response text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_touch_viewing_requests on viewing_requests;
create trigger trg_touch_viewing_requests before update on viewing_requests
for each row execute function touch_updated_at();

-- ---------- Reports ----------
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  reason text not null check (reason in ('inaccurate_info','scam_suspected','already_rented','inappropriate_content','other')),
  description text,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolution_notes text,
  resolved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- ---------- Payments & contact unlocks ----------
-- No insert/update policy for ordinary users — payments are only ever
-- written by the mpesa-stk-push / mpesa-callback Edge Functions
-- (service-role key, bypasses RLS). A client claiming "completed"
-- must never be trusted.
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  payer_id uuid not null references auth.users(id),
  purpose text not null check (purpose in ('property_publish', 'contact_reveal')),
  property_id uuid references properties(id),
  unit_id uuid references units(id),
  amount numeric(10,2) not null,
  currency text not null default 'KES',
  provider text not null default 'mpesa',
  checkout_request_id text unique,
  merchant_request_id text,
  provider_receipt text,
  status text not null default 'pending' check (status in ('pending','completed','failed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_touch_payments on payments;
create trigger trg_touch_payments before update on payments
for each row execute function touch_updated_at();

create table if not exists contact_unlocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  payment_id uuid references payments(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, unit_id)
);

create or replace function get_unlocked_contact(p_unit_id uuid)
returns table (contact_phone text, estate text, lat double precision, lng double precision)
language sql security definer stable
set search_path = public
as $$
  select p.contact_phone, p.estate, p.lat, p.lng
  from units u join properties p on p.id = u.property_id
  where u.id = p_unit_id
    and exists (select 1 from contact_unlocks cu where cu.unit_id = p_unit_id and cu.tenant_id = auth.uid());
$$;
grant execute on function get_unlocked_contact(uuid) to authenticated;

-- ============================================================
-- Row Level Security
-- ============================================================
alter table landlords enable row level security;
alter table landlord_verification enable row level security;
alter table market_areas enable row level security;
alter table properties enable row level security;
alter table units enable row level security;
alter table unit_photos enable row level security;
alter table property_audit_log enable row level security;
alter table tenants enable row level security;
alter table admins enable row level security;
alter table enquiries enable row level security;
alter table viewing_requests enable row level security;
alter table payments enable row level security;
alter table contact_unlocks enable row level security;
alter table reports enable row level security;

-- Landlord-owner policies
create policy "landlord reads own profile" on landlords for select using (auth.uid() = id);
create policy "landlord updates own profile" on landlords for update using (auth.uid() = id);
create policy "landlord creates own profile" on landlords for insert with check (auth.uid() = id);
create policy "landlord manages own verification" on landlord_verification for all using (auth.uid() = landlord_id) with check (auth.uid() = landlord_id);
create policy "anyone reads active market areas" on market_areas for select using (active = true);
create policy "landlord manages own properties" on properties for all using (auth.uid() = landlord_id) with check (auth.uid() = landlord_id);
create policy "landlord manages own units" on units for all using (
  exists (select 1 from properties p where p.id = property_id and p.landlord_id = auth.uid())
) with check (
  exists (select 1 from properties p where p.id = property_id and p.landlord_id = auth.uid())
);
create policy "landlord manages own photos" on unit_photos for all using (
  exists (select 1 from units u join properties p on p.id = u.property_id where u.id = unit_id and p.landlord_id = auth.uid())
) with check (
  exists (select 1 from units u join properties p on p.id = u.property_id where u.id = unit_id and p.landlord_id = auth.uid())
);
create policy "landlord reads own audit log" on property_audit_log for select using (auth.uid() = landlord_id);
create policy "landlord writes own audit log" on property_audit_log for insert with check (auth.uid() = landlord_id or auth.uid() = actor_id);

-- Tenant policies
create policy "tenant reads own profile" on tenants for select using (auth.uid() = id);
create policy "tenant updates own profile" on tenants for update using (auth.uid() = id);
create policy "tenant creates own profile" on tenants for insert with check (auth.uid() = id);

-- Admin self-check
create policy "admin reads own admin row" on admins for select using (auth.uid() = id);

-- Admin elevated access
create policy "admin reads all properties" on properties for select using (is_admin());
create policy "admin reads all units" on units for select using (is_admin());
create policy "admin reads all unit_photos" on unit_photos for select using (is_admin());
create policy "admin reads all landlords" on landlords for select using (is_admin());
create policy "admin reads all landlord_verification" on landlord_verification for select using (is_admin());
create policy "admin reads all tenants" on tenants for select using (is_admin());
create policy "admin reads all audit logs" on property_audit_log for select using (is_admin());
create policy "admin writes audit log" on property_audit_log for insert with check (is_admin());
create policy "admin updates any property status" on properties for update using (is_admin()) with check (is_admin());
create policy "admin reads all payments" on payments for select using (is_admin());
create policy "admin reads all unlocks" on contact_unlocks for select using (is_admin());

create policy "user creates own report" on reports for insert with check (auth.uid() = reporter_id);
create policy "user reads own reports" on reports for select using (auth.uid() = reporter_id);
create policy "admin reads all reports" on reports for select using (is_admin());
create policy "admin updates reports" on reports for update using (is_admin()) with check (is_admin());

-- Enquiries / viewing requests
create policy "tenant creates own enquiry" on enquiries for insert with check (auth.uid() = tenant_id);
create policy "tenant reads own enquiries" on enquiries for select using (auth.uid() = tenant_id);
create policy "landlord reads received enquiries" on enquiries for select using (auth.uid() = landlord_id);
create policy "landlord updates received enquiries" on enquiries for update using (auth.uid() = landlord_id) with check (auth.uid() = landlord_id);
create policy "admin reads all enquiries" on enquiries for select using (is_admin());

create policy "tenant creates own viewing request" on viewing_requests for insert with check (auth.uid() = tenant_id);
create policy "tenant reads own viewing requests" on viewing_requests for select using (auth.uid() = tenant_id);
create policy "landlord reads received viewing requests" on viewing_requests for select using (auth.uid() = landlord_id);
create policy "landlord updates received viewing requests" on viewing_requests for update using (auth.uid() = landlord_id) with check (auth.uid() = landlord_id);
create policy "admin reads all viewing requests" on viewing_requests for select using (is_admin());

-- Payments / unlocks: user reads own only; no write policy for anyone client-side
create policy "user reads own payments" on payments for select using (auth.uid() = payer_id);
create policy "tenant reads own unlocks" on contact_unlocks for select using (auth.uid() = tenant_id);

-- ============================================================
-- Tenant-facing views (bypass RLS by ownership, filtered explicitly)
-- ============================================================
create or replace view public_listings as
select
  u.id as unit_id, u.unit_type, u.size_label, u.rent, u.deposit,
  u.water_deposit, u.availability,
  p.id as property_id, p.name as property_name, p.city, p.water_price_per_unit,
  (select storage_path from unit_photos ph
     where ph.unit_id = u.id and ph.media_type = 'image'
     order by ph.created_at limit 1) as thumbnail_path,
  p.created_at as listed_at,
  p.landlord_id
from units u join properties p on p.id = u.property_id
where p.listing_status = 'published';

create or replace view public_unit_photos as
select ph.unit_id, ph.category, ph.storage_path, ph.media_type
from unit_photos ph
join units u on u.id = ph.unit_id
join properties p on p.id = u.property_id
where p.listing_status = 'published';

grant select on public_listings to anon, authenticated;
grant select on public_unit_photos to anon, authenticated;

-- ============================================================
-- Storage policies — property-photos bucket
-- Create the bucket itself first via Storage → New bucket
-- (name: property-photos, Public: ON) — can't be done from SQL.
-- ============================================================
create policy "public reads property photos" on storage.objects
  for select using (bucket_id = 'property-photos');

-- Ownership-checked: a landlord can only write into the folder for a
-- property they actually own. property-upload.html creates an empty
-- draft properties row before any photo upload starts, specifically
-- so this check has something to match against from the first upload.
create policy "landlords upload own property photos" on storage.objects
  for insert with check (
    bucket_id = 'property-photos'
    and exists (select 1 from properties p where p.id::text = (storage.foldername(name))[1] and p.landlord_id = auth.uid())
  );
create policy "landlords update own property photos" on storage.objects
  for update using (
    bucket_id = 'property-photos'
    and exists (select 1 from properties p where p.id::text = (storage.foldername(name))[1] and p.landlord_id = auth.uid())
  );
create policy "landlords delete own property photos" on storage.objects
  for delete using (
    bucket_id = 'property-photos'
    and exists (select 1 from properties p where p.id::text = (storage.foldername(name))[1] and p.landlord_id = auth.uid())
  );