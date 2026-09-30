// ============================================================
// Supabase client — shared across pages.
// Loaded via <script type="module"> after the Supabase CDN script.
// Replace the placeholders below with your project's values
// (Project Settings → API in the Supabase dashboard).
// ============================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ------------------------------------------------------------
// Photo requirements per unit type.
// "required" categories block the unit from being saved as complete.
// "optional" categories only appear once their matching checkbox is
// ticked — and once ticked, that photo becomes required too.
// ------------------------------------------------------------
export const PHOTO_REQUIREMENTS = {
  single_room: {
    label: 'Single room',
    required: [{ key: 'room', label: 'The room' }],
    optionalToggles: [],
  },
  double_room: {
    label: 'Double room',
    required: [{ key: 'room', label: 'The room' }],
    optionalToggles: [],
  },
  bedsitter: {
    label: 'Bedsitter',
    required: [
      { key: 'cooking_area', label: 'Cooking area' },
      { key: 'washroom', label: 'Washroom' },
      { key: 'bedroom_sitting', label: 'Bedroom / sitting area' },
    ],
    optionalToggles: [
      { key: 'closet', label: 'Closet' },
      { key: 'balcony', label: 'Balcony' },
    ],
  },
  one_bedroom: {
    label: 'One bedroom',
    required: [
      { key: 'kitchen', label: 'Kitchen' },
      { key: 'sitting_area', label: 'Sitting area' },
      { key: 'living_area', label: 'Living area' },
      { key: 'bedroom_1', label: 'Bedroom' },
    ],
    optionalToggles: [
      { key: 'bathroom', label: 'Bathroom' },
      { key: 'washing_area', label: 'Washing area' },
      { key: 'closet', label: 'Closet / wardrobe' },
      { key: 'balcony', label: 'Balcony' },
    ],
  },
  two_bedroom: {
    label: 'Two bedroom',
    required: [
      { key: 'kitchen', label: 'Kitchen' },
      { key: 'sitting_area', label: 'Sitting area' },
      { key: 'living_area', label: 'Living area' },
      { key: 'bedroom_1', label: 'Bedroom 1' },
      { key: 'bedroom_2', label: 'Bedroom 2' },
    ],
    optionalToggles: [
      { key: 'bathroom', label: 'Bathroom' },
      { key: 'washing_area', label: 'Washing area' },
      { key: 'closet', label: 'Closet / wardrobe' },
      { key: 'balcony', label: 'Balcony' },
    ],
  },
  three_bedroom: {
    label: 'Three bedroom',
    required: [
      { key: 'kitchen', label: 'Kitchen' },
      { key: 'sitting_area', label: 'Sitting area' },
      { key: 'living_area', label: 'Living area' },
      { key: 'bedroom_1', label: 'Bedroom 1' },
      { key: 'bedroom_2', label: 'Bedroom 2' },
      { key: 'bedroom_3', label: 'Bedroom 3' },
    ],
    optionalToggles: [
      { key: 'bathroom', label: 'Bathroom' },
      { key: 'washing_area', label: 'Washing area' },
      { key: 'closet', label: 'Closet / wardrobe' },
      { key: 'balcony', label: 'Balcony' },
    ],
  },
};

// Log an action to property_audit_log. Call after any create/update.
export async function logAudit(propertyId, landlordId, action, details = {}) {
  const { error } = await supabase.from('property_audit_log').insert({
    property_id: propertyId,
    landlord_id: landlordId,
    action,
    details,
  });
  if (error) console.error('audit log failed:', error.message);
}