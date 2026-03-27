/**
 * Web Push notification sender using raw crypto.subtle.
 * Implements RFC 8291 (Message Encryption) + RFC 8292 (VAPID).
 * Zero npm dependencies — works in Deno Edge Functions.
 */

// ─── Types ───────────────────────────────────────────────────

export interface PushSubscriptionData {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  badge?: string;
}

export interface PushResult {
  success: boolean;
  status: number;
  gone: boolean;
}

// ─── Base64 URL helpers ──────────────────────────────────────

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ─── VAPID JWT (RFC 8292) ────────────────────────────────────

async function importVapidPrivateKey(base64Url: string): Promise<CryptoKey> {
  const rawBytes = base64UrlDecode(base64Url);

  // VAPID private key is 32 bytes raw — wrap in PKCS8 for P-256
  // PKCS8 prefix for EC P-256 private key
  const pkcs8Prefix = new Uint8Array([
    0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06,
    0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03,
    0x01, 0x07, 0x04, 0x27, 0x30, 0x25, 0x02, 0x01,
    0x01, 0x04, 0x20,
  ]);

  const pkcs8 = new Uint8Array(pkcs8Prefix.length + rawBytes.length);
  pkcs8.set(pkcs8Prefix);
  pkcs8.set(rawBytes, pkcs8Prefix.length);

  return crypto.subtle.importKey(
    'pkcs8',
    pkcs8.buffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

async function createVapidJwt(
  audience: string,
  subject: string,
  privateKeyBase64: string,
): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 43200, // 12 hours
    sub: subject,
  };

  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const key = await importVapidPrivateKey(privateKeyBase64);
  const signatureBuffer = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsignedToken),
  );

  // WebCrypto returns DER-encoded signature; VAPID needs raw r||s (64 bytes)
  const signature = derToRaw(new Uint8Array(signatureBuffer));
  const signatureB64 = base64UrlEncode(signature.buffer);

  return `${unsignedToken}.${signatureB64}`;
}

/** Convert DER-encoded ECDSA signature to raw r||s format (64 bytes). */
function derToRaw(der: Uint8Array): Uint8Array {
  // DER: 0x30 <len> 0x02 <rLen> <r> 0x02 <sLen> <s>
  const raw = new Uint8Array(64);

  let offset = 2; // skip 0x30 and total length
  // R
  const rLen = der[offset + 1];
  offset += 2;
  const rStart = rLen > 32 ? offset + (rLen - 32) : offset;
  const rDest = rLen < 32 ? 32 - rLen : 0;
  raw.set(der.slice(rStart, offset + rLen), rDest);
  offset += rLen;

  // S
  const sLen = der[offset + 1];
  offset += 2;
  const sStart = sLen > 32 ? offset + (sLen - 32) : offset;
  const sDest = sLen < 32 ? 64 - sLen : 32;
  raw.set(der.slice(sStart, offset + sLen), sDest);

  return raw;
}

