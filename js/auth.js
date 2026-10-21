// ------------------------------------------------------------
// Shared auth helpers: "who is logged in" and page guards.
// Guards redirect and return null when access is refused, so a
// page can simply do:   const user = await requireUser(); if (!user) return;
// These are UX conveniences. The real access control is RLS in the
// database — hiding a page here never protects any data by itself.
// ------------------------------------------------------------
import { supabase } from './supabase-client.js';

// "property-details.html?unit=1" (file + query, no leading slash) so a
// post-login redirect works on any host path, including GitHub Pages.
function currentPage() {
  return window.location.pathname.split('/').pop() + window.location.search;
}

export function loginUrl(returnTo = currentPage()) {
  return `tenant-signup.html?redirect=${encodeURIComponent(returnTo)}`;
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// Any logged-in user (tenant, landlord or admin). Sends guests to login.
export async function requireUser(returnTo) {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = loginUrl(returnTo);
    return null;
  }
  return user;
}

// Logged in AND has a landlord profile. Everyone else goes to landlord signup.
export async function requireLandlord() {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = 'landlord-signup.html';
    return null;
  }
  const { data: landlord } = await supabase
    .from('landlords')
    .select('id, full_name, phone')
    .eq('id', user.id)
    .maybeSingle();
  if (!landlord) {
    window.location.href = 'landlord-signup.html';
    return null;
  }
  return { user, landlord };
}

// Asks the database itself (is_admin() — the same function every RLS policy
// uses), so the page can never disagree with what the data layer allows.
export async function isAdmin() {
  const { data, error } = await supabase.rpc('is_admin');
  return !error && data === true;
}

// Creates/refreshes the tenants row for an email or OAuth user.
export async function ensureTenantProfile(user, fallbackName = null) {
  const { error } = await supabase.from('tenants').upsert({
    id: user.id,
    full_name: user.user_metadata?.full_name || fallbackName || user.email,
    email: user.email,
  });
  if (error) console.error('tenant profile upsert failed:', error.message);
}

export async function signOutAndGoHome() {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
}