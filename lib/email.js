/**
 * lib/email.js — Outlook SMTP helpers via nodemailer.
 *
 * All environment variables are validated before use.
 * Both functions throw on failure — callers must catch.
 *
 * SMTP settings are hardcoded to Outlook / Office 365:
 *   Host: smtp.office365.com  Port: 587  STARTTLS
 * Only credentials and destination are configurable via env vars.
 */

import nodemailer from 'nodemailer';

// ---------- Environment ----------
const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 587;
const SMTP_USER      = (process.env.SMTP_USER     || '').trim();
const SMTP_PASSWORD  = (process.env.SMTP_PASSWORD || '').trim();
const RECOVERY_EMAIL = (process.env.RECOVERY_EMAIL || '').trim();

if (!SMTP_USER || !SMTP_PASSWORD) {
  console.warn('[email] SMTP_USER or SMTP_PASSWORD not set — email delivery will fail.');
}
if (!RECOVERY_EMAIL) {
  console.warn('[email] RECOVERY_EMAIL not set — OTP and recovery emails have no destination.');
}

// ---------- Exported helpers ----------

/**
 * Returns true if SMTP is configured — safe to attempt a send.
 * Use to give a clearer 503 than a raw SMTP error.
 */
export function isSmtpConfigured() {
  return Boolean(SMTP_USER && SMTP_PASSWORD && RECOVERY_EMAIL);
}

/** The masked recovery email address (for safe display in API responses). */
export function maskedRecoveryEmail() {
  if (!RECOVERY_EMAIL) return '***';
  return RECOVERY_EMAIL.replace(/^(.{2}).+(@.+)$/, '$1***$2');
}

// ---------- Internal transporter factory ----------
// Created fresh per-call — safe for serverless / Vercel cold starts.
function createTransport() {
  return nodemailer.createTransport({
    host:   SMTP_HOST,
    port:   SMTP_PORT,
    secure: false, // STARTTLS (not SSL on port 465)
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASSWORD,
    },
    // No custom `tls.ciphers` override — smtp.office365.com negotiates modern
    // TLS (1.2+) fine over STARTTLS on port 587 without forcing a legacy
    // cipher list, so we let Node/OpenSSL pick the strongest mutually
    // supported ciphers automatically.
    // Reasonable timeouts so a broken SMTP server doesn't hang the request.
    connectionTimeout: 10_000,
    greetingTimeout:   10_000,
    socketTimeout:     30_000,
  });
}

// ---------- OTP email ----------
/**
 * Sends a one-time login code to RECOVERY_EMAIL.
 * Throws with a human-readable message on failure.
 *
 * @param {string} otp — 6-digit OTP string.
 */
