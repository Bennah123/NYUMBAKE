// supabase/functions/mpesa-stk-push/index.ts
//
// Initiates a Daraja STK push for one of two purposes: publishing a
// property, or unlocking a unit's real contact/location details.
// Deploy with default JWT verification ON (this one requires a logged-in
// caller) — unlike mpesa-callback, which must be public.
//
// Required secrets (set via `supabase secrets set`):
//   MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE,
//   MPESA_PASSKEY, MPESA_ENV ("sandbox" or "production")
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (Supabase sets these automatically)
//
// PRICING PLACEHOLDER — these are not real numbers, just something to
// ship with. Change them before this touches real money.
const PRICING_KES = {
  property_publish: 300,
  contact_reveal: 50,
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function daraja_base_url(): string {
  const env = Deno.env.get("MPESA_ENV") ?? "sandbox";
  return env === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

async function getAccessToken(): Promise<string> {
  const key = Deno.env.get("MPESA_CONSUMER_KEY")!;
  const secret = Deno.env.get("MPESA_CONSUMER_SECRET")!;
  const auth = btoa(`${key}:${secret}`);
  const res = await fetch(
    `${daraja_base_url()}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  if (!res.ok) throw new Error(`Daraja auth failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

function timestampNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

// Daraja wants 2547XXXXXXXX with no plus sign.
function normalizePhone(raw: string): string | null {
  let phone = raw.replace(/\s+/g, "");
  if (/^0[71]\d{8}$/.test(phone)) phone = "254" + phone.slice(1);
  if (/^\+254[71]\d{8}$/.test(phone)) phone = phone.slice(1);
  return /^254[71]\d{8}$/.test(phone) ? phone : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
    }

    const body = await req.json();
    const { purpose, propertyId, unitId, phone } = body;

    if (!["property_publish", "contact_reveal"].includes(purpose)) {
      return new Response(JSON.stringify({ error: "Invalid purpose" }), { status: 400 });
    }
    const normalizedPhone = normalizePhone(phone ?? "");
    if (!normalizedPhone) {
      return new Response(JSON.stringify({ error: "Invalid phone number" }), { status: 400 });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Ownership / eligibility checks happen server-side, not trusted from the client.
    if (purpose === "property_publish") {
      if (!propertyId) return new Response(JSON.stringify({ error: "propertyId required" }), { status: 400 });
      const { data: property } = await admin
        .from("properties").select("id, landlord_id").eq("id", propertyId).maybeSingle();
      if (!property || property.landlord_id !== user.id) {
        return new Response(JSON.stringify({ error: "You don't own this property" }), { status: 403 });
      }
    } else {
      if (!unitId) return new Response(JSON.stringify({ error: "unitId required" }), { status: 400 });
      const { data: unit } = await admin
        .from("units").select("id, property_id").eq("id", unitId).maybeSingle();
      if (!unit) {
        return new Response(JSON.stringify({ error: "Listing not available" }), { status: 400 });
      }

      const { data: property } = await admin
        .from("properties").select("listing_status").eq("id", unit.property_id).maybeSingle();
      if (!property || property.listing_status !== "published") {
        return new Response(JSON.stringify({ error: "Listing not available" }), { status: 400 });
      }
    }

    const amount = PRICING_KES[purpose as keyof typeof PRICING_KES];

    const { data: payment, error: paymentError } = await admin
      .from("payments")
      .insert({
        payer_id: user.id,
        purpose,
        property_id: purpose === "property_publish" ? propertyId : null,
        unit_id: purpose === "contact_reveal" ? unitId : null,
        amount,
      })
      .select()
      .single();
    if (paymentError) throw paymentError;

    const accessToken = await getAccessToken();
    const shortcode = Deno.env.get("MPESA_SHORTCODE")!;
    const passkey = Deno.env.get("MPESA_PASSKEY")!;
    const timestamp = timestampNow();
    const password = btoa(`${shortcode}${passkey}${timestamp}`);
    const callbackUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/mpesa-callback`;

    const stkRes = await fetch(`${daraja_base_url()}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: normalizedPhone,
        PartyB: shortcode,
        PhoneNumber: normalizedPhone,
        CallBackURL: callbackUrl,
        AccountReference: `NYUMBAKE-${payment.id.slice(0, 8)}`,
        TransactionDesc: purpose === "property_publish" ? "Property listing fee" : "Contact unlock fee",
      }),
    });
    const stkData = await stkRes.json();

    if (!stkRes.ok || stkData.ResponseCode !== "0") {
      await admin.from("payments").update({ status: "failed" }).eq("id", payment.id);
      return new Response(JSON.stringify({ error: stkData.errorMessage || "STK push failed" }), { status: 502 });
    }

    await admin.from("payments").update({
      checkout_request_id: stkData.CheckoutRequestID,
      merchant_request_id: stkData.MerchantRequestID,
    }).eq("id", payment.id);

    return new Response(JSON.stringify({ paymentId: payment.id, checkoutRequestId: stkData.CheckoutRequestID }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500 });
  }
});