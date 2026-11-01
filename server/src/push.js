// Yatzy zu zweit: Web Push without any library. The message is encrypted for one phone
// (RFC 8291, aes128gcm) and signed with our VAPID key (RFC 8292), so the push service
// (Apple, Google, Mozilla) delivers it but can't read it.
//
// Secret: VAPID_PRIVATE_JWK (wrangler secret). Plain vars: VAPID_PUBLIC, VAPID_SUBJECT.

const PUSH_HOSTS = ['push.apple.com', 'fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com'];

// A subscription as the page sends it (PushSubscription.toJSON()), reduced to what we keep.
export function subscription(raw){
  const sub = raw && {endpoint: raw.endpoint, p256dh: raw.keys && raw.keys.p256dh, auth: raw.keys && raw.keys.auth};
  if (!sub || typeof sub.endpoint !== 'string' || typeof sub.p256dh !== 'string' || typeof sub.auth !== 'string') return null;
  if (sub.endpoint.length > 1000 || sub.p256dh.length > 200 || sub.auth.length > 100) return null;
  let u;
  try { u = new URL(sub.endpoint); } catch { return null; }
  if (u.protocol !== 'https:' || !PUSH_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h))) return null;
  return sub;
}

export async function sendPush(env, sub, message){
  const body = await encrypt(sub, new TextEncoder().encode(JSON.stringify(message)));
  const jwt = await vapidJwt(env, new URL(sub.endpoint).origin);
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
      'Urgency': 'high',
      'Authorization': `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`
    },
    body
  });
}

// RFC 8291: encrypt the payload for one subscription.
export async function encrypt(sub, payload, {salt = crypto.getRandomValues(new Uint8Array(16)), serverKeys} = {}){
  const uaPublic = b64u(sub.p256dh);
  const authSecret = b64u(sub.auth);
  const keys = serverKeys || await crypto.subtle.generateKey({name: 'ECDH', namedCurve: 'P-256'}, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, {name: 'ECDH', namedCurve: 'P-256'}, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({name: 'ECDH', public: uaKey}, keys.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdhSecret, concat(text('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, text('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, text('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = concat(payload, new Uint8Array([2]));            // 0x02: last (and only) record
  const cipher = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv: nonce}, aesKey, plain));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);                // record size
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

// RFC 8292: a short-lived JWT that proves the push comes from us.
export async function vapidJwt(env, audience, now = Math.floor(Date.now() / 1000)){
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), {name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign']);
  const enc = o => b64uEncode(text(JSON.stringify(o)));
  const unsigned = `${enc({typ: 'JWT', alg: 'ES256'})}.${enc({aud: audience, exp: now + 3600, sub: env.VAPID_SUBJECT})}`;
  const sig = new Uint8Array(await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, key, text(unsigned)));
  return `${unsigned}.${b64uEncode(sig)}`;
}

// ---------- helpers ----------
async function hkdf(salt, ikm, info, length){
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name: 'HKDF', hash: 'SHA-256', salt, info}, key, length * 8));
}
const text = s => new TextEncoder().encode(s);
function concat(...parts){
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let i = 0;
  for (const p of parts){ out.set(p, i); i += p.length; }
  return out;
}
export function b64u(s){
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
export function b64uEncode(bytes){
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
