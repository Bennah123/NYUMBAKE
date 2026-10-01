-- ============================================================
-- Housing App — schema v2
-- Adopted now (cheap today, expensive to retrofit):
--   1. landlord public info split from private verification data
--   2. listing_status enum on properties instead of a bare boolean
--   3. market_areas table to gate launch to Nairobi without hardcoding it
-- Still deliberately NOT built: admin roles, moderation workflow,
-- subscriptions/payments, audit-log tooling beyond what's below.
-- ============================================================

-- ---- Public landlord account row. Anyone can eventually see full_name
-- ---- on a published listing; nothing sensitive lives here. ----
create table if not exists landlords (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text not null unique,
  created_at timestamptz not null default now()
);

-- ---- Private verification data. Strictly landlord-only until an
-- ---- admin role exists — no policy below grants anyone else access. ----
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

-- ---- Launch-area gating. Seed Nairobi now; add counties later
-- ---- without touching the properties table. ----
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

-- ---- One row per rental building/compound. ----
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

-- ---- One row per unit *group* (e.g. "12 bedsitters", "8 one-bedrooms — larger"). ----
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

-- ---- Individual uploaded photos, tagged by required category. ----
create table if not exists unit_photos (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete cascade,
  category text not null,
  is_required boolean not null default true,
  storage_path text not null,
  created_at timestamptz not null default now()
);

-- ---- Every edit to a property/unit gets logged here (append-only). ----
create table if not exists property_audit_log (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  landlord_id uuid not null references landlords(id),
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

-- ----Tenant-facing profile table. ----
create table if not exists tenants (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  created_at timestamptz not null default now()
);
alter table tenants enable row level security;
create policy "tenant reads own profile" on tenants for select using (auth.uid() = id);
create policy "tenant updates own profile" on tenants for update using (auth.uid() = id);
create policy "tenant creates own profile" on tenants for insert with check (auth.uid() = id);

-- ---- Public-facing view of listings, with sensitive landlord info stripped out. ----
create or replace view public_listings as
select
  u.id as unit_id, u.unit_type, u.size_label, u.rent, u.deposit,
  u.water_deposit, u.availability,
  p.id as property_id, p.name as property_name, p.city, p.water_price_per_unit,
  (select storage_path from unit_photos ph where ph.unit_id = u.id order by ph.created_at limit 1) as thumbnail_path,
  p.created_at as listed_at
from units u
join properties p on p.id = u.property_id
where p.listing_status = 'published';

create or replace view public_unit_photos as
select ph.unit_id, ph.category, ph.storage_path
from unit_photos ph
join units u on u.id = ph.unit_id
join properties p on p.id = u.property_id
where p.listing_status = 'published';

grant select on public_unit_photos to anon, authenticated;

create or replace function touch_property_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_property on properties;
create trigger trg_touch_property
before update on properties
for each row execute function touch_property_updated_at();

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

create policy "landlord reads own profile" on landlords
  for select using (auth.uid() = id);
create policy "landlord updates own profile" on landlords
  for update using (auth.uid() = id);
create policy "landlord creates own profile" on landlords
  for insert with check (auth.uid() = id);

create policy "landlord manages own verification" on landlord_verification
  for all using (auth.uid() = landlord_id) with check (auth.uid() = landlord_id);

create policy "anyone reads active market areas" on market_areas
  for select using (active = true);

create policy "landlord manages own properties" on properties
  for all using (auth.uid() = landlord_id) with check (auth.uid() = landlord_id);

create policy "landlord manages own units" on units
  for all using (
    exists (select 1 from properties p where p.id = property_id and p.landlord_id = auth.uid())
  ) with check (
    exists (select 1 from properties p where p.id = property_id and p.landlord_id = auth.uid())
  );

create policy "landlord manages own photos" on unit_photos
  for all using (
    exists (
      select 1 from units u join properties p on p.id = u.property_id
      where u.id = unit_id and p.landlord_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from units u join properties p on p.id = u.property_id
      where u.id = unit_id and p.landlord_id = auth.uid()
    )
  );

create policy "landlord reads own audit log" on property_audit_log
  for select using (auth.uid() = landlord_id);
create policy "landlord writes own audit log" on property_audit_log
  for insert with check (auth.uid() = landlord_id);

-- Public (tenant-facing) read access — scoped to listing_status = 'published',
-- with location/contact fields stripped at the query layer — is the next
-- slice, not part of this schema pass.