// ─── HKDF (RFC 5869) ────────────────────────────────────────

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

  // Extract
  const saltKey = salt.length > 0
    ? await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    : await crypto.subtle.importKey('raw', new Uint8Array(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', saltKey, ikm));

  // Expand
  const prkKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const infoWithCounter = new Uint8Array(info.length + 1);
  infoWithCounter.set(info);
  infoWithCounter[info.length] = 1;

  const okm = new Uint8Array(await crypto.subtle.sign('HMAC', prkKey, infoWithCounter));
  return okm.slice(0, length);
}

// ─── Payload Encryption (RFC 8291 — aes128gcm) ──────────────

function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function createInfo(
  type: string,
  clientPublicKey: Uint8Array,
  serverPublicKey: Uint8Array,
): Uint8Array {
  const encoder = new TextEncoder();
  const typeBytes = encoder.encode(type);
  const header = encoder.encode('Content-Encoding: ');
  const nul = new Uint8Array([0]);

  return concat(
    header,
    typeBytes,
    nul,
    new Uint8Array([0, 65]), // key length
    clientPublicKey,
    new Uint8Array([0, 65]),
    serverPublicKey,
  );
}

async function encryptPayload(
  plaintext: Uint8Array,
  subscriberPublicKeyBase64: string,
  subscriberAuthBase64: string,
): Promise<{ encrypted: Uint8Array; serverPublicKeyBytes: Uint8Array }> {
  const subscriberPublicKeyBytes = base64UrlDecode(subscriberPublicKeyBase64);
  const subscriberAuth = base64UrlDecode(subscriberAuthBase64);

  // Generate ephemeral ECDH key pair
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );

  // Import subscriber's public key
  const subscriberPublicKey = await crypto.subtle.importKey(
    'raw',
    subscriberPublicKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  // ECDH key agreement
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: subscriberPublicKey },
      serverKeyPair.privateKey,
      256,
    ),
  );

  // Export server public key (uncompressed, 65 bytes)
  const serverPublicKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey('raw', serverKeyPair.publicKey),
  );

  const encoder = new TextEncoder();

  // IKM for auth — RFC 8291 Section 3.3
  const authInfo = concat(
    encoder.encode('WebPush: info\0'),
    subscriberPublicKeyBytes,
    serverPublicKeyBytes,
  );
  const ikm = await hkdf(sharedSecret, subscriberAuth, authInfo, 32);

  // Content encryption key info
  const cekInfo = encoder.encode('Content-Encoding: aes128gcm\0');
  const nonceInfo = encoder.encode('Content-Encoding: nonce\0');

  // Salt (random 16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const cek = await hkdf(ikm, salt, cekInfo, 16);
  const nonce = await hkdf(ikm, salt, nonceInfo, 12);

  // Pad plaintext: add delimiter \x02 (last record)
  const paddedPlaintext = concat(plaintext, new Uint8Array([2]));

  // AES-128-GCM encrypt
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, paddedPlaintext),
  );

  // aes128gcm header: salt(16) + rs(4) + idlen(1) + keyid(65) + ciphertext
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false); // record size

  const header = concat(
    salt,
    rs,
    new Uint8Array([65]), // keyid length
    serverPublicKeyBytes,
  );

  return { encrypted: concat(header, ciphertext), serverPublicKeyBytes };
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Send a push notification to a subscriber.
 *
 * @param sub         Subscriber's push subscription data
 * @param payload     Notification payload (title, body, url, etc.)
 * @param vapidPublicKey   Base64url-encoded VAPID public key
 * @param vapidPrivateKey  Base64url-encoded VAPID private key (32 bytes)
 * @param vapidSubject     VAPID subject (mailto: or https:)
 * @returns PushResult with success/status/gone flags
 */
export async function sendPushNotification(
  sub: PushSubscriptionData,
  payload: PushPayload,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  vapidSubject: string,
): Promise<PushResult> {
  try {
    const audience = new URL(sub.endpoint).origin;

    // VAPID auth
    const jwt = await createVapidJwt(audience, vapidSubject, vapidPrivateKey);
    const vapidHeader = `vapid t=${jwt},k=${vapidPublicKey}`;

    // Encrypt payload
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    const { encrypted } = await encryptPayload(payloadBytes, sub.p256dh, sub.auth);

    // Send to push service
    const response = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': vapidHeader,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'TTL': '86400',
        'Urgency': 'normal',
      },
      body: encrypted,
    });

    const gone = response.status === 410;
    const success = response.status >= 200 && response.status < 300;

    if (!success) {
      const text = await response.text().catch(() => '');
      console.error(`Push send failed: ${response.status} ${text}`);
    }

    return { success, status: response.status, gone };
  } catch (error) {
    console.error('sendPushNotification error:', error);
    return { success: false, status: 0, gone: false };
  }
}
