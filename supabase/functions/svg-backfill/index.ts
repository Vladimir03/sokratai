import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-backfill-secret",
};

const SECRET = Deno.env.get("SCHEDULER_SECRET") ?? "";

function b64encode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
  }
  return btoa(bin);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = req.headers.get("x-backfill-secret") ?? "";
  if (!SECRET || auth !== SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const sr = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(url, sr);

  const body = await req.json().catch(() => ({}));
  const action = body.action as string;

  if (action === "download") {
    const objectPath = body.objectPath as string;
    const { data, error } = await db.storage.from("kb-attachments").download(objectPath);
    if (error || !data) {
      return new Response(JSON.stringify({ error: error?.message ?? "download_failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const buf = await data.arrayBuffer();
    return new Response(JSON.stringify({ base64: b64encode(buf), bytes: buf.byteLength }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (action === "upload") {
    const objectPath = body.objectPath as string;
    const png = b64decode(body.base64 as string);
    const { error } = await db.storage.from("kb-attachments").upload(objectPath, png, {
      contentType: "image/png",
      upsert: true,
    });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, bytes: png.byteLength }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "unknown_action" }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});