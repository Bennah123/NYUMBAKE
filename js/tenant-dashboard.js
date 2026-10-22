import { supabase } from './supabase-client.js';
import { requireUser, signOutAndGoHome } from './auth.js';
import { escapeHtml } from './validation.js';
import { toast } from './notifications.js';

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
  const user = await requireUser('tenant-dashboard.html');
  if (!user) return;

  // my_enquiries / my_viewing_requests are database views that return only the
  // caller's own rows plus the property name — tenants can't read the properties
  // table directly (that's what keeps contact details behind the paywall).
  const [{ data: enquiries, error: enqError }, { data: viewings, error: viewError }] = await Promise.all([
    supabase.from('my_enquiries').select('*').order('created_at', { ascending: false }),
    supabase.from('my_viewing_requests').select('*').order('created_at', { ascending: false }),
  ]);

  loadingEl.style.display = 'none';
  if (enqError || viewError) toast('Could not load your enquiries: ' + (enqError || viewError).message, 'error');

  const items = [
    ...(enquiries || []).map((e) => ({ ...e, kind: 'enquiry' })),
    ...(viewings || []).map((v) => ({ ...v, kind: 'viewing' })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

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

    const unitLabel = item.unit_type
      ? `${item.unit_type.replace(/_/g, ' ')}${item.size_label ? ' · ' + item.size_label : ''}`
      : '';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex; justify-content:space-between; gap:10px; align-items:flex-start;';
    const title = document.createElement('div');
    title.innerHTML = `<strong>${escapeHtml(item.property_name || 'A property')}</strong>${unitLabel ? `<div style="font-size:12px; color:var(--muted)">${escapeHtml(unitLabel)}</div>` : ''}`;

    const statusText = item.kind === 'enquiry'
      ? (item.status === 'new' ? 'Sent — awaiting response' : 'Responded')
      : (item.status === 'pending' ? 'Pending' : item.status === 'confirmed' ? 'Confirmed' : 'Declined');
    const variant = (item.status === 'new' || item.status === 'pending') ? 'pending' : item.status === 'declined' ? 'rejected' : '';
    header.append(title, badge(statusText, variant));

    const body = document.createElement('div');
    body.style.cssText = 'font-size:13px; color:var(--dark); margin-top:10px;';
    const label = document.createElement('strong');
    if (item.kind === 'enquiry') {
      label.textContent = 'You asked: ';
      body.append(label, document.createTextNode(item.message));
    } else {
      label.textContent = 'Requested viewing: ';
      body.append(label, document.createTextNode(new Date(item.requested_at).toLocaleString('en-KE')));
    }

    row.append(header, body);

    if (item.kind === 'viewing' && item.response) {
      const note = document.createElement('div');
      note.style.cssText = 'margin-top:8px; padding:10px; background:var(--surface-soft); border-radius:8px; font-size:13px;';
      const noteLabel = document.createElement('strong');
      noteLabel.textContent = "Landlord's note: ";
      note.append(noteLabel, document.createTextNode(item.response));
      row.appendChild(note);
    }

    itemsEl.appendChild(row);
  });
}

document.getElementById('logout-btn')?.addEventListener('click', signOutAndGoHome);

init();