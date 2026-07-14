# UNIBATCH — Transparent Trading Fund

A premium, transparent crypto-based fundraising site built with **Next.js 15**, **MongoDB**, and **Framer Motion**. Every contribution is verified against the real BSC (USDT BEP20) blockchain transaction before it counts — no admin, sync job, or contributor input is ever trusted blindly.

---

## Features

- **6-page slider site** — Hero, About, Strategy, Support, Transparency, FAQ
- **On-chain verified donations** — every submission requires a TX hash. The server reads the real transaction receipt directly from a BSC public JSON-RPC node and decodes the actual transferred amount.
- **Public contributor wall** — auto-generated sequential IDs (`#000001`, `#000002` …), UTC session labels
- **Name held back from public view until admin approval**
- **Anti tx-hash-replay protections** — unique index on txHash; 3-hour age gate on self-serve submissions
- **Admin panel** at `/admin-login` — two-factor authentication (password → OTP email)
- **Legal disclaimer** page at `/legal`
- **Fully responsive** — mobile-first, dark theme, glass cards, floating candlestick background

---

## Phase 1 — Secure Authentication

Phase 1 replaces the original plaintext-password / localStorage-token system with a production-grade two-factor login flow.

### What changed (Phase 1)

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

**Password lockout (per server-observed IP — see Phase 3):**
- 3 wrong passwords → 15-minute lock. Shows only: _"Try again later."_
- Remaining lock time is never revealed.
- If the next login after the lock succeeds, the counter resets completely.
- Another 3 wrong passwords → 24-hour block (checked lazily on next attempt).
- Lockout state is keyed **only** on the server-observed client IP (`computeIpKey`). A client-supplied browser fingerprint is still collected and stored, but purely as diagnostic metadata — it has no bearing on lockout state and cannot be used to reset the attempt counter.

**OTP lockout & cooldown:**
- 3 wrong OTP codes → blocked (same IP key) for 7 days.
- OTP resend is rate-limited to once per 60 seconds per IP, independent of any client-supplied value, to prevent mailbox flooding / SMTP abuse (429 returned if a new login attempt arrives inside the cooldown window).
- OTP comparison uses `crypto.timingSafeEqual` on validated 6-digit buffers (`verifyOtp()` in `lib/auth.js`) rather than plain `===`, so a mismatch never leaks timing information.
- The message is always generic: _"Invalid or expired code."_

**General:**
- Never reveals whether username, password, or OTP was incorrect.
- Only one admin session may be active at any time. A successful login immediately invalidates all previous sessions.
- Session IDs are HMAC-signed with `SESSION_SECRET` before being stored in the cookie.

---

## Phase 2 — Clean Backend Rebuild

Phase 2 is a full rewrite of the backend (`app/api/[[...path]]/route.js`) to fix runtime errors that caused HTTP 500 on the very first login attempt. The frontend UI, all components, and the admin/login pages are **untouched** — only server code changed.

### Root causes fixed

| Bug | Symptom | Fix |
|---|---|---|
| `MONGO_URL` not validated at startup | `new MongoClient(undefined)` throws on every request → HTTP 500 | `lib/db.js` checks the variable on import and logs a clear warning; callers receive a 503 with a human-readable message |
| Module-level `let db` pattern | Reconnect after a network drop reused a stale, closed client | Promise-based singleton in `lib/db.js`; clears on the `close` event and reconnects fresh |
| No input coercion | `body.username` fed directly into `.startsWith()` when undefined → `TypeError` | Every body field coerced to `String(value ?? '')` before any string method |
| Empty `ADMIN_PASSWORD_HASH` | bcrypt compare with empty string silently always failed with 500 | `checkAdminCredentials()` verifies the hash starts with `$2` before calling bcrypt; warns at startup if missing |
| SMTP errors propagated as 500 | Any nodemailer failure during OTP send returned a cryptic 500 | `sendOtpEmail()` wraps transport in try/catch and returns `{ ok, error }`; caller returns 503 if not configured, 500 with message otherwise |
| No separation of concerns | All logic in one 600-line route file, impossible to unit-test or maintain | Refactored into focused `lib/` modules (see below) |

### New `lib/` module layer

| File | Responsibility |
|---|---|
| `lib/db.js` | MongoDB connection — Promise-based singleton, auto-reconnects on `close`, creates indexes on boot, throws a descriptive error on missing `MONGO_URL` |
| `lib/auth.js` | Device key (SHA-256 of fingerprint + IP), HMAC session cookie signing / unsigning, `validateSession()`, `createSession()`, `checkAdminCredentials()` (bcryptjs, constant-time username compare), `generateOtp()`, JWT sign / verify |
| `lib/email.js` | `sendOtpEmail()`, `sendRecoveryEmail()`, `isSmtpConfigured()` — hardcoded to `smtp.office365.com:587` STARTTLS; only credentials and destination are env-configurable |
| `lib/blockchain.js` | `verifyTxOnChain()`, `normalizeTxHash()`, `DEFAULT_WALLET` — BSC JSON-RPC with 3-URL fallback, safe against any input |
| `lib/api-utils.js` | Server-only helpers: `json()` (NextResponse + CORS), `applyCors()`, `maskEmail()`, `pad6()`, `sessionLabelFromUtc()` |
| `lib/utils.js` | **Unchanged** — `cn()` helper used by all shadcn/ui components |

