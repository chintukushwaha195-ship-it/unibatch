# UNIBATCH — Transparent Trading Fund

A premium, transparent crypto-based fundraising site built with **Next.js 15**, **MongoDB**, and **Framer Motion**. Auto-updating progress via on-chain USDT (BEP20) balance polling on Binance Smart Chain, a moderated contributor wall, and a full admin dashboard.

> Live demo (source project): https://unibatch-fund.preview.emergentagent.com

---

## Features

- **6-page slider site** — Hero, About, Strategy, Support, Transparency, FAQ
- **Live on-chain donation tracking** — polls the BSC USDT contract every 2 minutes via public JSON-RPC (`eth_getLogs` on the Transfer topic). No third-party API key required.
- **Public contributor wall** — auto-generated sequential IDs (`#000001`, `#000002` …), UTC session labels (Morning / Afternoon / Evening / Night), TX-hash verifiable
- **Thank-you form** — contributors optionally opt in with a name + TX hash. Matches to existing on-chain rows automatically.
- **Admin panel** at `/admin-login` — JWT auth (HS256, native `node:crypto`, no external auth service)
  - Approve / hide / pin contributors
  - Edit About Me, Strategy, Transparency, and FAQ content live
  - Change goal amount, primary wallet, add secondary networks
  - Force immediate on-chain sync
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

> **MongoDB:** use https://www.mongodb.com/atlas (free tier is enough). Whitelist `0.0.0.0/0` or add Vercel’s IP ranges under **Network Access**.

### About the 2-minute on-chain sync on serverless

This project uses a **poll-on-demand** pattern: every incoming `GET /api/stats` or `GET /api/contributors` request triggers an on-chain scan **only if** more than 2 minutes have passed since the last sync. This means:

- No background workers / cron needed.
- Works out-of-the-box on Vercel serverless.
- The frontend polls every 15 seconds, so as long as the site has any visitor, the on-chain sync runs on schedule.

If your site sees no traffic for hours, you can add a **Vercel Cron** job (Pro plan) that hits `POST /api/sync` every 2 minutes. Example `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/sync", "schedule": "*/2 * * * *" }
  ]
}
```

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

## Backend API surface

### Public

| Method | Path                    | Description                                                     |
|--------|-------------------------|-----------------------------------------------------------------|
| GET    | `/api/stats`            | goal / raised / remaining / count / progress / wallet / network |
| GET    | `/api/contributors`     | Public list (name masked to `null` unless approved)             |
| POST   | `/api/contributors`     | Form submission: `{ name, amount, txHash? }`                     |
| GET    | `/api/content`          | Full CMS content (about / strategy / transparency / faq)        |
| POST   | `/api/sync`             | Force an on-chain sync (bypasses 2-minute cooldown)             |

### Admin (require `Authorization: Bearer <token>`)

| Method | Path                            | Description                                       |
|--------|---------------------------------|---------------------------------------------------|
| POST   | `/api/admin/login`              | `{ username, password }` → `{ token }`            |
| GET    | `/api/admin/me`                 | Verify token                                       |
| POST   | `/api/admin/recovery`           | Trigger password-recovery email (currently mocked)|
| GET    | `/api/admin/stats`              | Extended stats (pending / approved / hidden …)     |
| GET    | `/api/admin/contributors`       | Raw list of all contributors                       |
| PATCH  | `/api/admin/contributors/:id`   | Update `{ approved, highlighted, hidden, name }`   |
| PATCH  | `/api/admin/content`            | Update any of `about / strategy / transparency / faq` |
| PATCH  | `/api/admin/goal`               | `{ goal: number }`                                 |
| GET    | `/api/admin/wallets`            | List secondary wallets                             |
| POST   | `/api/admin/wallets`            | `{ label, network, address }`                      |
| DELETE | `/api/admin/wallets/:id`        | Remove a wallet                                    |
| PATCH  | `/api/admin/primary-wallet`     | `{ address }` — change polled BSC address          |
| POST   | `/api/admin/sync`               | Force sync                                         |

---

## MongoDB collections

| Collection      | Purpose                                                         |
|-----------------|-----------------------------------------------------------------|
| `contributors`  | Every donation row (form + on-chain). Fields: `id`, `displayId`, `seq`, `name`, `nickname`, `amount`, `txHash`, `fromAddress`, `blockNumber`, `session`, `createdAt`, `approved`, `highlighted`, `hidden`, `source` |
| `settings`      | Singleton with `key: 'main'`: `goal`, `primaryWallet`, `lastSyncAt`, `lastScannedBlock`, `lastSyncStatus` |
| `site_content`  | Singleton with `key: 'main'`: `about`, `strategy`, `transparency`, `faq`, `contentVersion` |
| `wallets`       | Extra display-only wallet rows                                  |

All IDs use UUIDv4. No Mongo `ObjectId` is exposed via the API.

---

## On-chain sync details

- Contract: `0x55d398326f99059fF775485246999027B3197955` (USDT BEP20, 18 decimals)
- Wallet: configurable at `/admin` → Wallets & Goal (default `0x815c9aeE32b098f7256A51957E1A4eE7290DF314`)
- Method: `eth_getLogs` filtered on the `Transfer(address,address,uint256)` topic where `to` = your wallet (padded to 32 bytes)
- Chunking: 240 blocks per RPC call, up to 8 chunks per sync (≈ 32 minutes of catch-up)
- Cooldown: 2 minutes (bypassed by `POST /api/sync` or the admin **Sync now** button)
- On first sync, `lastScannedBlock` starts at `latest - 200` (≈ 10 minutes back).

---

## Changing the admin password

Update `ADMIN_PASS` in your Vercel env vars (or `.env.local` for dev). Redeploy. Tokens issued before the change remain valid until they expire (7 days by default). To invalidate them all, also rotate `JWT_SECRET`.

---

## Copyright

© 2026 Chintu Kushwaha. All original written content, trading journals, strategy write-ups, and website design are original works. See `/legal` for the full disclaimer.