export async function sendOtpEmail(otp) {
  if (!isSmtpConfigured()) {
    throw new Error(
      'SMTP is not configured. Set SMTP_USER, SMTP_PASSWORD, and RECOVERY_EMAIL in your environment.'
    );
  }

  const transport = createTransport();
  await transport.sendMail({
    from:    `"UNIBATCH Security" <${SMTP_USER}>`,
    to:      RECOVERY_EMAIL,
    subject: 'UNIBATCH Admin — Your Login Code',
    text: [
      'Your one-time login code is:',
      '',
      `  ${otp}`,
      '',
      'This code expires in 1 minute. Do not share it with anyone.',
      'If you did not request this, your admin password may be compromised — change it immediately.',
    ].join('\n'),
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px">
        <h2 style="color:#0ea5e9;margin-bottom:8px">UNIBATCH Admin Login</h2>
        <p style="color:#334155;margin-bottom:16px">
          Your one-time login code is:
        </p>
        <div style="font-size:2.25rem;font-weight:700;letter-spacing:0.35em;
                    padding:20px 24px;background:#0f172a;color:#38bdf8;
                    border-radius:10px;text-align:center;margin-bottom:16px">
          ${otp}
        </div>
        <p style="color:#64748b;font-size:0.875rem;margin-bottom:8px">
          This code expires in <strong>1 minute</strong>.
          Do not share it with anyone.
        </p>
        <p style="color:#64748b;font-size:0.875rem">
          If you did not request this code, your admin password may be compromised.
          Update <code>ADMIN_PASSWORD_HASH</code> immediately.
        </p>
      </div>
    `,
  });
}

// ---------- Password recovery email ----------
/**
 * Sends a recovery notification to RECOVERY_EMAIL.
 * Does NOT reset the password — instructs the admin to rotate ADMIN_PASSWORD_HASH.
 * Throws with a human-readable message on failure.
 */
export async function sendRecoveryEmail() {
  if (!isSmtpConfigured()) {
    throw new Error(
      'SMTP is not configured. Set SMTP_USER, SMTP_PASSWORD, and RECOVERY_EMAIL in your environment.'
    );
  }

  const transport = createTransport();
  await transport.sendMail({
    from:    `"UNIBATCH Security" <${SMTP_USER}>`,
    to:      RECOVERY_EMAIL,
    subject: 'UNIBATCH Admin — Password Recovery Request',
    text: [
      'A password recovery request was submitted for your UNIBATCH admin panel.',
      '',
      'To regain access:',
      '  1. Generate a new bcrypt hash:',
      '     node -e "const b=require(\'bcryptjs\'); b.hash(\'your-new-password\',12).then(console.log)"',
      '  2. Update ADMIN_PASSWORD_HASH in your environment (Vercel dashboard or .env.local).',
      '  3. Redeploy if needed.',
      '',
      'If you did not make this request, someone may be attempting to access your admin panel.',
      'Rotate your password immediately.',
    ].join('\n'),
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px">
        <h2 style="color:#f59e0b;margin-bottom:8px">UNIBATCH — Password Recovery</h2>
        <p style="color:#334155">
          A password recovery request was submitted for your UNIBATCH admin panel.
        </p>
        <p style="color:#334155;margin-top:16px"><strong>To regain access:</strong></p>
        <ol style="color:#334155;padding-left:20px">
          <li>Generate a new bcrypt hash:<br>
            <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:0.8rem">
              node -e "const b=require('bcryptjs'); b.hash('your-new-password',12).then(console.log)"
            </code>
          </li>
          <li style="margin-top:8px">
            Update <code>ADMIN_PASSWORD_HASH</code> in your environment (Vercel dashboard or <code>.env.local</code>).
          </li>
          <li style="margin-top:8px">Redeploy if needed.</li>
        </ol>
        <p style="color:#ef4444;margin-top:16px;font-size:0.875rem">
          If you did not make this request, rotate your password immediately.
        </p>
      </div>
    `,
  });
}
// ============================================================
// EMAIL VERIFICATION FUNCTIONS
// ============================================================

/**
 * Generate a 6-digit OTP for email verification
 */
export function generateVerificationOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Send a verification email to the contributor
 */
export async function sendVerificationEmail(to, name, txHash) {
  // Check if SMTP is configured
  const isConfigured = isSmtpConfigured();
  if (!isConfigured) {
    console.error('SMTP not configured — cannot send verification email');
    return { ok: false, error: 'SMTP not configured' };
  }

  const transporter = createTransport();

  const verificationLink = `${process.env.NEXT_PUBLIC_APP_URL || 'https://yourdomain.com'}/api/verify?email=${encodeURIComponent(to)}&tx=${txHash}`;

  try {
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to,
      subject: '🔐 Verify Your Contribution - UNIBATCH',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0a0a1a; color: #e0e0e0; border-radius: 12px;">
          <h2 style="color: #60a5fa;">🔐 Verify Your Contribution</h2>
          <p>Hello <strong>${name || 'Contributor'}</strong>,</p>
          <p>We received a contribution submission using your email address.</p>
          <p><strong>Transaction:</strong> ${txHash.slice(0, 10)}...${txHash.slice(-8)}</p>
          <p>Please click the button below to verify ownership:</p>
          <a href="${verificationLink}" style="display: inline-block; padding: 12px 24px; margin: 20px 0; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px;">Verify Now</a>
          <p style="font-size: 12px; color: #9ca3af;">This link expires in 1 hour. If you didn't submit this contribution, ignore this email.</p>
          <hr style="border-color: #374151;" />
          <p style="font-size: 12px; color: #6b7280;">UNIBATCH - Transparent Trading Fund</p>
        </div>
      `,
    });
    return { ok: true };
  } catch (error) {
    console.error('Verification email error:', error);
    return { ok: false, error: error.message };
  }
}
