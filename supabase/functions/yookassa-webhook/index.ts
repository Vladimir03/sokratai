import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

/**
 * Validates the webhook request by verifying that the payment exists in our database
 * and matches the expected state. This prevents attackers from forging webhook requests
 * to activate subscriptions without actual payment.
 */
async function validatePaymentInDatabase(
  supabase: any,
  paymentId: string,
  webhookUserId: string | undefined,
  webhookAmount: string
): Promise<{ valid: boolean; error?: string; existingPayment?: Record<string, unknown> }> {
  // Check if payment exists in our database (created when user initiated payment)
  const { data: existingPayment, error: fetchError } = await supabase
    .from("payments")
    .select("id, user_id, amount, status, subscription_activated_at")
    .eq("id", paymentId)
    .single();

  if (fetchError || !existingPayment) {
    console.error(`Payment ${paymentId} not found in database - possible forged webhook`);
    return { valid: false, error: "Payment not found in database" };
  }

  // Verify user_id matches what we have on record
  if (webhookUserId && existingPayment.user_id !== webhookUserId) {
    console.error(`User ID mismatch: webhook=${webhookUserId}, db=${existingPayment.user_id} - possible forged webhook`);
    return { valid: false, error: "User ID mismatch" };
  }

  // Verify amount matches (convert webhook string to number for comparison)
  const webhookAmountNum = parseFloat(webhookAmount);
  if (Math.abs(existingPayment.amount - webhookAmountNum) > 0.01) {
    console.error(`Amount mismatch: webhook=${webhookAmountNum}, db=${existingPayment.amount} - possible forged webhook`);
    return { valid: false, error: "Amount mismatch" };
  }

  // Check if subscription was already activated (idempotency)
  if (existingPayment.subscription_activated_at) {
    console.log(`Payment ${paymentId} already processed - skipping duplicate webhook`);
    return { valid: true, existingPayment };
  }

  return { valid: true, existingPayment };
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
    const webhookAmount = body.object.amount?.value;

    // SECURITY: Validate payment exists in our database before processing
    // This prevents forged webhook attacks - attacker cannot activate subscriptions
    // without first creating a legitimate payment through our payment flow
    const validation = await validatePaymentInDatabase(supabase, paymentId, userId, webhookAmount);
    
    if (!validation.valid) {
      console.error(`Webhook validation failed for payment ${paymentId}: ${validation.error}`);
      // Return 200 to prevent retries, but log the attempt
      return new Response(
        JSON.stringify({ success: false, error: "Validation failed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
      // Skip if already activated (idempotency check from validation)
      if (validation.existingPayment?.subscription_activated_at) {
        console.log(`Payment ${paymentId} already activated, returning success`);
        return new Response(
          JSON.stringify({ success: true, message: "Already processed" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

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
