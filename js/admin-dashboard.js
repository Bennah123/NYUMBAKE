import { supabase, logAudit } from './supabase-client.js';

const loadingEl = document.getElementById('loading-state');
const deniedEl = document.getElementById('denied-state');
const contentEl = document.getElementById('dashboard-content');

let currentUser = null;

function badge(text, variant) {
  const span = document.createElement('span');
  span.className = `badge${variant ? ' ' + variant : ''}`;
  span.textContent = text;
  return span;
}

const STATUS_LABELS = {
  draft: ['Draft', 'pending'],
  published: ['Published', ''],
  archived: ['Archived', 'rejected'],
};

async function init() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    window.location.href = 'tenant-signup.html?redirect=admin-dashboard.html';
    return;
  }
  currentUser = user;

  const { data: adminRow } = await supabase.from('admins').select('id').eq('id', user.id).maybeSingle();
  loadingEl.style.display = 'none';

  if (!adminRow) {
    deniedEl.style.display = 'block';
    return;
  }

  contentEl.style.display = 'block';
  await loadReports();
  await loadProperties();
  await loadLandlords();
  await loadAuditLog();
}

const REASON_LABELS = {
  inaccurate_info: 'Information looks inaccurate',
  scam_suspected: 'Looks like a scam',
  already_rented: 'Already rented',
  inappropriate_content: 'Inappropriate content',
  other: 'Other',
};

