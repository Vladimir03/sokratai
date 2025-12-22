import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// YooKassa webhook IP addresses for verification (optional but recommended)
const YOOKASSA_IPS = [
  "185.71.76.0/27",
  "185.71.77.0/27", 
  "77.75.153.0/25",
  "77.75.156.11",
  "77.75.156.35",
  "77.75.154.128/25",
  "2a02:5180::/32",
];

interface YooKassaWebhookEvent {
  type: string;
  event: string;
  object: {
    id: string;
    status: string;
    amount: {
      value: string;
      currency: string;
    };
    metadata?: {
      user_id?: string;
      subscription_days?: number;
    };
    created_at: string;
    captured_at?: string;
    payment_method?: {
      type: string;
      id: string;
      saved: boolean;
    };
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only accept POST requests
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const body: YooKassaWebhookEvent = await req.json();
    
    console.log("Received YooKassa webhook:", JSON.stringify(body, null, 2));

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const paymentId = body.object.id;
    const status = body.object.status;
    const userId = body.object.metadata?.user_id;
    const subscriptionDays = body.object.metadata?.subscription_days || 30;

    // Update payment status in database
    const { error: updatePaymentError } = await supabase
      .from("payments")
      .update({
        status: status,
        updated_at: new Date().toISOString(),
        webhook_data: body,
      })
      .eq("id", paymentId);

    if (updatePaymentError) {
      console.error("Failed to update payment:", updatePaymentError);
    }

    // Handle successful payment
    if (body.event === "payment.succeeded" && status === "succeeded" && userId) {
      console.log(`Payment succeeded for user ${userId}, activating subscription for ${subscriptionDays} days`);

      // Calculate subscription expiry date
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + subscriptionDays);

      // Check if user already has active subscription and extend it
      const { data: profile } = await supabase
        .from("profiles")
        .select("subscription_expires_at")
        .eq("id", userId)
        .single();

      let newExpiresAt = expiresAt;
      
      // If user has existing subscription, extend from that date
      if (profile?.subscription_expires_at) {
        const existingExpiry = new Date(profile.subscription_expires_at);
        if (existingExpiry > new Date()) {
          newExpiresAt = new Date(existingExpiry);
          newExpiresAt.setDate(newExpiresAt.getDate() + subscriptionDays);
        }
      }

      // Update user subscription
      const { error: updateProfileError } = await supabase
        .from("profiles")
        .update({
          subscription_tier: "premium",
          subscription_expires_at: newExpiresAt.toISOString(),
        })
        .eq("id", userId);

      if (updateProfileError) {
        console.error("Failed to update profile subscription:", updateProfileError);
        return new Response(
          JSON.stringify({ error: "Failed to activate subscription" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Update payment with subscription info
      await supabase
        .from("payments")
        .update({
          subscription_activated_at: new Date().toISOString(),
          subscription_expires_at: newExpiresAt.toISOString(),
        })
        .eq("id", paymentId);

      console.log(`Subscription activated for user ${userId} until ${newExpiresAt.toISOString()}`);
    }

    // Handle canceled/refunded payment
    if (body.event === "payment.canceled" || body.event === "refund.succeeded") {
      console.log(`Payment ${paymentId} was canceled/refunded`);
      // Note: We don't automatically revoke subscription on refund
      // This should be handled manually by admin
    }

    // Always return 200 to acknowledge receipt
    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error processing webhook:", error);
    // Return 200 anyway to prevent YooKassa from retrying
    // Log the error for investigation
    return new Response(
      JSON.stringify({ success: true, error: "Processing error logged" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