### HTTP response contract (Phase 2)

| Scenario | HTTP Status |
|---|---|
| MongoDB unavailable | 503 |
| SMTP not configured | 503 |
| Wrong credentials / bad OTP | 401 — generic message only, never reveals which field failed |
| Rate-limited / blocked | 429 |
| Validation error | 400 |
| Unknown route | 404 |
| Unexpected error | 500 — message logged server-side, generic text returned to client |

### Configuring the password

Generate a bcrypt hash of your password (cost factor 12):

```bash
node -e "const b=require('bcryptjs'); b.hash('your-password-here', 12).then(console.log)"
```

Copy the `$2b$12$...` output into `ADMIN_PASSWORD_HASH` in your environment. Do not store the plaintext password anywhere.

---

## Phase 3 — Security Hardening (Post-Audit Fixes)

Phase 3 addresses every finding from the production-readiness security audit. All fixes are scoped, additive changes to `lib/auth.js`, `lib/blockchain.js`, `lib/db.js`, `lib/email.js`, `next.config.js`, and `app/api/[[...path]]/route.js` — no architecture, frontend, or unrelated logic changes.

| # | Issue | Fix | Status |
|---|---|---|---|
| 1 | Brute-force lockout bypassable via client-controlled fingerprint | Lockout state keyed only on server-observed IP (`computeIpKey`); fingerprint kept as diagnostic metadata only | ✅ Done |
| 2 | No cooldown on OTP email dispatch (mailbox flooding) | 60-second per-IP cooldown before a new OTP can be sent; 429 if violated | ✅ Done |
| 3 | OTP compared with plain `===` (timing side-channel) | `verifyOtp()` validates 6-digit format then compares via `crypto.timingSafeEqual` | ✅ Done |
| 4 | Donation attribution hijackable via public tx hashes | Campaign progress now sourced from a separate `donations` collection populated purely from verified on-chain transfers; the contributor form only submits **pending** attribution claims for admin approval — a stolen tx hash can no longer buy a public name | ✅ Done |
| 5 | Unauthenticated endpoint could trigger unlimited RPC calls | Per-IP rate limiting on `POST /contributors`; hash format validated and duplicate hashes short-circuited before any RPC call | ✅ Done |
| 6 | Race condition could create duplicate `settings`/`site_content` docs | Unique index on `key` + atomic `updateOne(upsert:true)` | ✅ Done |
| 7 | `countDocuments()+1` could assign duplicate display IDs | Atomic `counters` collection via `findOneAndUpdate($inc)` | ✅ Done |
| 8 | Concurrent first-time logins could throw on duplicate-key upsert | `safeUpsert()` helper retries once on Mongo error `11000` instead of 500ing | ✅ Done |
| 9 | On-chain verification ignored reorg risk | Configurable `MIN_CONFIRMATIONS`; transactions with insufficient confirmations return a `pending` status instead of immediate `verified` | ✅ Done |
| 10 | Internal DB error messages leaked to clients | Generic client message; full error + stack logged server-side only | ✅ Done |
| 11 | Wallet addresses accepted with no format validation | EVM address regex validation on `POST /admin/wallets` and `PATCH /admin/primary-wallet`, rejected with 400 | ✅ Done |
| 12 | Missing HTTP security headers | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Strict-Transport-Security`, and a CSP added in `next.config.js` | ✅ Done |
| 13 | SMTP transporter forced a legacy `SSLv3` cipher alias | Removed; Node/OpenSSL now negotiates modern TLS with `smtp.office365.com` | ✅ Done |
| 15 | `maxPoolSize: 10` unsuited to serverless | Reduced to a serverless-appropriate pool size | ✅ Done |

> Note: item numbering follows the original audit/fix request order; there is no separate "#14" in this project's fix list.



| Layer      | Tech                                              |
|------------|---------------------------------------------------|
| Framework  | Next.js 15 (App Router, JS)                       |
| UI         | Tailwind CSS, shadcn/ui, Radix, Framer Motion     |
| Icons      | lucide-react                                      |
| Database   | MongoDB (via `mongodb` driver, no ORM)            |
| Auth       | bcryptjs password hash + OTP via Outlook SMTP + Secure HttpOnly session cookie |
| On-chain   | BSC public JSON-RPC — no API key needed           |
| Hosting    | Vercel (or any Node ≥ 18.18 host)                |

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
# Edit .env.local — fill in all variables (see Environment variables below)

# 3. Run dev server
npm run dev
# → http://localhost:3000
```

> **Local SMTP note:** Outlook may block SMTP from IPs it doesn't recognise. For local testing you can use a service like [Mailtrap](https://mailtrap.io) and temporarily swap in its credentials, or use a Microsoft App Password.

### Production build

```bash
npm install
npm run build
npm start
```

---

## Environment variables

See `.env.example` for all variables with generation instructions.

