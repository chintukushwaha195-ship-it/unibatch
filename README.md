# UNIBATCH — Transparent Trading Fund

A premium, transparent crypto-based fundraising site built with **Next.js 15**, **MongoDB**, and **Framer Motion**. Every contribution is verified against the real BSC (USDT BEP20) blockchain transaction before it counts — no admin, sync job, or contributor input is ever trusted blindly.

> Live demo (source project): https://unibatch-fund.preview.emergentagent.com

---

## Features

- **6-page slider site** — Hero, About, Strategy, Support, Transparency, FAQ
- **On-chain verified donations** — every submission requires a TX hash. The server reads the real transaction receipt directly from a BSC public JSON-RPC node and decodes the actual transferred amount — there is no amount field for a contributor to type or fake.
- **Public contributor wall** — auto-generated sequential IDs (`#000001`, `#000002` …), UTC session labels (Morning / Afternoon / Evening / Night)
- **Name held back from public view until admin approval** — a verified donation's *amount* counts toward the goal immediately (it's real, verified money), but the contributor's *name* only appears on the wall after an admin reviews and approves it. This stops anyone from getting an inappropriate name onto the public wall automatically.
- **Anti tx-hash-replay protections**:
  - A tx hash can only ever be claimed by one name — a second person submitting someone else's already-claimed tx hash is rejected, not allowed to overwrite it.
  - The public form only accepts tx hashes from the last 3 hours, so nobody can dig up an old, unrelated real transfer off public BscScan and claim it as their own. (Admin's manual review has no such limit — see below.)
- **No auto-sync / no cron / no background wallet scanning** — verification only happens (a) when a contributor submits a tx hash, or (b) when an admin manually links one from the dashboard. Nothing runs on a timer, and nothing runs just because someone opened a page.
- **Admin panel** at `/admin-login` — JWT auth (HS256, native `node:crypto`, no external auth service)
  - Approve / hide / pin contributors
  - Manually verify & link a tx hash to a claim that came in without one, or wasn't verifiable yet (no age limit — a human is checking it)
  - Edit About Me, Strategy, Transparency, and FAQ content live
  - Change goal amount, primary wallet, add secondary networks
- **Legal disclaimer** page at `/legal`
- **Fully responsive** — mobile-first, dark theme, glass cards, floating candlestick background per page

---

## Stack

| Layer      | Tech                                              |
|------------|---------------------------------------------------|
| Framework  | Next.js 15 (App Router, JS)                       |
| UI         | Tailwind CSS, shadcn/ui, Radix, Framer Motion     |
| Icons      | lucide-react                                      |
| Database   | MongoDB (via `mongodb` driver, no ORM)            |
| Auth       | Custom HS256 JWT (native `node:crypto`)           |
| On-chain   | BSC public JSON-RPC (`bsc-pokt.nodies.app`, `1rpc.io/bnb`) — no API key needed |
| Hosting    | Vercel (or any Node-hosting: Render, Railway, Fly, self-hosted Docker) |

---

## Local development

### Requirements
- Node.js **>= 18.18**
- A MongoDB instance (local or Atlas)

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
# then edit .env.local and fill in MONGO_URL, ADMIN_PASS, JWT_SECRET, etc.

# 3. Run dev server
npm run dev
# → http://localhost:3000
```

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
3. In the project settings → **Environment Variables**, add:
   - `MONGO_URL`
   - `DB_NAME`
   - `ADMIN_USER`
   - `ADMIN_PASS`
   - `JWT_SECRET`
   - `RECOVERY_EMAIL`
   - `CORS_ORIGINS` (usually `*` or your domain)
4. Click **Deploy**. Vercel auto-detects Next.js and runs `npm install && next build`.
5. After deploy, hit `/admin-login` to confirm access.

> **MongoDB:** use https://www.mongodb.com/atlas (free tier is enough). Whitelist `0.0.0.0/0` or add Vercel's IP ranges under **Network Access**.

There is nothing to schedule or keep warm — no cron, no Vercel Cron job, no background worker. Every request is verified on demand.

---

## Deploying elsewhere

### Render / Railway / Fly.io / Docker
Any host that runs `node` will work.

```bash
npm install
npm run build
npm start   # listens on $PORT (defaults to 3000)
```

Set the same environment variables as above.

### Self-hosting with Docker

Create a `Dockerfile` (not included by default):

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

---

## Project layout

```
app/
├─ api/[[...path]]/route.js   # ALL backend endpoints (public + admin)
├─ admin/page.js              # Admin dashboard (JWT-protected)
├─ admin-login/page.js        # Admin sign-in page
├─ legal/page.js              # Legal disclaimer
├─ layout.js                  # Root layout + metadata + favicon
└─ page.js                    # 6-page slider (Hero / About / Strategy / Support / Transparency / FAQ)

components/ui/                # shadcn/ui primitives
hooks/                        # useIsMobile, useToast
lib/utils.js                  # cn() helper
public/strategy/*.png         # Strategy PDF page images
globals.css                   # Tailwind + custom utilities
tailwind.config.js            # Brand palette + animations
next.config.js                # CORS + external MongoDB driver
vercel.json                   # Vercel hints
```

---

## How a contribution gets verified (read this before changing anything)

1. A contributor sends USDT (BEP20) to the site's wallet, then fills the Support form with their **name** and the **TX hash** of that transfer. TX hash is required — there is no amount field, the amount is never typed by a human.
2. On submit, the server calls `eth_getTransactionReceipt` for that exact tx hash and looks for a `Transfer` log where the token contract is USDT BEP20 and the recipient (`to`) is the site's wallet.
   - **Match found, tx is recent (< 3 hours old):** the real on-chain amount is saved, and it counts toward the goal **immediately**. The name is saved too, but stays hidden from the public wall until an admin approves it.
   - **Match found, but tx is older than 3 hours:** rejected with a message asking the contributor to contact admin. (Stops someone copying an old, unrelated real transfer to the wallet off public BscScan and claiming it as their own — tx hashes are public data, so age-gating self-serve claims is the main defense against this.)
   - **No match / not mined yet:** the submission is stored hidden and unverified, for admin to check manually later.
3. If someone submits a tx hash that's **already linked to a different name**, the request is rejected outright — it does not silently overwrite the existing contributor's name.
4. From the admin dashboard, any entry marked `unverified` can have a tx hash attached via **"Link & verify"**. This runs the same on-chain check (with no age limit, since a human is the one confirming it), corrects the amount from the chain, and marks it verified.
5. Approving a contributor from the admin dashboard only ever affects whether their **name** is shown — it never changes the amount, and it never re-triggers any blockchain check.

There is no periodic wallet scanning: if a donor never fills the form (or never gives admin a tx hash to link), that donation will not appear anywhere. This is intentional — it keeps every number on the site traceable to a specific tx hash someone can click through to BscScan.

---

## Backend API surface

### Public

| Method | Path                    | Description                                                        |
|--------|-------------------------|----------------------------------------------------------------------|
| GET    | `/api/stats`            | goal / raised / remaining / count / progress / wallet / network      |
| GET    | `/api/contributors`     | Public list (name masked to `null` unless approved)                   |
| POST   | `/api/contributors`     | Form submission: `{ name, txHash }` — verified on-chain before it's stored as counted |
| GET    | `/api/content`          | Full CMS content (about / strategy / transparency / faq)             |

### Admin (require `Authorization: Bearer <token>`)

| Method | Path                            | Description                                                        |
|--------|---------------------------------|------------------------------------------------------------------------|
| POST   | `/api/admin/login`              | `{ username, password }` → `{ token }`                                |
| GET    | `/api/admin/me`                 | Verify token                                                           |
| POST   | `/api/admin/recovery`           | Trigger password-recovery email (currently mocked)                     |
| GET    | `/api/admin/stats`              | Extended stats (pending / approved / hidden …)                        |
| GET    | `/api/admin/contributors`       | Raw list of all contributors                                           |
| PATCH  | `/api/admin/contributors/:id`   | Update `{ approved, highlighted, hidden, name, nickname, txHash }` — passing `txHash` verifies & links it on-chain (no age limit) |
| PATCH  | `/api/admin/content`            | Update any of `about / strategy / transparency / faq`                  |
| PATCH  | `/api/admin/goal`               | `{ goal: number }`                                                      |
| GET    | `/api/admin/wallets`            | List secondary wallets                                                 |
| POST   | `/api/admin/wallets`            | `{ label, network, address }`                                          |
| DELETE | `/api/admin/wallets/:id`        | Remove a wallet                                                         |
| PATCH  | `/api/admin/primary-wallet`     | `{ address }` — change the wallet used for verification                |

---

## MongoDB collections

| Collection      | Purpose                                                         |
|-----------------|-----------------------------------------------------------------|
| `contributors`  | Every donation row. Fields: `id`, `displayId`, `seq`, `name`, `nickname`, `amount`, `txHash`, `fromAddress`, `blockNumber`, `session`, `createdAt`, `approved` (controls name visibility only), `highlighted`, `hidden` (controls whether it's counted/shown at all), `verified` (on-chain confirmed), `source` (`form+onchain` \| `onchain` \| `form-pending`) |
| `settings`      | Singleton with `key: 'main'`: `goal`, `primaryWallet`            |
| `site_content`  | Singleton with `key: 'main'`: `about`, `strategy`, `transparency`, `faq`, `contentVersion` |
| `wallets`       | Extra display-only wallet rows                                  |

All IDs use UUIDv4. No Mongo `ObjectId` is exposed via the API.

---

## Changing the admin password

Update `ADMIN_PASS` in your Vercel env vars (or `.env.local` for dev). Redeploy. Tokens issued before the change remain valid until they expire (7 days by default). To invalidate them all, also rotate `JWT_SECRET`.

---

## Copyright

© 2026 Chintu Kushwaha. All original written content, trading journals, strategy write-ups, and website design are original works. See `/legal` for the full disclaimer.
