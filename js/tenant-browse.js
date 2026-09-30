import { supabase, PHOTO_REQUIREMENTS } from './supabase-client.js';

const PAGE_SIZE = 12;
let offset = 0;
let filters = {};

const grid = document.getElementById('results-grid');
const emptyState = document.getElementById('empty-state');
const loadMoreBtn = document.getElementById('load-more');
const statusEl = document.getElementById('status');

const unitTypeLabel = (t) => PHOTO_REQUIREMENTS[t]?.label || t;

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = `status-msg ${type}`;
  statusEl.style.display = 'block';
}

function renderCard(listing) {
  const card = document.createElement('div');
  card.className = 'listing-card';

  let photoUrl = null;
  if (listing.thumbnail_path) {
    photoUrl = supabase.storage.from('property-photos').getPublicUrl(listing.thumbnail_path).data.publicUrl;
  }

  card.innerHTML = `
    <div class="photo">${photoUrl ? `<img src="${photoUrl}" alt="${unitTypeLabel(listing.unit_type)}">` : 'No photo yet'}</div>
    <div class="body">
      <div class="type-tag">${unitTypeLabel(listing.unit_type)}${listing.size_label ? ' · ' + listing.size_label : ''}</div>
      <div class="name">${listing.property_name}</div>
      <div class="city">${listing.city}</div>
      <div class="price">KES ${Number(listing.rent).toLocaleString()}<span>/mo</span></div>
    </div>
  `;
  grid.appendChild(card);
}

async function fetchPage(reset) {
  if (reset) {
    offset = 0;
    grid.innerHTML = '';
  }

  let query = supabase
    .from('public_listings')
    .select('*')
    .eq('availability', 'vacant')
    .order('rent', { ascending: filters.sort !== 'price_desc' })
    .range(offset, offset + PAGE_SIZE - 1);

  if (filters.city) query = query.ilike('city', `%${filters.city}%`);
  if (filters.unit_type) query = query.eq('unit_type', filters.unit_type);
  if (filters.min_rent) query = query.gte('rent', Number(filters.min_rent));
  if (filters.max_rent) query = query.lte('rent', Number(filters.max_rent));

  const { data, error } = await query;
  if (error) return showStatus(error.message, 'error');

  emptyState.style.display = reset && data.length === 0 ? 'block' : 'none';
  data.forEach(renderCard);
  offset += data.length;
  loadMoreBtn.style.display = data.length < PAGE_SIZE ? 'none' : 'inline-block';
}

document.getElementById('filter-form').addEventListener('submit', (e) => {
  e.preventDefault();
  filters = {
    city: document.getElementById('f_city').value.trim(),
    unit_type: document.getElementById('f_type').value,
    min_rent: document.getElementById('f_min').value,
    max_rent: document.getElementById('f_max').value,
    sort: document.getElementById('f_sort').value,
  };
  fetchPage(true);
});

document.getElementById('reset-filters').addEventListener('click', () => {
  document.getElementById('filter-form').reset();
  filters = {};
  fetchPage(true);
});

loadMoreBtn.addEventListener('click', () => fetchPage(false));

const params = new URLSearchParams(window.location.search);
if ([...params.keys()].length) {
  filters = {
    city: params.get('city') || '',
    unit_type: params.get('type') || '',
    min_rent: params.get('min') || '',
    max_rent: params.get('max') || '',
    sort: 'price_asc',
  };
  document.getElementById('f_city').value = filters.city;
  document.getElementById('f_type').value = filters.unit_type;
  document.getElementById('f_min').value = filters.min_rent;
  document.getElementById('f_max').value = filters.max_rent;
}

fetchPage(true);