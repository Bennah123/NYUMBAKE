import { supabase, logAudit, initiateMpesaPayment, pollPaymentStatus } from './supabase-client.js';

const loadingEl = document.getElementById('loading-state');
const emptyEl = document.getElementById('empty-state');
const contentEl = document.getElementById('dashboard-content');
const propertiesEl = document.getElementById('properties-list');

let currentUser = null;
let currentLandlordPhone = null;

function daysSince(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

function badge(text, variant) {
  const span = document.createElement('span');
  span.className = `badge${variant ? ' ' + variant : ''}`;
  span.textContent = text;
  return span;
}

async function loadDashboard() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    window.location.href = 'landlord-signup.html';
    return;
  }
  currentUser = user;

  const { data: landlordRow } = await supabase
    .from('landlords')
    .select('id, phone')
    .eq('id', user.id)
    .maybeSingle();

  if (!landlordRow) {
    window.location.href = 'landlord-signup.html';
    return;
  }
  currentLandlordPhone = landlordRow.phone;

  const { data: properties, error } = await supabase
    .from('properties')
    .select('*, units(*)')
    .eq('landlord_id', user.id)
    .order('created_at', { ascending: false });

  loadingEl.style.display = 'none';

  if (error || !properties || properties.length === 0) {
    emptyEl.style.display = 'block';
    return;
  }

  contentEl.style.display = 'block';
  renderStats(properties);
  renderProperties(properties);
  loadEnquiries();
}

function renderStats(properties) {
  let totalUnits = 0, vacant = 0, rented = 0;
  properties.forEach((p) => {
    (p.units || []).forEach((u) => {
      const qty = u.quantity || 1;
      totalUnits += qty;
      if (u.availability === 'vacant') vacant += qty;
      else rented += qty;
    });
  });
  document.getElementById('stat-properties').textContent = properties.length;
  document.getElementById('stat-units').textContent = totalUnits;
  document.getElementById('stat-vacant').textContent = vacant;
  document.getElementById('stat-rented').textContent = rented;
}

const STATUS_LABELS = {
  draft: ['Draft', 'pending'],
  published: ['Published', ''],
  archived: ['Archived', 'rejected'],
};

