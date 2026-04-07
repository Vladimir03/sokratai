

## Problem

The "Failed to fetch" error when saving a tutor score override is caused by a **CORS misconfiguration**. The edge function's `Access-Control-Allow-Methods` header lists `GET, POST, PUT, DELETE, OPTIONS` but **does not include `PATCH`**. The browser sends a preflight OPTIONS request for the PATCH method, the server responds without PATCH in the allowed methods, and the browser blocks the request entirely — resulting in a network-level "Failed to fetch" error before any HTTP response is received.

## Fix

### File: `supabase/functions/homework-api/index.ts` (line 65)

Change:
```ts
"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
```
To:
```ts
"Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
```

### Deployment

Redeploy the `homework-api` edge function. No frontend changes, no migrations needed.

