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
// Outlook / Office 365 SMTP — matches the SMTP_USER account below.
const SMTP_HOST = 'smtp.office365.com';
const SMTP_PORT = 587;
const SMTP_USER      = (process.env.SMTP_USER     || '').trim();
const SMTP_PASSWORD  = (process.env.SMTP_PASSWORD || '').trim();
const RECOVERY_EMAIL = (process.env.RECOVERY_EMAIL || '').trim();

// Official outbound identity. The actual sending mailbox is still whatever
// SMTP_USER is authenticated as (Outlook requires From == the logged-in
// account, or it silently rewrites/rejects it) — so set:
//   SMTP_USER=chintukumar911@outlook.com
// in your environment for mail to actually arrive from this address.
const SENDER_NAME  = 'UNIBATCH';
const SENDER_EMAIL = SMTP_USER || 'chintukumar911@outlook.com';
const FROM_HEADER  = `"${SENDER_NAME}" <${SENDER_EMAIL}>`;

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

// ---------- Shared HTML shell ----------
// Every contributor-facing email below is wrapped in this shell so the
// brand look is consistent across OTP / verified / thank-you / custom mail.
function emailShell({ eyebrow, accent, heading, bodyHtml, footerNote }) {
  return `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;background:#0a0a1a;color:#e2e8f0;">
      <div style="padding:2px;background:linear-gradient(135deg,${accent},#0ea5e9 60%,#22d3ee);border-radius:18px;">
        <div style="background:#0f0f1e;border-radius:16px;padding:32px 28px;">
          <div style="text-align:center;margin-bottom:18px;">
            <div style="display:inline-flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:12px;background:linear-gradient(135deg,${accent},#22d3ee);font-weight:800;color:#0a0a1a;font-size:20px;">U</div>
          </div>
          ${eyebrow ? `<div style="text-align:center;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#7dd3fc;margin-bottom:6px;">${eyebrow}</div>` : ''}
          <h2 style="text-align:center;margin:0 0 20px;color:#f1f5f9;font-size:22px;">${heading}</h2>
          ${bodyHtml}
          <hr style="border:none;border-top:1px solid #1e293b;margin:28px 0 16px;" />
          <p style="font-size:11px;color:#64748b;text-align:center;margin:0;">${footerNote || 'UNIBATCH · Transparent Trading Fund'}</p>
        </div>
      </div>
    </div>
  `;
}

function shortTx(txHash) {
  return txHash ? `${txHash.slice(0, 10)}…${txHash.slice(-8)}` : '—';
}

/**
 * Step 1 — send the 6-digit ownership OTP after a contribution is matched
 * on-chain. This is what proves the person submitting the form actually
 * owns the email address tied to the contribution.
 */
