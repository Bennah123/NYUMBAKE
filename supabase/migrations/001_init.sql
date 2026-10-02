-- ============================================================
-- NYUMBAKE | Security and access-control migration
-- Purpose: harden an EXISTING NYUMBAKE schema (001_init.sql).
-- Run in Supabase SQL Editor after backing up the database.
--
-- This migration assumes the tables from 001_init.sql already exist.
-- It does not drop application data or rebuild tables.
-- Replace the admin email placeholder in Section 02 before running.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 01. Supporting indexes
-- ------------------------------------------------------------
create index if not exists idx_properties_landlord_id
  on public.properties (landlord_id);
create index if not exists idx_properties_market_area_id
  on public.properties (market_area_id);
create index if not exists idx_properties_public_status_created
  on public.properties (listing_status, created_at desc);
create index if not exists idx_units_property_id
  on public.units (property_id);
create index if not exists idx_units_public_browse
  on public.units (availability, unit_type, rent);
create index if not exists idx_unit_photos_unit_id_created
  on public.unit_photos (unit_id, created_at);
create index if not exists idx_enquiries_tenant_created
  on public.enquiries (tenant_id, created_at desc);
create index if not exists idx_enquiries_landlord_created
  on public.enquiries (landlord_id, created_at desc);
create index if not exists idx_viewings_tenant_created
  on public.viewing_requests (tenant_id, created_at desc);
create index if not exists idx_viewings_landlord_created
  on public.viewing_requests (landlord_id, created_at desc);
create index if not exists idx_reports_property_status
  on public.reports (property_id, status);
create index if not exists idx_payments_payer_created
  on public.payments (payer_id, created_at desc);
create index if not exists idx_unlocks_tenant
  on public.contact_unlocks (tenant_id, unit_id);
create index if not exists idx_audit_property_created
  on public.property_audit_log (property_id, created_at desc);

-- ------------------------------------------------------------
-- 02. Single-admin verified-email allowlist
-- ------------------------------------------------------------
-- Add only the exact email used by your Supabase Auth account.
-- Do not add this email through a public app form.
create table if not exists public.admin_emails (
  email text primary key,
  created_at timestamptz not null default now(),
  constraint admin_emails_lowercase check (email = lower(trim(email)))
);

alter table public.admin_emails enable row level security;
revoke all on public.admin_emails from anon, authenticated;

-- No client policies are intentionally created for admin_emails.
-- Add the initial admin email manually in the SQL Editor, e.g.:
insert into public.admin_emails (email)
values (lower(trim('giftben593@gmail.com')));
-- Replace the placeholder; do not execute it unchanged.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from auth.users as u
    join public.admin_emails as a
      on a.email = lower(trim(u.email))
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
  );
$function$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ------------------------------------------------------------
-- 03. Relationship and workflow validation helpers
-- ------------------------------------------------------------
create or replace function public.owns_property(p_property_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.properties p
    where p.id = p_property_id
      and p.landlord_id = (select auth.uid())
  );
$function$;

create or replace function public.valid_property_unit_owner(
  p_property_id uuid, p_unit_id uuid, p_landlord_id uuid
)
returns boolean
language sql stable security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.properties p
    left join public.units u on u.property_id = p.id
    where p.id = p_property_id
      and p.landlord_id = p_landlord_id
      and (
        p_unit_id is null
        or u.id = p_unit_id
      )
  );
$function$;