async function loadReports() {
  const container = document.getElementById('reports-list');
  container.innerHTML = '';

  const { data: reports } = await supabase
    .from('reports')
    .select('*, properties(name)')
    .order('created_at', { ascending: false });

  const open = (reports || []).filter((r) => r.status === 'open');

  if (open.length === 0) {
    container.innerHTML = '<p style="color:var(--muted)">No open reports.</p>';
    return;
  }

  // reporter_id -> tenant name, fetched separately since reports.reporter_id
  // references auth.users directly, not tenants, so it can't be embedded.
  const reporterIds = [...new Set(open.map((r) => r.reporter_id))];
  const { data: reporterRows } = await supabase.from('tenants').select('id, full_name').in('id', reporterIds);
  const reporterNames = Object.fromEntries((reporterRows || []).map((t) => [t.id, t.full_name]));

  open.forEach((report) => {
    const row = document.createElement('div');
    row.style.cssText = 'padding:14px; border:1px solid var(--line); border-radius:10px; margin-bottom:10px;';

    const propertyName = report.properties?.name || 'Unknown property';
    const reporterName = reporterNames[report.reporter_id] || 'A tenant';
    const when = new Date(report.created_at).toLocaleString('en-KE');

    row.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:10px; margin-bottom:6px;">
        <strong>${propertyName}</strong>
        <span style="font-size:12px; color:var(--muted)">${when}</span>
      </div>
      <div style="font-size:13px; margin-bottom:4px;"><strong>${REASON_LABELS[report.reason] || report.reason}</strong> — reported by ${reporterName}</div>
      ${report.description ? `<div style="font-size:13px; color:var(--muted); margin-bottom:10px;">${report.description}</div>` : ''}
    `;

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; gap:8px; margin-top:8px;';

    const archiveBtn = document.createElement('button');
    archiveBtn.type = 'button';
    archiveBtn.className = 'btn btn-light';
    archiveBtn.textContent = 'Archive property';
    archiveBtn.addEventListener('click', async () => {
      if (!confirm(`Archive "${propertyName}"? It will be removed from Browse.`)) return;
      await supabase.from('properties').update({ listing_status: 'archived' }).eq('id', report.property_id);
      await resolveReport(report, 'resolved', 'Property archived');
    });

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'btn btn-light';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.addEventListener('click', () => {
      const notes = prompt('Optional note on why this was dismissed:') || null;
      resolveReport(report, 'dismissed', notes);
    });

    actions.append(archiveBtn, dismissBtn);
    row.appendChild(actions);
    container.appendChild(row);
  });
}

async function resolveReport(report, status, notes) {
  const { error } = await supabase.from('reports').update({
    status,
    resolution_notes: notes,
    resolved_by: currentUser.id,
    resolved_at: new Date().toISOString(),
  }).eq('id', report.id);
  if (error) return alert(error.message);
  loadReports();
  loadProperties();
}

async function loadProperties() {
  const { data: properties } = await supabase
    .from('properties')
    .select('*, units(*), landlords(full_name, phone)')
    .order('created_at', { ascending: false });

  const list = properties || [];
  document.getElementById('stat-properties').textContent = list.length;
  document.getElementById('stat-draft').textContent = list.filter((p) => p.listing_status === 'draft').length;
  document.getElementById('stat-published').textContent = list.filter((p) => p.listing_status === 'published').length;
  const totalUnits = list.reduce((sum, p) => sum + (p.units || []).reduce((s, u) => s + (u.quantity || 1), 0), 0);
  document.getElementById('stat-units').textContent = totalUnits;

  const container = document.getElementById('properties-list');
  container.innerHTML = '';

  if (list.length === 0) {
    container.innerHTML = '<p style="color:var(--muted)">No properties on the platform yet.</p>';
    return;
  }

  list.forEach((property) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; padding:14px; border:1px solid var(--line); border-radius:10px; margin-bottom:10px;';

    const info = document.createElement('div');
    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.textContent = property.name;

    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:12px; color:var(--muted); margin-top:3px;';
    const landlordName = property.landlords?.full_name || 'Unknown landlord';
    const landlordPhone = property.landlords?.phone || '—';
    const unitCount = (property.units || []).length;
    sub.textContent = `${property.city}, ${property.estate} · ${landlordName} (${landlordPhone}) · ${unitCount} unit type${unitCount === 1 ? '' : 's'}`;
    info.append(title, sub);

    const [label, variant] = STATUS_LABELS[property.listing_status] || STATUS_LABELS.draft;
    const right = document.createElement('div');
    right.style.cssText = 'display:flex; align-items:center; gap:8px; flex-wrap:wrap;';
    right.appendChild(badge(label, variant));

    if (property.listing_status !== 'archived') {
      const archiveBtn = document.createElement('button');
      archiveBtn.type = 'button';
      archiveBtn.className = 'btn btn-light';
      archiveBtn.textContent = 'Archive';
      archiveBtn.addEventListener('click', () => moderateProperty(property, 'archived'));
      right.appendChild(archiveBtn);
    }
    if (property.listing_status === 'published') {
      const unpublishBtn = document.createElement('button');
      unpublishBtn.type = 'button';
      unpublishBtn.className = 'btn btn-light';
      unpublishBtn.textContent = 'Unpublish';
      unpublishBtn.addEventListener('click', () => moderateProperty(property, 'draft'));
      right.appendChild(unpublishBtn);
    }

    row.append(info, right);
    container.appendChild(row);
  });
}

async function moderateProperty(property, newStatus) {
  if (!confirm(`Set "${property.name}" to ${newStatus}?`)) return;
  const { error } = await supabase.from('properties').update({ listing_status: newStatus }).eq('id', property.id);
  if (error) return alert(error.message);
  await logAudit(
    property.id,
    property.landlord_id,
    'admin_listing_status_changed',
    { from: property.listing_status, to: newStatus },
    currentUser.id
  );
  await loadProperties();
  await loadAuditLog();
}

async function loadLandlords() {
  const { data: landlords } = await supabase
    .from('landlords')
    .select('*, properties(id)')
    .order('created_at', { ascending: false });

  const container = document.getElementById('landlords-list');
  container.innerHTML = '';

  if (!landlords || landlords.length === 0) {
    container.innerHTML = '<p style="color:var(--muted)">No landlords yet.</p>';
    return;
  }

  landlords.forEach((l) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:12px; border:1px solid var(--line); border-radius:10px; margin-bottom:8px; font-size:13px;';
    const count = (l.properties || []).length;
    row.innerHTML = `<div><strong>${l.full_name}</strong><div style="color:var(--muted); font-size:12px">${l.phone}</div></div><div style="color:var(--muted)">${count} propert${count === 1 ? 'y' : 'ies'}</div>`;
    container.appendChild(row);
  });
}

async function loadAuditLog() {
  const { data: logs } = await supabase
    .from('property_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);

  const container = document.getElementById('audit-log-list');
  container.innerHTML = '';

  if (!logs || logs.length === 0) {
    container.innerHTML = '<p style="color:var(--muted)">No activity logged yet.</p>';
    return;
  }

  logs.forEach((entry) => {
    const row = document.createElement('div');
    row.style.cssText = 'padding:10px 0; border-bottom:1px solid var(--line); font-size:12px;';
    const when = new Date(entry.created_at).toLocaleString('en-KE');
    const details = document.createElement('div');
    details.style.color = 'var(--muted)';
    details.textContent = JSON.stringify(entry.details);
    const headline = document.createElement('div');
    headline.innerHTML = `<strong>${entry.action}</strong> — ${when}`;
    row.append(headline, details);
    container.appendChild(row);
  });
}

document.getElementById('logout-btn')?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
});

init();