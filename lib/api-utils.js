/**
 * lib/api-utils.js — Server-side API utilities (Next.js route handlers only).
 *
 * Do NOT import this file in client components — it references next/server.
 *
 * Covers: CORS headers, JSON response helper, email masking, display formatters.
 * Every function is safe to call with undefined / null inputs.
 */

import { NextResponse } from 'next/server';

// ---------- CORS ----------
// CORS_ORIGINS env var mein apni site ka URL daalo
// Example: CORS_ORIGINS=https://unibatch.vercel.app
// Multiple allowed: CORS_ORIGINS=https://unibatch.vercel.app,https://www.unibatch.com
// Kabhi bhi production mein * mat rakho!

const _rawOrigins = (process.env.CORS_ORIGINS || '').trim();

// Allowed origins ka set banao — empty ya * hone par warn karo
const ALLOWED_ORIGINS = _rawOrigins === '*' || _rawOrigins === ''
  ? null  // null = wildcard (development only!)
  : new Set(_rawOrigins.split(',').map((o) => o.trim()).filter(Boolean));

if (!ALLOWED_ORIGINS) {
  console.warn(
    '[CORS] WARNING: CORS_ORIGINS is not set or is "*". ' +
    'Set it to your production domain, e.g. https://yourdomain.com'
  );
}

export function applyCors(response, request) {
  const requestOrigin = request?.headers?.get?.('origin') || '';

  let allowedOrigin = '';

  if (!ALLOWED_ORIGINS) {
    // Development fallback — wildcard
    allowedOrigin = '*';
  } else if (requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)) {
    // Request ka origin allowed list mein hai — sirf use reflect karo
    allowedOrigin = requestOrigin;
  } else {
    // Origin allowed nahi — CORS header set mat karo
    allowedOrigin = '';
  }

  if (allowedOrigin) {
    response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
    response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    // Agar specific origin hai (wildcard nahi) toh Vary header bhi lagao
    if (allowedOrigin !== '*') {
      response.headers.set('Vary', 'Origin');
    }
  }

  return response;
}

// ---------- JSON response helper ----------
/**
 * Creates a JSON NextResponse with CORS headers applied.
 *
 * @param {unknown} data    — Serialisable body.
 * @param {number}  status  — HTTP status code (default 200).
 * @param {Request} request — Original request (for origin check).
 */
export function json(data, status = 200, request = null) {
  return applyCors(NextResponse.json(data, { status }), request);
}

// ---------- Email masking ----------
/**
 * Masks an email address for safe display in API responses.
 * "chintu@outlook.com" → "ch***@outlook.com"
 * Returns '***' if input is falsy or not a string.
 */
export function maskEmail(email) {
  if (!email || typeof email !== 'string') return '***';
  return email.replace(/^(.{2}).+(@.+)$/, '$1***$2');
}

// ---------- Contributor display helpers ----------
/**
 * Returns a UTC-session label ("Morning" / "Afternoon" / "Evening" / "Night")
 * for a given Date or ISO string.
 */
export function sessionLabelFromUtc(date) {
  try {
    const h = new Date(date).getUTCHours();
    if (h >= 5  && h < 11) return 'Morning';
    if (h >= 11 && h < 17) return 'Afternoon';
    if (h >= 17 && h < 22) return 'Evening';
    return 'Night';
  } catch {
    return 'Unknown';
  }
}

/**
 * Formats a sequential contributor number as "#000001".
 */
export function pad6(n) {
  return '#' + String(Math.max(0, Number(n) || 0)).padStart(6, '0');
}
