# UNIBATCH — Transparent Trading Fund

A premium, transparent crypto-based fundraising site built with **Next.js 15**, **MongoDB**, and **Framer Motion**. Every contribution is verified against the real BSC (USDT BEP20) blockchain transaction before it counts — no admin, sync job, or contributor input is ever trusted blindly.

---

## Features

- **6-page slider site** — Hero, About, Strategy, Support, Transparency, FAQ
- **On-chain verified donations** — every submission requires a TX hash. The server reads the real transaction receipt directly from a BSC public JSON-RPC node and decodes the actual transferred amount.
- **Public contributor wall** — auto-generated sequential IDs (`#000001`, `#000002` …), UTC session labels
- **Name held back from public view until admin approval**
- **Anti tx-hash-replay protections** — unique index on txHash; 3-hour age gate on self-serve submissions
- **Admin panel** at `/admin-login` — Phase 1 secure two-factor authentication (see below)
- **Legal disclaimer** page at `/legal`
- **Fully responsive** — mobile-first, dark theme, glass cards, floating candlestick background

---

## Phase 1 — Secure Authentication

Phase 1 replaces the original plaintext-password / localStorage-token system with a production-grade two-factor login flow.

### What changed

| Area | Before (v1.0) | After Phase 1 |
|---|---|---|
| Password storage | Plaintext `ADMIN_PASS` env var | bcrypt hash (`ADMIN_PASSWORD_HASH`) |
| Auth token | JWT in `localStorage` | Signed session ID in HttpOnly cookie |
| Second factor | None | 6-digit OTP via Outlook SMTP |
| Session count | Multiple allowed | Single active session enforced |
| Device tracking | None | Browser fingerprint + IP |
| Rate limiting | None | 15-min lock → 24-h block (password); 7-day block (OTP) |

### Login flow

1. Admin navigates to `/admin-login`, enters username + password.
2. Server verifies bcrypt hash. On success, generates a cryptographically random 6-digit OTP and emails it to `RECOVERY_EMAIL` via Outlook SMTP (`smtp.office365.com:587`).
3. Admin enters the 6-digit code (valid for exactly 1 minute).
4. Server invalidates **all** previous sessions, creates a new one, and sets a `Secure; HttpOnly; SameSite=Strict` cookie. No token is ever stored in `localStorage`.

### Security rules

**Password lockout (per device = fingerprint + IP):**
- 3 wrong passwords → 15-minute lock. Shows only: _"Try again later."_
- Remaining lock time is never revealed.
- If the next login after the lock succeeds, the counter resets completely.
- Another 3 wrong passwords → 24-hour device block (checked lazily on next attempt).

**OTP lockout:**
- 3 wrong OTP codes → device blocked for 7 days.
- The message is always generic: _"Invalid or expired code."_

**General:**
- Never reveals whether username, password, or OTP was incorrect.
- Only one admin session may be active at any time. A successful login immediately invalidates all previous sessions.
- Session IDs are HMAC-signed with `SESSION_SECRET` before being stored in the cookie.

### Configuring the password

Generate a bcrypt hash of your password (cost factor 12):

```bash
node -e "const b=require('bcryptjs'); b.hash('your-password-here', 12).then(console.log)"
```

Copy the `$2b$12$...` output into `ADMIN_PASSWORD_HASH` in your environment. Do not store the plaintext password anywhere.

---

## Stack

| Layer      | Tech                                              |
|------------|---------------------------------------------------|
| Framework  | Next.js 15 (App Router, JS)                       |
| UI         | Tailwind CSS, shadcn/ui, Radix, Framer Motion     |
| Icons      | lucide-react                                      |
| Database   | MongoDB (via `mongodb` driver, no ORM)            |
| Auth       | bcrypt password hash + OTP via Outlook SMTP + Secure HttpOnly session cookie |
| On-chain   | BSC public JSON-RPC — no API key needed           |
| Hosting    | Vercel (or any Node-hosting: Render, Railway, Fly, self-hosted Docker) |

---

## Local development

