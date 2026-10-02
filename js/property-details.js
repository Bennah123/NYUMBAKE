import { supabase, PHOTO_REQUIREMENTS, initiateMpesaPayment, pollPaymentStatus } from './supabase-client.js';

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
  checkExistingUnlock();
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

function showUnlockedContact(contact) {
  const panel = document.querySelector('.contact-panel');
  const result = document.createElement('div');
  result.style.cssText = 'margin-top:16px; padding:14px; background:var(--surface-soft); border-radius:10px; font-size:14px;';
  result.innerHTML = `
    <div style="font-weight:600; margin-bottom:6px;">Contact &amp; location unlocked</div>
    <div>Estate: ${contact.estate}</div>
    <div>Phone: ${contact.contact_phone}</div>
    ${contact.lat && contact.lng ? `<a href="https://maps.google.com/?q=${contact.lat},${contact.lng}" target="_blank" rel="noopener">View on Google Maps</a>` : ''}
  `;
  document.getElementById('contact-btn').style.display = 'none';
  panel.insertBefore(result, panel.querySelector('div[style*="border-top"]'));
}

async function checkExistingUnlock() {
  if (!currentListing) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data } = await supabase.rpc('get_unlocked_contact', { p_unit_id: currentListing.unit_id });
  if (data && data.length > 0) showUnlockedContact(data[0]);
}

document.getElementById('report-toggle').addEventListener('click', () => {
  const form = document.getElementById('report-form');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('report-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById('report-status');
  const showReportStatus = (msg, type) => {
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

  const reason = document.getElementById('report-reason').value;
  const description = document.getElementById('report-description').value.trim() || null;

  const { error } = await supabase.from('reports').insert({
    reporter_id: user.id,
    property_id: currentListing.property_id,
    reason,
    description,
  });
  if (error) return showReportStatus(error.message, 'error');

  document.getElementById('report-form').reset();
  document.getElementById('report-form').style.display = 'none';
  showReportStatus('Thanks — we\'ll take a look.', 'ok');
});

document.getElementById('contact-btn').addEventListener('click', async () => {
  const status = document.getElementById('contact-status');
  const showContactStatus = (msg, type) => {
    status.textContent = msg;
    status.className = `status-msg ${type}`;
    status.style.display = 'block';
  };

  if (!currentListing) return;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const here = window.location.pathname + window.location.search;
    window.location.href = `tenant-signup.html?redirect=${encodeURIComponent(here)}`;
    return;
  }

  const phone = prompt('M-Pesa number to pay KES 50 and unlock contact details:', '');
  if (!phone) return;

  try {
    showContactStatus('Starting payment…', 'ok');
    const { paymentId } = await initiateMpesaPayment('contact_reveal', { unitId: currentListing.unit_id, phone });
    showContactStatus('Check your phone and enter your M-Pesa PIN.', 'ok');
    const result = await pollPaymentStatus(paymentId);

    if (result === 'completed') {
      const { data } = await supabase.rpc('get_unlocked_contact', { p_unit_id: currentListing.unit_id });
      if (data && data.length > 0) {
        showContactStatus('Unlocked!', 'ok');
        showUnlockedContact(data[0]);
      } else {
        showContactStatus('Payment went through but something looked off reading the details back — refresh the page.', 'error');
      }
    } else if (result === 'timeout') {
      showContactStatus("Haven't heard back yet. If you completed the payment, refresh this page in a minute.", 'error');
    } else {
      showContactStatus('Payment was not completed.', 'error');
    }
  } catch (err) {
    showContactStatus(err.message || 'Could not start the payment.', 'error');
  }
});

load();