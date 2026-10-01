import { supabase, logAudit } from './supabase-client.js';

const loadingEl = document.getElementById('loading-state');
const emptyEl = document.getElementById('empty-state');
const contentEl = document.getElementById('dashboard-content');
const propertiesEl = document.getElementById('properties-list');

let currentUser = null;

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
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (!landlordRow) {
    window.location.href = 'landlord-signup.html';
    return;
  }

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
      publishBtn.addEventListener('click', () => updateListingStatus(property, 'published'));
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

document.getElementById('logout-btn')?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
});

loadDashboard();