function renderProperties(properties) {
  propertiesEl.innerHTML = '';

  properties.forEach((property) => {
    const panel = document.createElement('div');
    panel.className = 'dashboard-panel';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; margin-bottom:16px;';

    const titleWrap = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.style.marginBottom = '4px';
    h2.textContent = property.name;
    const sub = document.createElement('p');
    sub.style.cssText = 'margin:0; color:var(--muted); font-size:13px;';
    sub.textContent = `${property.city} · ${property.estate}`;
    titleWrap.append(h2, sub);

    const [label, variant] = STATUS_LABELS[property.listing_status] || STATUS_LABELS.draft;
    header.append(titleWrap, badge(label, variant));

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; margin-bottom:18px;';

    const editLink = document.createElement('a');
    editLink.className = 'btn btn-light';
    editLink.textContent = 'Edit';
    editLink.href = `property-upload.html?property=${property.id}`;
    actions.appendChild(editLink);

    if (property.listing_status !== 'published') {
      const publishBtn = document.createElement('button');
      publishBtn.type = 'button';
      publishBtn.className = 'btn btn-primary';
      publishBtn.textContent = 'Publish';
      publishBtn.addEventListener('click', () => payToPublish(property));
      actions.appendChild(publishBtn);
    } else {
      const unpublishBtn = document.createElement('button');
      unpublishBtn.type = 'button';
      unpublishBtn.className = 'btn btn-light';
      unpublishBtn.textContent = 'Unpublish';
      unpublishBtn.addEventListener('click', () => updateListingStatus(property, 'draft'));
      actions.appendChild(unpublishBtn);
    }

    if (property.listing_status !== 'archived') {
      const archiveBtn = document.createElement('button');
      archiveBtn.type = 'button';
      archiveBtn.className = 'btn btn-light';
      archiveBtn.textContent = 'Archive';
      archiveBtn.addEventListener('click', () => {
        if (confirm(`Archive "${property.name}"? It will be removed from Browse.`)) {
          updateListingStatus(property, 'archived');
        }
      });
      actions.appendChild(archiveBtn);
    }

    if (property.listing_status === 'draft') {
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-light';
      deleteBtn.style.color = '#b91c1c';
      deleteBtn.textContent = 'Delete draft';
      deleteBtn.addEventListener('click', async () => {
        if (!confirm(`Permanently delete "${property.name || 'this draft'}"? This can't be undone.`)) return;
        const { error } = await supabase.from('properties').delete().eq('id', property.id);
        if (error) return alert(error.message);
        loadDashboard();
      });
      actions.appendChild(deleteBtn);
    }

    const unitsWrap = document.createElement('div');
    unitsWrap.style.cssText = 'display:grid; gap:10px;';

    (property.units || []).forEach((unit) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; padding:12px; border:1px solid var(--line); border-radius:10px;';

      const info = document.createElement('div');
      const typeLine = document.createElement('div');
      typeLine.style.fontWeight = '600';
      typeLine.textContent = `${unit.unit_type.replace(/_/g, ' ')}${unit.size_label ? ' · ' + unit.size_label : ''} — KES ${Number(unit.rent).toLocaleString()}/mo`;

      const staleDays = daysSince(unit.availability_updated_at);
      const metaLine = document.createElement('div');
      metaLine.style.cssText = 'font-size:12px; color:var(--muted); margin-top:3px;';
      metaLine.textContent = `Updated ${staleDays} day${staleDays === 1 ? '' : 's'} ago`;
      if (staleDays >= 90) {
        metaLine.style.color = '#b91c1c';
        metaLine.textContent += ' — please confirm this is still accurate';
      }
      info.append(typeLine, metaLine);

      const rightWrap = document.createElement('div');
      rightWrap.style.cssText = 'display:flex; align-items:center; gap:10px;';
      rightWrap.appendChild(badge(
        unit.availability === 'vacant' ? 'Vacant' : 'Rented',
        unit.availability === 'vacant' ? '' : 'rejected'
      ));

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'btn btn-light';
      toggleBtn.textContent = unit.availability === 'vacant' ? 'Mark as rented' : 'Mark as vacant';
      toggleBtn.addEventListener('click', () => toggleAvailability(property, unit));
      rightWrap.appendChild(toggleBtn);

      row.append(info, rightWrap);
      unitsWrap.appendChild(row);
    });

    panel.append(header, actions, unitsWrap);
    propertiesEl.appendChild(panel);
  });
}

async function payToPublish(property) {
  const phone = prompt('M-Pesa number to pay the listing fee (KES 300):', currentLandlordPhone || '');
  if (!phone) return;

  try {
    const { paymentId } = await initiateMpesaPayment('property_publish', { propertyId: property.id, phone });
    alert('Check your phone and enter your M-Pesa PIN to complete the payment.');
    const status = await pollPaymentStatus(paymentId);

    if (status === 'completed') {
      await logAudit(property.id, currentUser.id, 'listing_status_changed', { from: property.listing_status, to: 'published', via: 'payment' });
      alert(`"${property.name}" is now published.`);
      loadDashboard();
    } else if (status === 'timeout') {
      alert("We haven't heard back yet. If you completed the payment, refresh this page in a minute — it may just be a delayed confirmation.");
    } else {
      alert('Payment was not completed. The property is still a draft.');
    }
  } catch (err) {
    alert(err.message || 'Could not start the payment. Try again.');
  }
}

async function updateListingStatus(property, status) {
  const { error } = await supabase.from('properties').update({ listing_status: status }).eq('id', property.id);
  if (error) return alert(error.message);
  await logAudit(property.id, currentUser.id, 'listing_status_changed', { from: property.listing_status, to: status });
  loadDashboard();
}

async function toggleAvailability(property, unit) {
  const newStatus = unit.availability === 'vacant' ? 'rented' : 'vacant';
  const { error } = await supabase
    .from('units')
    .update({ availability: newStatus, availability_updated_at: new Date().toISOString() })
    .eq('id', unit.id);
  if (error) return alert(error.message);
  await logAudit(property.id, currentUser.id, 'availability_changed', { unit_id: unit.id, from: unit.availability, to: newStatus });
  loadDashboard();
}

