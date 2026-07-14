/**
 * lib/auth.js — Authentication utilities.
 *
 * Covers:
 *  - Environment validation (SESSION_SECRET, ADMIN credentials)
 *  - Device key derivation (fingerprint + IP)
 *  - Session cookie signing and verification (HMAC-SHA256)
 *  - Session DB lookup and refresh
 *  - bcryptjs password comparison (never throws to caller)
 *  - JWT generation and verification (for API consumers / backward-compat)
 *  - Client IP extraction (safe, no undefined)
 *
 * Every function that touches a string validates its input before
 * calling any string method — no "Cannot read properties of undefined" errors.
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';

// ---------- Environment ----------
// Read once — module is a singleton in Node.js runtime.
export const ADMIN_USERNAME      = (process.env.ADMIN_USERNAME || process.env.ADMIN_USER || '').trim();
export const ADMIN_PASSWORD_HASH = (process.env.ADMIN_PASSWORD_HASH || '').trim();
const SESSION_SECRET             = (process.env.SESSION_SECRET || process.env.JWT_SECRET || '').trim();
const JWT_SECRET                 = (process.env.JWT_SECRET || process.env.SESSION_SECRET || '').trim();

// Validation warnings — visible in server logs, not in API responses.
if (!ADMIN_USERNAME) {
  console.error('[auth] ADMIN_USERNAME (or ADMIN_USER) is not set. Admin login will always fail.');
}
if (!ADMIN_PASSWORD_HASH) {
  console.error('[auth] ADMIN_PASSWORD_HASH is not set. Admin login will always fail.');
}
if (!SESSION_SECRET) {
  console.error('[auth] SESSION_SECRET (or JWT_SECRET) is not set. Session cookies cannot be signed securely.');
}

// ---------- Constants ----------
export const SESSION_COOKIE    = 'unibatch_session';
const SESSION_TTL_SECONDS      = 60 * 60 * 24 * 7; // 7 days
const SESSION_TTL_MS           = SESSION_TTL_SECONDS * 1000;

// ---------- Client IP ----------
/**
 * Safely extracts the originating client IP from request headers.
 * Returns 'unknown' rather than undefined.
 */
export function getClientIp(request) {
  try {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded && typeof forwarded === 'string') {
      const first = forwarded.split(',')[0];
      if (first && typeof first === 'string') return first.trim() || 'unknown';
    }
    const realIp = request.headers.get('x-real-ip');
    if (realIp && typeof realIp === 'string' && realIp.trim()) return realIp.trim();
  } catch {
    // Ignore — fall through to default.
  }
  return 'unknown';
}

// ---------- Device key ----------
/**
 * Produces a stable device fingerprint from the client-supplied browser
 * fingerprint (computed via Web Crypto on the client) and the server-observed
 * IP.  Neither alone is sufficient: the fingerprint avoids shared-IP
 * collisions; the IP guards against trivially forged fingerprints.
 *
 * Both inputs are coerced to strings and truncated, so undefined/null are safe.
 */
export function computeDeviceKey(fingerprint, ip) {
  const fp = String(fingerprint || '').slice(0, 256);
  const clientIp = String(ip || 'unknown').slice(0, 64);
  return crypto.createHash('sha256').update(`${fp}:${clientIp}`).digest('hex');
}

// ---------- IP-only security key ----------
/**
 * Produces a security key derived ONLY from the server-observed client IP.
 *
 * Unlike computeDeviceKey(), this value cannot be influenced by anything in
 * the request body — it is the sole basis for brute-force lockout state, so
 * that lockout cannot be bypassed by varying a client-supplied fingerprint.
 */
export function computeIpKey(ip) {
  const clientIp = String(ip || 'unknown').slice(0, 64);
  return crypto.createHash('sha256').update(`ip:${clientIp}`).digest('hex');
}

// ---------- Session cookie signing ----------
/**
 * Signs a session UUID so that even if an attacker enumerates UUIDs they
 * still cannot forge a valid cookie without SESSION_SECRET.
 *
 * Cookie value: `<uuid>.<hmac-hex>`
 */
export function signSession(sessionId) {
  const secret = SESSION_SECRET || 'insecure-fallback-change-me';
  const sig = crypto.createHmac('sha256', secret).update(String(sessionId)).digest('hex');
  return `${sessionId}.${sig}`;
}

/**
 * Verifies the HMAC signature and returns the session UUID on success.
 * Returns null if the cookie is missing, malformed, or tampered with.
 */
export function unsignSession(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return null;
  const dot = cookieValue.lastIndexOf('.');
  if (dot < 1) return null;
  const id  = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  if (!id || !sig) return null;

  const secret   = SESSION_SECRET || 'insecure-fallback-change-me';
  const expected = crypto.createHmac('sha256', secret).update(id).digest('hex');

  // Constant-time comparison — both must be the same length first.
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch {
    return null;
  }
  return id;
}