export async function sendContributionOtpEmail(to, name, otp, displayId) {
  if (!isSmtpConfigured()) {
    console.error('SMTP not configured — cannot send OTP email');
    return { ok: false, error: 'SMTP not configured' };
  }
  const transporter = createTransport();
  try {
    await transporter.sendMail({
      from: FROM_HEADER,
      to,
      subject: '🔐 Confirm ownership of your contribution — UNIBATCH',
      text: [
        `Hello ${name || 'Contributor'},`,
        '',
        `Your ownership code is: ${otp}`,
        '',
        `Enter this code on the site to confirm contribution #${displayId || ''}.`,
        'This code expires in 10 minutes. Never share it with anyone.',
      ].join('\n'),
      html: emailShell({
        eyebrow: 'Ownership verification',
        accent: '#3b82f6',
        heading: '🔐 Confirm it’s really you',
        bodyHtml: `
          <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Hello <strong style="color:#f1f5f9;">${name || 'Contributor'}</strong>,</p>
          <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">We matched a contribution <strong>#${displayId || '—'}</strong> to this email address. Enter the code below on the site to prove it's yours and unlock verification.</p>
          <div style="text-align:center;margin:24px 0;">
            <div style="display:inline-block;font-size:2.1rem;font-weight:700;letter-spacing:0.4em;padding:18px 26px;background:#0a0a1a;color:#38bdf8;border:1px solid #1e40af;border-radius:12px;">${otp}</div>
          </div>
          <p style="color:#94a3b8;font-size:12px;text-align:center;">Expires in <strong>10 minutes</strong>.</p>
          <p style="color:#64748b;font-size:12px;">Didn't submit this? You can safely ignore this email — no changes are made until the code is entered.</p>
        `,
      }),
    });
    return { ok: true };
  } catch (error) {
    console.error('OTP email error:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Step 2 — sent immediately once the OTP is confirmed. Tells the
 * contributor their ownership is verified and it's now in the admin queue.
 */
export async function sendContributionVerifiedEmail(to, name, displayId, txHash) {
  if (!isSmtpConfigured()) {
    console.error('SMTP not configured — cannot send verified email');
    return { ok: false, error: 'SMTP not configured' };
  }
  const transporter = createTransport();
  try {
    await transporter.sendMail({
      from: FROM_HEADER,
      to,
      subject: '✅ Your contribution has been verified — UNIBATCH',
      text: [
        `Hello ${name || 'Contributor'},`,
        '',
        `Your contribution has been verified. Contribution #${displayId || ''}`,
        `Transaction: ${txHash || '—'}`,
        '',
        'The admin will review it and it will appear on the public wall shortly.',
      ].join('\n'),
      html: emailShell({
        eyebrow: 'Ownership confirmed',
        accent: '#22c55e',
        heading: '✅ Your contribution has been verified',
        bodyHtml: `
          <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Hello <strong style="color:#f1f5f9;">${name || 'Contributor'}</strong>,</p>
          <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Your contribution <strong>#${displayId || '—'}</strong> has been verified and ownership is confirmed. 🎉</p>
          <div style="background:#0a0a1a;border:1px solid #14532d;border-radius:10px;padding:14px 16px;margin:18px 0;">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#4ade80;margin-bottom:4px;">Transaction</div>
            <div style="font-family:monospace;font-size:12px;color:#e2e8f0;word-break:break-all;">${shortTx(txHash)}</div>
          </div>
          <p style="color:#94a3b8;font-size:13px;line-height:1.6;">It's now in the admin queue for a quick review, after which your name appears on the public contributor wall.</p>
        `,
      }),
    });
    return { ok: true };
  } catch (error) {
    console.error('Verified email error:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Step 3 — a separate, warmer thank-you note sent right after verification.
 */
export async function sendThankYouEmail(to, name, displayId, amount) {
  if (!isSmtpConfigured()) {
    console.error('SMTP not configured — cannot send thank-you email');
    return { ok: false, error: 'SMTP not configured' };
  }
  const transporter = createTransport();
  try {
    await transporter.sendMail({
      from: FROM_HEADER,
      to,
      subject: '🙏 Thank you for your support — UNIBATCH',
      text: [
        `Hello ${name || 'Contributor'},`,
        '',
        `Thank you for your contribution of $${amount != null ? Number(amount).toFixed(2) : '—'} (#${displayId || ''}).`,
        'It genuinely means a lot and directly supports the trading fund goal.',
      ].join('\n'),
      html: emailShell({
        eyebrow: 'From the team',
        accent: '#f59e0b',
        heading: '🙏 Thank you, truly',
        bodyHtml: `
          <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Hello <strong style="color:#f1f5f9;">${name || 'Contributor'}</strong>,</p>
          <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Thank you for backing UNIBATCH — contribution <strong>#${displayId || '—'}</strong> of
            <strong style="color:#facc15;">$${amount != null ? Number(amount).toFixed(2) : '—'}</strong> is confirmed and counted toward the goal.</p>
          <p style="color:#94a3b8;font-size:13px;line-height:1.6;">Support like this is what keeps this transparent and community-funded. You can track live progress and every verified transaction on the site at any time.</p>
        `,
      }),
    });
    return { ok: true };
  } catch (error) {
    console.error('Thank-you email error:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Free-form email the admin can send to any contributor from the dashboard
 * ("click to mail"). Subject/message are admin-authored; this just wraps
 * them in the same branded shell and sends from the official address.
 */
export async function sendCustomEmail(to, subject, message, name) {
  if (!isSmtpConfigured()) {
    console.error('SMTP not configured — cannot send custom email');
    return { ok: false, error: 'SMTP not configured' };
  }
  const transporter = createTransport();
  const safeMessage = String(message || '').replace(/</g, '&lt;').replace(/\n/g, '<br/>');
  try {
    await transporter.sendMail({
      from: FROM_HEADER,
      to,
      subject: subject || 'A message from UNIBATCH',
      text: String(message || ''),
      html: emailShell({
        eyebrow: 'Message from the admin',
        accent: '#a855f7',
        heading: subject || 'A message for you',
        bodyHtml: `
          <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Hello <strong style="color:#f1f5f9;">${name || 'Contributor'}</strong>,</p>
          <div style="color:#cbd5e1;font-size:14px;line-height:1.7;">${safeMessage}</div>
        `,
        footerNote: `Sent by the UNIBATCH admin · ${SENDER_EMAIL}`,
      }),
    });
    return { ok: true };
  } catch (error) {
    console.error('Custom admin email error:', error);
    return { ok: false, error: error.message };
  }
}