revoke all on function public.owns_property(uuid) from public, anon;
revoke all on function public.valid_property_unit_owner(uuid, uuid, uuid) from public, anon;
grant execute on function public.owns_property(uuid) to authenticated;
grant execute on function public.valid_property_unit_owner(uuid, uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 04. Prevent users changing protected identity/workflow fields
-- ------------------------------------------------------------
create or replace function public.guard_landlord_profile_update()
returns trigger language plpgsql
set search_path = ''
as $function$
begin
  if (select auth.uid()) is distinct from old.id then
    raise exception 'You may only update your own landlord profile';
  end if;
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'Landlord identity fields cannot be changed';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_landlord_profile_update on public.landlords;
create trigger trg_guard_landlord_profile_update
before update on public.landlords
for each row execute function public.guard_landlord_profile_update();

create or replace function public.guard_tenant_profile_update()
returns trigger language plpgsql
set search_path = ''
as $function$
begin
  if (select auth.uid()) is distinct from old.id then
    raise exception 'You may only update your own tenant profile';
  end if;
  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.created_at is distinct from old.created_at then
    raise exception 'Tenant identity and email are managed by authentication';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_tenant_profile_update on public.tenants;
create trigger trg_guard_tenant_profile_update
before update on public.tenants
for each row execute function public.guard_tenant_profile_update();

create or replace function public.guard_verification_update()
returns trigger language plpgsql
set search_path = ''
as $function$
begin
  -- Trusted service-role calls have no end-user auth.uid(); authenticated
  -- landlords may edit evidence but never the review decision fields.
  if (select auth.uid()) is not null and not public.is_admin() then
    if new.landlord_id is distinct from old.landlord_id
       or new.status is distinct from old.status
       or new.review_notes is distinct from old.review_notes
       or new.reviewed_at is distinct from old.reviewed_at then
      raise exception 'Only an administrator can change verification review fields';
    end if;
    if new.submitted_at is distinct from old.submitted_at
       and new.submitted_at is not null then
      new.submitted_at := now();
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.guard_property_listing_status()
returns trigger language plpgsql
set search_path = ''
as $function$
begin
  -- End-user landlords may save drafts, but only an admin or trusted
  -- server-side service-role function may change publication status.
  if (select auth.uid()) is not null
     and not public.is_admin()
     and new.listing_status is distinct from old.listing_status then
    raise exception 'Only an administrator or trusted server process can change listing status';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_property_listing_status on public.properties;
create trigger trg_guard_property_listing_status
before update on public.properties
for each row execute function public.guard_property_listing_status();

drop trigger if exists trg_guard_verification_update on public.landlord_verification;
create trigger trg_guard_verification_update
before update on public.landlord_verification
for each row execute function public.guard_verification_update();

create or replace function public.guard_enquiry_update()
returns trigger language plpgsql
set search_path = ''
as $function$
begin
  if public.is_admin() then
    return new;
  end if;
  if (select auth.uid()) is distinct from old.landlord_id then
    raise exception 'Only the receiving landlord may respond';
  end if;
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.landlord_id is distinct from old.landlord_id
     or new.property_id is distinct from old.property_id
     or new.unit_id is distinct from old.unit_id
     or new.message is distinct from old.message
     or new.tenant_contact is distinct from old.tenant_contact
     or new.created_at is distinct from old.created_at then
    raise exception 'Enquiry details cannot be changed by the landlord';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_enquiry_update on public.enquiries;
create trigger trg_guard_enquiry_update
before update on public.enquiries
for each row execute function public.guard_enquiry_update();

create or replace function public.guard_viewing_update()
returns trigger language plpgsql
set search_path = ''
as $function$
begin
  if public.is_admin() then
    return new;
  end if;
  if (select auth.uid()) is distinct from old.landlord_id then
    raise exception 'Only the receiving landlord may respond';
  end if;
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.landlord_id is distinct from old.landlord_id
     or new.property_id is distinct from old.property_id
     or new.unit_id is distinct from old.unit_id
     or new.requested_at is distinct from old.requested_at
     or new.tenant_contact is distinct from old.tenant_contact
     or new.created_at is distinct from old.created_at then
    raise exception 'Viewing request details cannot be changed by the landlord';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_viewing_update on public.viewing_requests;
create trigger trg_guard_viewing_update
before update on public.viewing_requests
for each row execute function public.guard_viewing_update();

-- ------------------------------------------------------------
-- 05. RLS enabled and remove original policies safely
-- ------------------------------------------------------------
alter table public.landlords enable row level security;
alter table public.landlord_verification enable row level security;
alter table public.market_areas enable row level security;
alter table public.properties enable row level security;
alter table public.units enable row level security;
alter table public.unit_photos enable row level security;
alter table public.property_audit_log enable row level security;
alter table public.tenants enable row level security;
alter table public.admins enable row level security;
alter table public.enquiries enable row level security;
alter table public.viewing_requests enable row level security;
alter table public.payments enable row level security;
alter table public.contact_unlocks enable row level security;
alter table public.reports enable row level security;

-- Drop named policies from the supplied 001_init.sql so this section
-- can be re-applied without duplicate-policy errors.
drop policy if exists "landlord reads own profile" on public.landlords;
drop policy if exists "landlord updates own profile" on public.landlords;
drop policy if exists "landlord creates own profile" on public.landlords;
drop policy if exists "landlord manages own verification" on public.landlord_verification;
drop policy if exists "anyone reads active market areas" on public.market_areas;
drop policy if exists "landlord manages own properties" on public.properties;
drop policy if exists "landlord manages own units" on public.units;
drop policy if exists "landlord manages own photos" on public.unit_photos;
drop policy if exists "landlord reads own audit log" on public.property_audit_log;
drop policy if exists "landlord writes own audit log" on public.property_audit_log;
drop policy if exists "tenant reads own profile" on public.tenants;
drop policy if exists "tenant updates own profile" on public.tenants;
drop policy if exists "tenant creates own profile" on public.tenants;
drop policy if exists "admin reads own admin row" on public.admins;
drop policy if exists "admin reads all properties" on public.properties;
drop policy if exists "admin reads all units" on public.units;
drop policy if exists "admin reads all unit_photos" on public.unit_photos;
drop policy if exists "admin reads all landlords" on public.landlords;
drop policy if exists "admin reads all landlord_verification" on public.landlord_verification;
drop policy if exists "admin reads all tenants" on public.tenants;
drop policy if exists "admin reads all audit logs" on public.property_audit_log;
drop policy if exists "admin writes audit log" on public.property_audit_log;
drop policy if exists "admin updates any property status" on public.properties;
drop policy if exists "admin reads all payments" on public.payments;
drop policy if exists "admin reads all unlocks" on public.contact_unlocks;
drop policy if exists "user creates own report" on public.reports;
drop policy if exists "user reads own reports" on public.reports;
drop policy if exists "admin reads all reports" on public.reports;
drop policy if exists "admin updates reports" on public.reports;
drop policy if exists "tenant creates own enquiry" on public.enquiries;
drop policy if exists "tenant reads own enquiries" on public.enquiries;
drop policy if exists "landlord reads received enquiries" on public.enquiries;
drop policy if exists "landlord updates received enquiries" on public.enquiries;
drop policy if exists "admin reads all enquiries" on public.enquiries;
drop policy if exists "tenant creates own viewing request" on public.viewing_requests;
drop policy if exists "tenant reads own viewing requests" on public.viewing_requests;
drop policy if exists "landlord reads received viewing requests" on public.viewing_requests;
drop policy if exists "landlord updates received viewing requests" on public.viewing_requests;
drop policy if exists "admin reads all viewing requests" on public.viewing_requests;
drop policy if exists "user reads own payments" on public.payments;
drop policy if exists "tenant reads own unlocks" on public.contact_unlocks;

-- Landlord profiles
create policy "landlord reads own profile" on public.landlords
for select to authenticated using (id = (select auth.uid()) or public.is_admin());
create policy "landlord creates own profile" on public.landlords
for insert to authenticated with check (id = (select auth.uid()));
create policy "landlord updates own profile" on public.landlords
for update to authenticated using (id = (select auth.uid()) or public.is_admin())
with check (id = (select auth.uid()) or public.is_admin());

-- Verification: landlord may submit/update evidence, not approve themselves.
create policy "landlord reads own verification" on public.landlord_verification
for select to authenticated using (landlord_id = (select auth.uid()) or public.is_admin());
create policy "landlord submits own verification" on public.landlord_verification
for insert to authenticated with check (
  landlord_id = (select auth.uid())
  and status in ('unsubmitted', 'pending')
  and review_notes is null
  and reviewed_at is null
);
create policy "landlord updates own verification evidence" on public.landlord_verification
for update to authenticated
using (landlord_id = (select auth.uid()) or public.is_admin())
with check (landlord_id = (select auth.uid()) or public.is_admin());
create policy "admin deletes verification if required" on public.landlord_verification
for delete to authenticated using (public.is_admin());

-- Public can read active market areas; only admins can manage them.
create policy "public reads active market areas" on public.market_areas
for select to anon, authenticated using (active = true or public.is_admin());
create policy "admin manages market areas" on public.market_areas
for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Properties: owners manage their own records; admin moderation is separate.
create policy "landlord reads own properties" on public.properties
for select to authenticated using (landlord_id = (select auth.uid()) or public.is_admin());
create policy "landlord creates own draft properties" on public.properties
for insert to authenticated with check (
  landlord_id = (select auth.uid()) and listing_status = 'draft'
);
create policy "landlord updates own properties" on public.properties
for update to authenticated
using (landlord_id = (select auth.uid()) or public.is_admin())
with check (landlord_id = (select auth.uid()) or public.is_admin());
create policy "landlord deletes own draft properties" on public.properties
for delete to authenticated using (
  (landlord_id = (select auth.uid()) and listing_status = 'draft')
  or public.is_admin()
);
create policy "admin moderates properties" on public.properties
for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Units and photos: ownership is derived through the property relationship.
create policy "owners read units" on public.units
for select to authenticated using (
  exists (select 1 from public.properties p where p.id = property_id and p.landlord_id = (select auth.uid()))
  or public.is_admin()
);
create policy "owners create units" on public.units
for insert to authenticated with check (
  exists (select 1 from public.properties p where p.id = property_id and p.landlord_id = (select auth.uid()))
);
create policy "owners update units" on public.units
for update to authenticated
using (exists (select 1 from public.properties p where p.id = property_id and p.landlord_id = (select auth.uid())) or public.is_admin())
with check (exists (select 1 from public.properties p where p.id = property_id and p.landlord_id = (select auth.uid())) or public.is_admin());
create policy "owners delete units" on public.units
for delete to authenticated using (
  exists (select 1 from public.properties p where p.id = property_id and p.landlord_id = (select auth.uid()))
  or public.is_admin()
);

create policy "owners read unit photos" on public.unit_photos
for select to authenticated using (
  exists (select 1 from public.units u join public.properties p on p.id = u.property_id
          where u.id = unit_id and p.landlord_id = (select auth.uid()))
  or public.is_admin()
);
create policy "owners add unit photos" on public.unit_photos
for insert to authenticated with check (
  exists (select 1 from public.units u join public.properties p on p.id = u.property_id
          where u.id = unit_id and p.landlord_id = (select auth.uid()))
);
create policy "owners update unit photos" on public.unit_photos
for update to authenticated
using (exists (select 1 from public.units u join public.properties p on p.id = u.property_id
              where u.id = unit_id and p.landlord_id = (select auth.uid())) or public.is_admin())
with check (exists (select 1 from public.units u join public.properties p on p.id = u.property_id
                    where u.id = unit_id and p.landlord_id = (select auth.uid())) or public.is_admin());
create policy "owners delete unit photos" on public.unit_photos
for delete to authenticated using (
  exists (select 1 from public.units u join public.properties p on p.id = u.property_id
          where u.id = unit_id and p.landlord_id = (select auth.uid()))
  or public.is_admin()
);

-- Audit log: landlords may read their own; clients cannot forge log entries.
create policy "owners read audit log" on public.property_audit_log
for select to authenticated using (landlord_id = (select auth.uid()) or public.is_admin());
create policy "admin reads all audit logs" on public.property_audit_log
for select to authenticated using (public.is_admin());
-- Inserts are reserved for trusted server-side code / service role.
create policy "admin inserts audit log" on public.property_audit_log
for insert to authenticated with check (public.is_admin());

-- Tenant profiles
create policy "tenant reads own profile" on public.tenants
for select to authenticated using (id = (select auth.uid()) or public.is_admin());
create policy "tenant creates own profile" on public.tenants
for insert to authenticated with check (id = (select auth.uid()));
create policy "tenant updates own profile" on public.tenants
for update to authenticated using (id = (select auth.uid()) or public.is_admin())
with check (id = (select auth.uid()) or public.is_admin());

-- Retain admins table only for legacy compatibility; no client writes.
create policy "admin reads own legacy row" on public.admins
for select to authenticated using (id = (select auth.uid()) and public.is_admin());

-- Enquiries: validated identity and linked property/unit on insert.
create policy "tenant creates own enquiry" on public.enquiries
for insert to authenticated with check (
  tenant_id = (select auth.uid())
  and exists (select 1 from public.tenants t where t.id = tenant_id)
  and exists (
    select 1 from public.properties p
    where p.id = property_id and p.landlord_id = landlord_id
      and p.listing_status = 'published'
  )
  and (unit_id is null or exists (
    select 1 from public.units u where u.id = unit_id and u.property_id = property_id
  ))
);
create policy "tenant reads own enquiries" on public.enquiries
for select to authenticated using (tenant_id = (select auth.uid()) or public.is_admin());
create policy "landlord reads received enquiries" on public.enquiries
for select to authenticated using (landlord_id = (select auth.uid()) or public.is_admin());
create policy "landlord responds to received enquiries" on public.enquiries
for update to authenticated
using (landlord_id = (select auth.uid()) or public.is_admin())
with check (landlord_id = (select auth.uid()) or public.is_admin());

-- Viewing requests: same relationship validation.
create policy "tenant creates own viewing request" on public.viewing_requests
for insert to authenticated with check (
  tenant_id = (select auth.uid())
  and exists (select 1 from public.tenants t where t.id = tenant_id)
  and exists (
    select 1 from public.properties p
    where p.id = property_id and p.landlord_id = landlord_id
      and p.listing_status = 'published'
  )
  and (unit_id is null or exists (
    select 1 from public.units u where u.id = unit_id and u.property_id = property_id
  ))
);
create policy "tenant reads own viewing requests" on public.viewing_requests
for select to authenticated using (tenant_id = (select auth.uid()) or public.is_admin());
create policy "landlord reads received viewing requests" on public.viewing_requests
for select to authenticated using (landlord_id = (select auth.uid()) or public.is_admin());
create policy "landlord responds to viewing requests" on public.viewing_requests
for update to authenticated
using (landlord_id = (select auth.uid()) or public.is_admin())
with check (landlord_id = (select auth.uid()) or public.is_admin());

-- Reports: reporter may submit and read own reports; only admin resolves.
create policy "user creates own report" on public.reports
for insert to authenticated with check (
  reporter_id = (select auth.uid())
  and exists (select 1 from public.properties p where p.id = property_id and p.listing_status = 'published')
);
create policy "user reads own reports" on public.reports
for select to authenticated using (reporter_id = (select auth.uid()) or public.is_admin());
create policy "admin reads all reports" on public.reports
for select to authenticated using (public.is_admin());
create policy "admin updates reports" on public.reports
for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Payments and contact unlocks: clients read own rows only; server writes.
create policy "user reads own payments" on public.payments
for select to authenticated using (payer_id = (select auth.uid()) or public.is_admin());
create policy "tenant reads own unlocks" on public.contact_unlocks
for select to authenticated using (tenant_id = (select auth.uid()) or public.is_admin());

-- ------------------------------------------------------------
-- 06. Public listing views: expose only tenant-facing fields
-- ------------------------------------------------------------

-- Remove the existing view so its column structure can be changed.
-- This does not delete property or unit records.
drop view if exists public.public_listings;

-- Recreate it with the updated tenant-facing columns.
create view public.public_listings
with (security_invoker = true) as
select
  u.id as unit_id,
  u.unit_type,
  u.size_label,
  u.rent,
  u.deposit,
  u.water_deposit,
  u.availability,
  p.id as property_id,
  p.name as property_name,
  p.city,
  p.estate,
  p.water_price_per_unit,
  (
    select ph.storage_path
    from public.unit_photos ph
    where ph.unit_id = u.id
      and ph.media_type = 'image'
    order by ph.created_at, ph.id
    limit 1
  ) as thumbnail_path,
  p.created_at as listed_at
from public.units u
join public.properties p on p.id = u.property_id
where p.listing_status = 'published';

create or replace view public.public_unit_photos
with (security_invoker = true) as
select ph.unit_id, ph.category, ph.storage_path, ph.media_type
from public.unit_photos ph
join public.units u on u.id = ph.unit_id
join public.properties p on p.id = u.property_id
where p.listing_status = 'published';

grant select on public.public_listings to anon, authenticated;
grant select on public.public_unit_photos to anon, authenticated;

-- For security_invoker views, underlying RLS must permit public rows.
-- Public SELECT policies expose published property/unit/photo records only.
drop policy if exists "public reads published properties" on public.properties;
create policy "public reads published properties" on public.properties
for select to anon, authenticated using (listing_status = 'published' or public.is_admin()
  or landlord_id = (select auth.uid()));

drop policy if exists "public reads published units" on public.units;
create policy "public reads published units" on public.units
for select to anon, authenticated using (
  exists (select 1 from public.properties p
          where p.id = property_id and p.listing_status = 'published')
  or exists (select 1 from public.properties p
             where p.id = property_id and p.landlord_id = (select auth.uid()))
  or public.is_admin()
);

drop policy if exists "public reads published unit photos" on public.unit_photos;
create policy "public reads published unit photos" on public.unit_photos
for select to anon, authenticated using (
  exists (select 1 from public.units u join public.properties p on p.id = u.property_id
          where u.id = unit_id and p.listing_status = 'published')
  or exists (select 1 from public.units u join public.properties p on p.id = u.property_id
             where u.id = unit_id and p.landlord_id = (select auth.uid()))
  or public.is_admin()
);

-- ------------------------------------------------------------
-- 07. Contact reveal: require a completed matching payment
-- ------------------------------------------------------------
create or replace function public.get_unlocked_contact(p_unit_id uuid)
returns table (contact_phone text, estate text, lat double precision, lng double precision)
language sql
stable
security definer
set search_path = ''
as $function$
  select p.contact_phone, p.estate, p.lat, p.lng
  from public.units u
  join public.properties p on p.id = u.property_id
  where u.id = p_unit_id
    and (select auth.uid()) is not null
    and exists (
      select 1
      from public.contact_unlocks cu
      join public.payments pay on pay.id = cu.payment_id
      where cu.unit_id = p_unit_id
        and cu.tenant_id = (select auth.uid())
        and pay.payer_id = (select auth.uid())
        and pay.purpose = 'contact_reveal'
        and pay.status = 'completed'
        and pay.unit_id = p_unit_id
    );
$function$;

revoke all on function public.get_unlocked_contact(uuid) from public, anon;
grant execute on function public.get_unlocked_contact(uuid) to authenticated;

-- ------------------------------------------------------------
-- 08. Storage policies
-- ------------------------------------------------------------
drop policy if exists "public reads property photos" on storage.objects;
drop policy if exists "landlords upload own property photos" on storage.objects;
drop policy if exists "landlords update own property photos" on storage.objects;
drop policy if exists "landlords delete own property photos" on storage.objects;

create policy "public reads property photos" on storage.objects
for select to anon, authenticated
using (bucket_id = 'property-photos');

create policy "landlords upload own property photos" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'property-photos'
  and exists (
    select 1 from public.properties p
    where p.id::text = (storage.foldername(name))[1]
      and p.landlord_id = (select auth.uid())
  )
);

