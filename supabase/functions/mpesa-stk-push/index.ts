// supabase/functions/mpesa-callback/index.ts
//
// Safaricom calls this directly after the tenant/landlord completes
// (or cancels) the STK push on their phone. This endpoint MUST be
// deployed with JWT verification OFF — Safaricom doesn't send a
// Supabase auth token, it's not a logged-in user calling this:
//
//   supabase functions deploy mpesa-callback --no-verify-jwt
//
// This is the only privileged write path for payments/contact_unlocks/
// properties.listing_status in the whole payment flow. The frontend
// never sets "paid" on anything directly — only this function does,
// and only after Safaricom confirms it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  // Safaricom expects a 200 with this exact shape no matter what —
  // otherwise it retries the callback repeatedly.
  const ack = () =>
    new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), {
      headers: { "Content-Type": "application/json" },
    });

  try {
    const body = await req.json();
    const stkCallback = body?.Body?.stkCallback;
    if (!stkCallback) return ack();

    const { CheckoutRequestID, ResultCode, CallbackMetadata } = stkCallback;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: payment } = await admin
      .from("payments")
      .select("*")
      .eq("checkout_request_id", CheckoutRequestID)
      .maybeSingle();

    // Unknown checkout id, or already processed (duplicate callback) — ack and stop.
    // This is the idempotency guard: Safaricom is documented to sometimes
    // send the same callback more than once.
    if (!payment || payment.status !== "pending") return ack();

    if (ResultCode !== 0) {
      await admin.from("payments").update({ status: "failed" }).eq("id", payment.id);
      return ack();
    }

    const items: Array<{ Name: string; Value: unknown }> = CallbackMetadata?.Item ?? [];
    const getItem = (name: string) => items.find((i) => i.Name === name)?.Value;
    const receipt = getItem("MpesaReceiptNumber") as string | undefined;

    await admin.from("payments").update({
      status: "completed",
      provider_receipt: receipt ?? null,
    }).eq("id", payment.id);

    if (payment.purpose === "property_publish" && payment.property_id) {
      await admin.from("properties")
        .update({ listing_status: "published" })
        .eq("id", payment.property_id);
    }

    if (payment.purpose === "contact_reveal" && payment.unit_id) {
      await admin.from("contact_unlocks").insert({
        tenant_id: payment.payer_id,
        unit_id: payment.unit_id,
        payment_id: payment.id,
      });
    }

    return ack();
  } catch (err) {
    console.error(err);
    // Still ack — an internal error here shouldn't make Safaricom hammer
    // retries. The payment stays "pending" and can be investigated directly.
    return ack();
  }
});