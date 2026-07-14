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
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '*').trim();

export function applyCors(response) {
  response.headers.set('Access-Control-Allow-Origin',  ALLOWED_ORIGINS);
  response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return response;
}

// ---------- JSON response helper ----------
/**
 * Creates a JSON NextResponse with CORS headers applied.
 *
 * @param {unknown} data   — Serialisable body.
 * @param {number}  status — HTTP status code (default 200).
 */
export function json(data, status = 200) {
  return applyCors(NextResponse.json(data, { status }));
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