create policy "landlords update own property photos" on storage.objects
for update to authenticated
using (
  bucket_id = 'property-photos'
  and exists (
    select 1 from public.properties p
    where p.id::text = (storage.foldername(name))[1]
      and p.landlord_id = (select auth.uid())
  )
)
with check (
  bucket_id = 'property-photos'
  and exists (
    select 1 from public.properties p
    where p.id::text = (storage.foldername(name))[1]
      and p.landlord_id = (select auth.uid())
  )
);

create policy "landlords delete own property photos" on storage.objects
for delete to authenticated
using (
  bucket_id = 'property-photos'
  and exists (
    select 1 from public.properties p
    where p.id::text = (storage.foldername(name))[1]
      and p.landlord_id = (select auth.uid())
  )
);

-- ------------------------------------------------------------
-- 09. Final grants: no direct client writes to sensitive tables
-- ------------------------------------------------------------
revoke all on public.admin_emails from anon, authenticated;
revoke insert, update, delete on public.payments from anon, authenticated;
revoke insert, update, delete on public.contact_unlocks from anon, authenticated;
revoke insert, update, delete on public.property_audit_log from anon, authenticated;

commit;

-- ============================================================
-- POST-MIGRATION CHECKS (run separately after replacing admin email)
-- ============================================================
-- 1) Confirm admin function exists:
-- select public.is_admin();
--
-- 2) Confirm RLS is enabled:
-- select schemaname, tablename, rowsecurity
-- from pg_tables
-- where schemaname = 'public'
-- order by tablename;
--
-- 3) Confirm policies:
-- select tablename, policyname, cmd, roles
-- from pg_policies
-- where schemaname = 'public'
-- order by tablename, policyname;
--
-- IMPORTANT IMPLEMENTATION NOTES:
-- - This migration assumes the base tables already exist.
-- - Add the initial verified admin email manually in the SQL Editor.
-- - Supabase service-role Edge Functions bypass RLS; validate all input
--   and verify payment callbacks in those functions.
-- - Review application inserts against required columns and RLS checks.
-- - Public views use security_invoker and therefore depend on the public
--   SELECT policies included above.
