import { supabase, PHOTO_REQUIREMENTS } from './supabase-client.js';

const PAGE_SIZE = 12;

let offset = 0;
let filters = {};
let isLoading = false;
let hasMore = false;

const grid = document.getElementById('results-grid');
const emptyState = document.getElementById('empty-state');
const loadMoreBtn = document.getElementById('load-more');
const statusEl = document.getElementById('status');
const filterForm = document.getElementById('filter-form');

const unitTypeLabel = (type) =>
  PHOTO_REQUIREMENTS[type]?.label || type || 'Rental property';

function showStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = `status-msg ${type}`;
  statusEl.style.display = 'block';
}

function clearStatus() {
  statusEl.textContent = '';
  statusEl.style.display = 'none';
}

function setLoading(loading) {
  isLoading = loading;
  loadMoreBtn.disabled = loading;
  loadMoreBtn.textContent = loading ? 'Loading...' : 'Load more homes';
}

function renderCard(listing) {
  const card = document.createElement('article');
  card.className = 'listing-card';

  const photo = document.createElement('div');
  photo.className = 'photo';

  if (listing.thumbnail_path) {
    const { data } = supabase.storage
      .from('property-photos')
      .getPublicUrl(listing.thumbnail_path);

    if (data?.publicUrl) {
      const img = document.createElement('img');
      img.src = data.publicUrl;
      img.alt = `${unitTypeLabel(listing.unit_type)} property`;
      img.loading = 'lazy';
      img.onerror = () => {
        photo.textContent = 'Photo unavailable';
      };
      photo.appendChild(img);
    } else {
      photo.textContent = 'No photo available';
    }
  } else {
    photo.textContent = 'No photo yet';
  }

  const body = document.createElement('div');
  body.className = 'body';

  const type = document.createElement('div');
  type.className = 'type-tag';
  type.textContent =
    unitTypeLabel(listing.unit_type) +
    (listing.size_label ? ` · ${listing.size_label}` : '');

  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = listing.property_name || 'Rental property';

  const city = document.createElement('div');
  city.className = 'city';
  city.textContent = listing.city || 'Location not specified';

  const price = document.createElement('div');
  price.className = 'price';

  const rent = Number(listing.rent);
  price.textContent = Number.isFinite(rent)
    ? `KES ${rent.toLocaleString('en-KE')}`
    : 'Rent not specified';

  const perMonth = document.createElement('span');
  perMonth.textContent = '/mo';
  price.appendChild(perMonth);

  const detailsLink = document.createElement('a');
  detailsLink.className = 'btn btn-primary listing-view-btn';
  detailsLink.textContent = 'View details';
  detailsLink.href = `property-details.html?unit=${encodeURIComponent(listing.unit_id)}&property=${encodeURIComponent(listing.property_id)}`;

  body.append(type, name, city, price, detailsLink);
  card.append(photo, body);
  grid.appendChild(card);
}

async function fetchPage(reset = false) {
  if (isLoading) return;

  if (reset) {
    offset = 0;
    hasMore = false;
    grid.innerHTML = '';
    emptyState.style.display = 'none';
    loadMoreBtn.style.display = 'none';
  }

  clearStatus();
  setLoading(true);

  if (reset) {
    showStatus('Finding available homes...', 'loading');
  }

  try {
    let query = supabase
      .from('public_listings')
      .select('*')
      .eq('availability', 'vacant')
      .order('rent', {
        ascending: filters.sort !== 'price_desc'
      })
      .range(offset, offset + PAGE_SIZE);

    if (filters.city) {
      query = query.ilike('city', `%${filters.city}%`);
    }

    if (filters.unit_type) {
      query = query.eq('unit_type', filters.unit_type);
    }

    if (filters.min_rent !== '' && filters.min_rent != null) {
      query = query.gte('rent', Number(filters.min_rent));
    }

    if (filters.max_rent !== '' && filters.max_rent != null) {
      query = query.lte('rent', Number(filters.max_rent));
    }

    const { data, error } = await query;

    if (error) throw error;

    const listings = data || [];
    const pageListings = listings.slice(0, PAGE_SIZE);

    pageListings.forEach(renderCard);

    hasMore = listings.length > PAGE_SIZE;
    offset += pageListings.length;

    emptyState.style.display =
      reset && pageListings.length === 0 ? 'block' : 'none';

    loadMoreBtn.style.display = hasMore ? 'inline-flex' : 'none';

    if (reset) {
      clearStatus();

      if (pageListings.length > 0) {
        showStatus(
          `${offset} ${offset === 1 ? 'home' : 'homes'} loaded`,
          'success'
        );
      }
    }
  } catch (error) {
    console.error('Error fetching listings:', error);
    showStatus(
      'We could not load the homes right now. Please try again.',
      'error'
    );
  } finally {
    setLoading(false);
  }
}


// ================= FILTER SUBMISSION =================

filterForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const minValue = document.getElementById('f_min').value;
  const maxValue = document.getElementById('f_max').value;

  if (
    minValue !== '' &&
    maxValue !== '' &&
    Number(minValue) > Number(maxValue)
  ) {
    showStatus(
      'Minimum rent cannot be greater than maximum rent.',
      'error'
    );
    return;
  }

  filters = {
    city: document.getElementById('f_city').value.trim(),
    unit_type: document.getElementById('f_type').value,
    min_rent: minValue,
    max_rent: maxValue,
    sort: document.getElementById('f_sort').value
  };

  fetchPage(true);
});


// ================= RESET FILTERS =================

document.getElementById('reset-filters').addEventListener('click', () => {
  filterForm.reset();
  filters = {};
  fetchPage(true);
});


// ================= LOAD MORE =================

loadMoreBtn.addEventListener('click', () => {
  if (hasMore && !isLoading) {
    fetchPage(false);
  }
});


// ================= HOMEPAGE SEARCH PARAMETERS =================

const params = new URLSearchParams(window.location.search);

if ([...params.keys()].length > 0) {
  filters = {
    city: params.get('city') || '',
    unit_type: params.get('type') || '',
    min_rent: params.get('min') || '',
    max_rent: params.get('max') || '',
    sort: 'price_asc'
  };

  document.getElementById('f_city').value = filters.city;
  document.getElementById('f_type').value = filters.unit_type;
  document.getElementById('f_min').value = filters.min_rent;
  document.getElementById('f_max').value = filters.max_rent;
  document.getElementById('f_sort').value = filters.sort;
}


// ================= INITIAL LOAD =================

fetchPage(true);