### Requirements
- Node.js **>= 18.18**
- A MongoDB instance (local or Atlas)
- An Outlook / Microsoft 365 account for SMTP

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
# Edit .env.local — fill in MONGO_URL, ADMIN_USERNAME, ADMIN_PASSWORD_HASH,
# SMTP_USER, SMTP_PASSWORD, RECOVERY_EMAIL, SESSION_SECRET, JWT_SECRET

# 3. Run dev server
npm run dev
# → http://localhost:3000
```

> **Local SMTP note:** Outlook may block SMTP from IPs it doesn't recognise. For local testing you can use a service like [Mailtrap](https://mailtrap.io) and temporarily override the SMTP settings, or use an App Password if your Microsoft account supports it.

### Production build

```bash
npm install
npm run build
npm start
```

---

## Deploying to Vercel

1. Push this repo to GitHub / GitLab / Bitbucket.
2. On https://vercel.com → **New Project** → import the repo.
3. In the project settings → **Environment Variables**, add all variables from `.env.example`:
   - `MONGO_URL`, `DB_NAME`
   - `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`
   - `SMTP_USER`, `SMTP_PASSWORD`, `RECOVERY_EMAIL`
   - `SESSION_SECRET`, `JWT_SECRET`
   - `CORS_ORIGINS` (usually `*` or your domain)
4. Click **Deploy**.

> **MongoDB Atlas:** whitelist `0.0.0.0/0` or add Vercel's IP ranges under **Network Access**.

> **Outlook SMTP on Vercel:** Works from Vercel's outbound IPs. If your Microsoft account has MFA, generate an App Password (Microsoft Account → Security → App passwords).

---

## Project layout

```
app/
├─ api/[[...path]]/route.js   # ALL backend endpoints (public + admin)
├─ admin/page.js              # Admin dashboard (session-cookie protected)
├─ admin-login/page.js        # Two-factor admin sign-in (password → OTP)
├─ legal/page.js              # Legal disclaimer
├─ layout.js                  # Root layout + metadata + favicon
└─ page.js                    # 6-page slider (Hero / About / Strategy / Support / Transparency / FAQ)

components/ui/                # shadcn/ui primitives
hooks/                        # useIsMobile, useToast
lib/utils.js                  # cn() helper
public/strategy/*.png         # Strategy PDF page images
globals.css                   # Tailwind + custom utilities
tailwind.config.js            # Brand palette + animations
next.config.js                # CORS + external packages (mongodb, bcryptjs, nodemailer)
vercel.json                   # Vercel hints
.env.example                  # Full environment variable reference (Phase 1)
```

### MongoDB collections (Phase 1 additions)

| Collection | Purpose |
|---|---|
| `contributors` | Donation records (unchanged) |
| `settings` | Site config — goal, wallet (unchanged) |
| `site_content` | CMS content (unchanged) |
| `wallets` | Additional display wallets (unchanged) |
| `admin_sessions` | Active admin sessions — TTL index auto-expires |
| `admin_security` | Per-device rate-limiting state (OTP + password lockouts) |

---

## How a contribution gets verified

1. Contributor sends USDT (BEP20) to the site wallet, then fills the Support form with their name and TX hash.
2. Server calls `eth_getTransactionReceipt` on-chain and looks for a matching Transfer log.
   - **Match, tx < 3 hours old:** amount saved and counts toward goal immediately. Name pending admin approval.
   - **Match, tx > 3 hours old:** rejected — contributor must contact admin.
   - **No match / not mined:** stored hidden for admin to verify manually.
3. A tx hash can only ever be linked to one name — duplicate claims are rejected outright.

---

## Compatibility

- ✅ **Vercel** — tested with Next.js 15 App Router. `bcryptjs` and `nodemailer` are pure-Node modules added to `serverExternalPackages`.
- ✅ **MongoDB Atlas** — no schema changes to existing collections. Two new collections (`admin_sessions`, `admin_security`) are created automatically on first run with appropriate indexes (TTL on sessions, unique on deviceKey).
- ✅ **Render / Railway / Fly.io / Docker** — any Node ≥ 18.18 host works.