// ---------- Session cookie helpers ----------
export function applySessionCookie(response, sessionId) {
  response.cookies.set(SESSION_COOKIE, signSession(sessionId), {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   SESSION_TTL_SECONDS,
    path:     '/',
  });
}

export function clearSessionCookie(response) {
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   0,
    path:     '/',
  });
}

// ---------- Session DB validation ----------
/**
 * Reads the session cookie from the request, verifies its HMAC signature,
 * looks it up in MongoDB, checks expiry, and updates `lastUsedAt`.
 *
 * Returns the session document on success, or null on any failure.
 * Never throws — all errors return null.
 */
export async function validateSession(request, database) {
  try {
    const raw       = request.cookies.get(SESSION_COOKIE)?.value;
    const sessionId = unsignSession(raw);
    if (!sessionId) return null;

    const sessions = database.collection('admin_sessions');
    const session  = await sessions.findOne({ sessionId });
    if (!session) return null;

    if (new Date(session.expiresAt) < new Date()) {
      await sessions.deleteOne({ sessionId }).catch(() => {});
      return null;
    }

    // Best-effort refresh — don't let this block the response.
    sessions.updateOne(
      { sessionId },
      { $set: { lastUsedAt: new Date().toISOString() } }
    ).catch(() => {});

    return session;
  } catch {
    return null;
  }
}

/**
 * Creates a new session document and returns the sessionId.
 * Invalidates all previous sessions first (single-session enforcement).
 */
export async function createSession(database, deviceKey, ip) {
  const sessions  = database.collection('admin_sessions');
  const now       = new Date();
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  // Single-session enforcement: delete every existing session.
  await sessions.deleteMany({});

  await sessions.insertOne({
    sessionId,
    deviceKey,
    ip,
    createdAt:  now.toISOString(),
    expiresAt,
    lastUsedAt: now.toISOString(),
  });

  return sessionId;
}

// ---------- Password ----------
/**
 * Compares a plaintext password against a bcrypt hash.
 * Returns false (not an error) if either argument is missing or the
 * comparison fails for any reason.
 */
export async function verifyPassword(plaintext, hash) {
  if (!plaintext || typeof plaintext !== 'string') return false;
  if (!hash      || typeof hash      !== 'string') return false;
  // bcrypt hashes always start with $2b$, $2a$, or $2y$ — quick sanity check.
  if (!hash.startsWith('$2')) return false;
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}

/**
 * Validates the credentials from the request body against the configured
 * admin username and bcrypt hash.
 * Returns true only when BOTH username and password are correct.
 */
export async function checkAdminCredentials(username, password) {
  // Coerce to strings — never call string methods on raw user input.
  const u = typeof username === 'string' ? username.trim() : '';
  const p = typeof password === 'string' ? password        : '';

  if (!u || !p)              return false;
  if (!ADMIN_USERNAME)       return false;
  if (!ADMIN_PASSWORD_HASH)  return false;

  // Use constant-time comparison for username too.
  const usernameOk = u.length === ADMIN_USERNAME.length &&
    crypto.timingSafeEqual(Buffer.from(u), Buffer.from(ADMIN_USERNAME));

  // bcrypt comparison runs regardless of username to prevent timing attacks.
  const passwordOk = await verifyPassword(p, ADMIN_PASSWORD_HASH);

  return usernameOk && passwordOk;
}

// ---------- OTP ----------
/**
 * Generates a cryptographically secure 6-digit OTP string.
 * Uses crypto.randomInt (Node 14.10+) for uniform distribution.
 */
export function generateOtp() {
  return String(crypto.randomInt(100_000, 1_000_000));
}

/**
 * Timing-safe comparison of two 6-digit OTP strings.
 * Returns false (never throws) if either value is missing or not exactly
 * 6 digits — length/format mismatches are rejected before any timing-safe
 * comparison, so no timing signal is leaked based on OTP validity.
 */
export function verifyOtp(inputOtp, storedOtp) {
  const a = typeof inputOtp  === 'string' ? inputOtp  : '';
  const b = typeof storedOtp === 'string' ? storedOtp : '';
  if (!/^\d{6}$/.test(a) || !/^\d{6}$/.test(b)) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// ---------- JWT (for API consumers / backward-compat) ----------
function b64url(s) {
  return Buffer.from(s).toString('base64url');
}

/**
 * Generates a HS256 JWT signed with JWT_SECRET.
 * TTL defaults to 7 days.
 */
export function signJwt(payload, ttlSeconds = SESSION_TTL_SECONDS) {
  const secret = JWT_SECRET || 'insecure-jwt-fallback-change-me';
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now    = Math.floor(Date.now() / 1000);
  const body   = b64url(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
  const sig    = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

/**
 * Verifies a JWT signed with JWT_SECRET.
 * Returns the payload on success or null on any failure.
 */
export function verifyJwt(token) {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    const secret   = JWT_SECRET || 'insecure-jwt-fallback-change-me';
    const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
    if (s.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
