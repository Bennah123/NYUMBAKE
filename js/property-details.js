import { supabase, PHOTO_REQUIREMENTS } from './supabase-client.js';

const params = new URLSearchParams(window.location.search);
const unitId = params.get('unit');

const loadingEl = document.getElementById('loading-state');
const notFoundEl = document.getElementById('not-found-state');
const contentEl = document.getElementById('details-content');

function showNotFound() {
  loadingEl.style.display = 'none';
  notFoundEl.style.display = 'block';
}

let currentListing = null;

function render(listing, photos) {
  currentListing = listing;
  loadingEl.style.display = 'none';
  contentEl.style.display = 'block';

  document.title = `${listing.property_name} | NYUMBAKE`;

  const typeLabel = PHOTO_REQUIREMENTS[listing.unit_type]?.label || listing.unit_type;
  document.getElementById('unit-type-tag').textContent =
    typeLabel + (listing.size_label ? ` · ${listing.size_label}` : '');
  document.getElementById('property-name').textContent = listing.property_name;
  document.getElementById('property-city').textContent = listing.city;

  const rent = Number(listing.rent);
  document.getElementById('rent-amount').textContent = Number.isFinite(rent)
    ? `KES ${rent.toLocaleString('en-KE')}`
    : 'Rent not specified';

  const lines = [`Deposit: KES ${Number(listing.deposit).toLocaleString('en-KE')}`];
  if (listing.water_deposit) lines.push(`Water deposit: KES ${Number(listing.water_deposit).toLocaleString('en-KE')}`);
  if (listing.water_price_per_unit) lines.push(`Water: KES ${Number(listing.water_price_per_unit).toLocaleString('en-KE')}/unit`);
  document.getElementById('detail-lines').textContent = lines.join(' · ');

  if (listing.availability !== 'vacant') {
    const banner = document.getElementById('availability-banner');
    banner.textContent = 'This unit has already been rented.';
    banner.className = 'status-msg error';
    banner.style.display = 'block';
  }

  const gallery = document.getElementById('gallery');
  gallery.innerHTML = '';
  if (photos.length === 0) {
    gallery.style.display = 'block';
    gallery.innerHTML = '<p style="padding:20px;color:var(--muted)">No photos uploaded yet.</p>';
  } else {
    photos.forEach((p) => {
      const { data } = supabase.storage.from('property-photos').getPublicUrl(p.storage_path);
      if (p.media_type === 'video') {
        const video = document.createElement('video');
        video.src = data.publicUrl;
        video.controls = true;
        video.preload = 'metadata';
        gallery.appendChild(video);
      } else {
        const img = document.createElement('img');
        img.src = data.publicUrl;
        img.alt = p.category.replace(/_/g, ' ');
        img.loading = 'lazy';
        gallery.appendChild(img);
      }
    });
  }
}

async function load() {
  if (!unitId) return showNotFound();

  const { data: listing, error } = await supabase
    .from('public_listings')
    .select('*')
    .eq('unit_id', unitId)
    .maybeSingle();

  if (error || !listing) return showNotFound();

  const { data: photos } = await supabase
    .from('public_unit_photos')
    .select('category, storage_path, media_type')
    .eq('unit_id', unitId);

  render(listing, photos || []);
}

document.getElementById('enquiry-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById('enquiry-status');
  const showEnquiryStatus = (msg, type) => {
    statusEl.textContent = msg;
    statusEl.className = `status-msg ${type}`;
    statusEl.style.display = 'block';
  };

  if (!currentListing) return;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const here = window.location.pathname + window.location.search;
    window.location.href = `tenant-signup.html?redirect=${encodeURIComponent(here)}`;
    return;
  }

  const message = document.getElementById('enq_message').value.trim();
  const tenant_contact = document.getElementById('enq_contact').value.trim() || null;
  const viewingTimeRaw = document.getElementById('enq_viewing_time').value;

  if (!message) return showEnquiryStatus('Write a message first.', 'error');

  // Make sure a tenant profile row exists (covers OAuth sign-ins that
  // bounced straight back here before ever hitting tenant-signup.html's
  // own profile-creation step).
  await supabase.from('tenants').upsert({
    id: user.id,
    full_name: user.user_metadata?.full_name || user.email,
    email: user.email,
  });

  const { error: enqError } = await supabase.from('enquiries').insert({
    tenant_id: user.id,
    landlord_id: currentListing.landlord_id,
    property_id: currentListing.property_id,
    unit_id: currentListing.unit_id,
    message,
    tenant_contact,
  });
  if (enqError) return showEnquiryStatus(enqError.message, 'error');

  if (viewingTimeRaw) {
    const { error: viewError } = await supabase.from('viewing_requests').insert({
      tenant_id: user.id,
      landlord_id: currentListing.landlord_id,
      property_id: currentListing.property_id,
      unit_id: currentListing.unit_id,
      requested_at: new Date(viewingTimeRaw).toISOString(),
      tenant_contact,
    });
    if (viewError) return showEnquiryStatus(viewError.message, 'error');
  }

  document.getElementById('enquiry-form').reset();
  showEnquiryStatus('Sent — the landlord will see this in their dashboard.', 'ok');
});

document.getElementById('contact-btn').addEventListener('click', () => {
  const status = document.getElementById('contact-status');
  status.textContent = "Unlocking contact details isn't available yet — check back soon.";
  status.style.display = 'block';
});

load();