| Variable | Required | Description |
|---|---|---|
| `MONGO_URL` | ✅ | MongoDB connection string e.g. `mongodb+srv://user:pass@cluster.mongodb.net/` |
| `DB_NAME` | ✅ | Database name e.g. `unibatch` |
| `ADMIN_USERNAME` | ✅ | Admin login username |
| `ADMIN_PASSWORD_HASH` | ✅ | bcrypt hash (`$2b$12$…`) of the admin password — **never** the plaintext |
| `SMTP_USER` | ✅ | Outlook / M365 email address used to send OTPs |
| `SMTP_PASSWORD` | ✅ | Outlook password or App Password |
| `RECOVERY_EMAIL` | ✅ | Destination address for OTP and recovery emails |
| `SESSION_SECRET` | ✅ | Random 64-char hex string — used to HMAC-sign session cookies |
| `JWT_SECRET` | ✅ | Random 64-char hex string — used for JWT signing |
| `CORS_ORIGINS` | optional | Allowed CORS origin(s), default `*` |
| `MIN_CONFIRMATIONS` | optional | Blocks required on top of a transaction before it's credited to the campaign total (Phase 3, Fix #9). Defaults to `3`. |

Generate `SESSION_SECRET` and `JWT_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Deploying to Vercel

1. Push this repo to GitHub / GitLab / Bitbucket.
2. On https://vercel.com → **New Project** → import the repo.
3. In the project settings → **Environment Variables**, add all variables listed above.
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

lib/
├─ db.js                      # MongoDB singleton connection + index bootstrap
├─ auth.js                    # Session, device key, bcrypt verify, OTP, JWT
├─ email.js                   # nodemailer OTP + recovery email helpers
├─ blockchain.js              # BSC JSON-RPC tx verification
├─ api-utils.js               # Server-only: json(), applyCors(), maskEmail(), pad6()
└─ utils.js                   # cn() helper for shadcn/ui components

components/ui/                # shadcn/ui primitives (untouched)
hooks/                        # useIsMobile, useToast
public/strategy/*.png         # Strategy PDF page images
globals.css                   # Tailwind + custom utilities
tailwind.config.js            # Brand palette + animations
next.config.js                # serverExternalPackages: mongodb, bcryptjs, nodemailer
vercel.json                   # Vercel deployment hints
.env.example                  # Full environment variable reference with generation commands
```

### MongoDB collections

| Collection | Purpose |
|---|---|
| `contributors` | Attribution submissions — name, message, txHash, `approved`/`hidden` booleans, sequential display ID. Has no effect on campaign progress. |
| `donations` | Verified on-chain transfers only — the sole source of campaign progress. Populated automatically whenever a transaction to the campaign wallet reaches `MIN_CONFIRMATIONS`. |
| `settings` | Site config — goal amount, primary wallet address (unique index on `key`) |
| `site_content` | CMS editable content blocks (unique index on `key`) |
| `wallets` | Additional display wallet addresses (EVM-format validated) |
| `counters` | Atomic sequence counters (e.g. contributor display IDs) — avoids race conditions from count-then-assign patterns |
| `admin_sessions` | Active admin sessions — TTL index auto-expires entries |
| `admin_security` | Per-IP rate-limiting state (password + OTP lockouts, OTP cooldown) |

---

## How a contribution gets verified

Progress and attribution are deliberately separate (Phase 3, Fix #4):

1. Contributor sends USDT (BEP20) to the site wallet, then fills the Support form with their name and TX hash.
2. Server checks the `contributors` collection first — if this `txHash` has already been submitted, the **original** submission is returned as-is; a later resubmission (e.g. someone copying a public tx hash from BscScan) can never overwrite or steal an existing claim.
3. Only for a not-yet-claimed hash does the server call `eth_getTransactionReceipt` on-chain and look for a matching Transfer log:
   - **Confirmed** (≥ `MIN_CONFIRMATIONS` blocks mined on top): the amount is written to the `donations` collection immediately and counts toward the public goal — regardless of whether this submission is ever approved. The contributor doc is stored `hidden: true, approved: false` for admin review.
   - **Pending** (found on-chain, but under the confirmation threshold): stored with `amount: 0`, not yet credited, to avoid counting a transaction that could still be reorged out. Re-submitting the same hash later will re-check and credit it once confirmed.
   - **No match / not mined:** stored hidden for admin to verify manually.
4. An admin reviews pending submissions in `/admin` and explicitly approves (`approved: true`) before a name ever appears on the public contributor wall. The campaign total was already counted at step 3 — approval only affects *whose name is shown*, never the total.

---

## Compatibility

- ✅ **Vercel** — tested with Next.js 15 App Router. `bcryptjs` and `nodemailer` are pure-Node modules declared in `serverExternalPackages`.
- ✅ **MongoDB Atlas** — no schema changes to existing collections. Two new collections (`admin_sessions`, `admin_security`) are created automatically on first run with appropriate indexes (TTL on sessions, unique on deviceKey).
- ✅ **Render / Railway / Fly.io / Docker** — any Node ≥ 18.18 host works.
