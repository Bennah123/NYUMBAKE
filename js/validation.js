// ------------------------------------------------------------
// Input validation helpers shared across pages.
// Client-side checks are for fast feedback only — real enforcement
// lives in the database (constraints, RLS, guard triggers) and the
// Edge Functions, never here.
// ------------------------------------------------------------

export const MIN_PASSWORD_LENGTH = 8;

// Accepts 07XXXXXXXX, 01XXXXXXXX, +2547XXXXXXXX, 2547XXXXXXXX (spaces ok)
// and returns +254XXXXXXXXX, or null if it isn't a Kenyan mobile number.
export function normalizeKenyanPhone(raw) {
  let phone = String(raw ?? '').replace(/[\s-]+/g, '');
  if (/^0[71]\d{8}$/.test(phone)) phone = '+254' + phone.slice(1);
  else if (/^254[71]\d{8}$/.test(phone)) phone = '+' + phone;
  return /^\+254[71]\d{8}$/.test(phone) ? phone : null;
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email ?? '').trim());
}

// Returns an error message, or null when the password is acceptable.
export function passwordError(password) {
  if (String(password ?? '').length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

// True for a finite number > 0 (rent, deposit, quantity...).
export function isPositiveNumber(value) {
  const n = Number(value);
  return value !== '' && value != null && Number.isFinite(n) && n > 0;
}

// Escapes text for safe use inside an HTML string (innerHTML / template literals).
// Anything that came from a user or the database — names, messages, report text —
// must go through this, or be set with textContent instead.
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}