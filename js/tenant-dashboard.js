import { supabase } from './supabase-client.js';

const loadingEl = document.getElementById('loading-state');
const emptyEl = document.getElementById('empty-state');
const contentEl = document.getElementById('dashboard-content');
const itemsEl = document.getElementById('items-list');

function badge(text, variant) {
  const span = document.createElement('span');
  span.className = `badge${variant ? ' ' + variant : ''}`;
  span.textContent = text;
  return span;
}

async function init() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    window.location.href = `tenant-signup.html?redirect=${encodeURIComponent('tenant-dashboard.html')}`;
    return;
  }

  const [{ data: enquiries }, { data: viewings }] = await Promise.all([
    supabase.from('enquiries')
      .select('*, properties(name), units(unit_type, size_label)')
      .order('created_at', { ascending: false }),
    supabase.from('viewing_requests')
      .select('*, properties(name), units(unit_type, size_label)')
      .order('created_at', { ascending: false }),
  ]);

  const items = [
    ...(enquiries || []).map((e) => ({ ...e, kind: 'enquiry' })),
    ...(viewings || []).map((v) => ({ ...v, kind: 'viewing' })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  loadingEl.style.display = 'none';

  if (items.length === 0) {
    emptyEl.style.display = 'block';
    return;
  }

  contentEl.style.display = 'block';
  render(items);
}

function render(items) {
  itemsEl.innerHTML = '';

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'dashboard-panel';
    row.style.padding = '16px 20px';

    const propertyName = item.properties?.name || 'A property';
    const unitLabel = item.units ? `${item.units.unit_type.replace(/_/g, ' ')}${item.units.size_label ? ' · ' + item.units.size_label : ''}` : '';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex; justify-content:space-between; gap:10px; align-items:flex-start;';
    const title = document.createElement('div');
    title.innerHTML = `<strong>${propertyName}</strong>${unitLabel ? `<div style="font-size:12px; color:var(--muted)">${unitLabel}</div>` : ''}`;

    const statusText = item.kind === 'enquiry'
      ? (item.status === 'new' ? 'Sent — awaiting response' : 'Responded')
      : (item.status === 'pending' ? 'Pending' : item.status === 'confirmed' ? 'Confirmed' : 'Declined');
    const variant = (item.status === 'new' || item.status === 'pending') ? 'pending' : item.status === 'declined' ? 'rejected' : '';

    header.append(title, badge(statusText, variant));

    const body = document.createElement('div');
    body.style.cssText = 'font-size:13px; color:var(--dark); margin-top:10px;';
    if (item.kind === 'enquiry') {
      body.innerHTML = `<strong>You asked:</strong> ${item.message}`;
    } else {
      const when = new Date(item.requested_at).toLocaleString('en-KE');
      body.innerHTML = `<strong>Requested viewing:</strong> ${when}`;
      if (item.response) {
        const note = document.createElement('div');
        note.style.cssText = 'margin-top:8px; padding:10px; background:var(--surface-soft); border-radius:8px;';
        note.innerHTML = `<strong>Landlord's note:</strong> ${item.response}`;
        row.append(header, body, note);
        itemsEl.appendChild(row);
        return;
      }
    }

    row.append(header, body);
    itemsEl.appendChild(row);
  });
}

document.getElementById('logout-btn')?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
});

init();