async function loadEnquiries() {
  const container = document.getElementById('enquiries-list');
  container.innerHTML = '';

  const [{ data: enquiries }, { data: viewings }] = await Promise.all([
    supabase.from('enquiries')
      .select('*, properties(name), units(unit_type, size_label), tenants(full_name)')
      .order('created_at', { ascending: false }),
    supabase.from('viewing_requests')
      .select('*, properties(name), units(unit_type, size_label), tenants(full_name)')
      .order('created_at', { ascending: false }),
  ]);

  const items = [
    ...(enquiries || []).map((e) => ({ ...e, kind: 'enquiry' })),
    ...(viewings || []).map((v) => ({ ...v, kind: 'viewing' })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (items.length === 0) {
    container.innerHTML = '<p style="color:var(--muted)">No enquiries yet.</p>';
    return;
  }

  items.forEach((item) => {
    const row = document.createElement('div');
    row.style.cssText = 'padding:14px; border:1px solid var(--line); border-radius:10px; margin-bottom:10px;';

    const propertyName = item.properties?.name || 'Unknown property';
    const unitLabel = item.units ? `${item.units.unit_type.replace(/_/g, ' ')}${item.units.size_label ? ' · ' + item.units.size_label : ''}` : '';
    const tenantName = item.tenants?.full_name || 'A tenant';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex; justify-content:space-between; gap:10px; margin-bottom:8px;';
    const left = document.createElement('div');
    left.innerHTML = `<strong>${tenantName}</strong> — ${propertyName}${unitLabel ? ' (' + unitLabel + ')' : ''}`;
    const right = document.createElement('div');
    right.appendChild(badge(
      item.kind === 'enquiry'
        ? (item.status === 'new' ? 'New message' : 'Responded')
        : (item.status === 'pending' ? 'Viewing — pending' : item.status === 'confirmed' ? 'Viewing — confirmed' : 'Viewing — declined'),
      item.status === 'new' || item.status === 'pending' ? 'pending' : item.status === 'declined' ? 'rejected' : ''
    ));
    header.append(left, right);

    const body = document.createElement('div');
    body.style.cssText = 'font-size:13px; color:var(--dark); margin-bottom:8px;';
    if (item.kind === 'enquiry') {
      body.textContent = item.message;
    } else {
      const when = new Date(item.requested_at).toLocaleString('en-KE');
      body.textContent = `Requested viewing: ${when}`;
    }

    const contact = document.createElement('div');
    contact.style.cssText = 'font-size:12px; color:var(--muted); margin-bottom:10px;';
    contact.textContent = item.tenant_contact ? `Reach them at: ${item.tenant_contact}` : 'No contact info left — reply isn\'t possible unless they log back in.';

    row.append(header, body, contact);

    if (item.kind === 'enquiry' && item.status === 'new') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-light';
      btn.textContent = 'Mark as responded';
      btn.addEventListener('click', async () => {
        const { error } = await supabase.from('enquiries').update({ status: 'responded' }).eq('id', item.id);
        if (error) return alert(error.message);
        loadEnquiries();
      });
      row.appendChild(btn);
    }

    if (item.kind === 'viewing' && item.status === 'pending') {
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex; gap:8px;';

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'btn btn-primary';
      confirmBtn.textContent = 'Confirm';
      confirmBtn.addEventListener('click', () => respondToViewing(item, 'confirmed'));

      const declineBtn = document.createElement('button');
      declineBtn.type = 'button';
      declineBtn.className = 'btn btn-light';
      declineBtn.textContent = 'Decline';
      declineBtn.addEventListener('click', () => respondToViewing(item, 'declined'));

      actions.append(confirmBtn, declineBtn);
      row.appendChild(actions);
    }

    container.appendChild(row);
  });
}

async function respondToViewing(item, newStatus) {
  const response = prompt(newStatus === 'confirmed' ? 'Optional note for the tenant (e.g. exact meeting point):' : 'Optional reason (shown to the tenant):') || null;
  const { error } = await supabase.from('viewing_requests').update({ status: newStatus, response }).eq('id', item.id);
  if (error) return alert(error.message);
  loadEnquiries();
}

document.getElementById('logout-btn')?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
});

loadDashboard();