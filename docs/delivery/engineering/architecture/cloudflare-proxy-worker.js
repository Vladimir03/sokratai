// Cloudflare Worker — Supabase reverse proxy for SokratAI
// Routes: api.sokratai.ru/* → vrsseotrfmsxpbciyqzc.supabase.co/*
//
// Purpose: bypass RU ISP blocks on *.supabase.co.
// See: docs/delivery/engineering/architecture/cloudflare-proxy.md
//
// Deploy: this file is the canonical source — actual runtime code lives in
// Cloudflare Dashboard → Workers & Pages → sokratai-supabase-proxy → Edit code.
// Keep them in sync. Any change to the live worker MUST be reflected here.

const SUPABASE_HOST = 'vrsseotrfmsxpbciyqzc.supabase.co';

// Headers that Cloudflare adds and Supabase doesn't need
const STRIP_REQUEST_HEADERS = [
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
  'cf-ew-via',
  'cdn-loop',
  'x-forwarded-host',
  'x-forwarded-proto',
];

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Tiny self-healthcheck — useful for "is the worker alive" probes
    if (url.pathname === '/__health') {
      return jsonResponse({
        status: 'ok',
        upstream: SUPABASE_HOST,
        ts: new Date().toISOString(),
      });
    }

    // Build upstream URL preserving path + query
    const upstreamUrl = `https://${SUPABASE_HOST}${url.pathname}${url.search}`;

    // Clone request headers, strip CF-internals
    const upstreamHeaders = new Headers(request.headers);
    for (const h of STRIP_REQUEST_HEADERS) upstreamHeaders.delete(h);

    // Forward to Supabase. WebSocket upgrades (Realtime) are handled
    // transparently by Cloudflare runtime when the upstream returns 101.
    const upstreamRequest = new Request(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      body: request.body,
      redirect: 'manual',
    });

    try {
      return await fetch(upstreamRequest);
    } catch (err) {
      return jsonResponse(
        {
          error: 'upstream_unreachable',
          message: String(err && err.message ? err.message : err),
        },
        502
      );
    }
  },
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
