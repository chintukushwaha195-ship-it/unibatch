/**
 * app/api/[[...path]]/route.js
 *
 * UNIBATCH — complete API surface (Phase 2 clean rebuild).
 *
 * Architecture:
 *  - All shared logic lives in lib/ (db, auth, email, blockchain, utils).
 *  - This file is ONLY routing, request parsing, business logic, and responses.
 *  - Every route is inside the single try/catch in handle().
 *  - DB errors → 503  (never 500 for infrastructure failures)
 *  - Bad credentials → 401 (never 500 for wrong username/password)
 *  - Bad input → 400
 *  - Auth required but missing → 401
 *  - Not found → 404
 *  - Everything unexpected → 500 with a sanitised message (no stack traces)
 *
 * Route map:
 *
 *  PUBLIC (no auth)
 *    GET  /stats
 *    GET  /contributors
 *    POST /contributors
 *    GET  /content
 *
 *  ADMIN AUTH (no session required — these establish the session)
 *    POST /admin/login         step 1: password → OTP email
 *    POST /admin/verify-otp    step 2: OTP → session cookie
 *    POST /admin/logout        clears session cookie + DB record
 *    POST /admin/recovery      sends recovery instructions via SMTP
 *
 *  ADMIN (Secure HttpOnly session cookie required)
 *    GET  /admin/me
 *    GET  /admin/stats
 *    GET  /admin/contributors
 *    PATCH /admin/contributors/:id
 *    PATCH /admin/content
 *    PATCH /admin/goal
 *    GET  /admin/wallets
 *    POST /admin/wallets
 *    DELETE /admin/wallets/:id
 *    PATCH /admin/primary-wallet
 */

import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

import { getDb }               from '@/lib/db';
import {
  ADMIN_USERNAME,
  SESSION_COOKIE,
  getClientIp,
  computeDeviceKey,
  computeIpKey,
  applySessionCookie,
  clearSessionCookie,
  unsignSession,
  validateSession,
  createSession,
  checkAdminCredentials,
  generateOtp,
  verifyOtp,
  hashOtp,
  compareOtp,
}                              from '@/lib/auth';
import { sendOtpEmail, sendRecoveryEmail, maskedRecoveryEmail, isSmtpConfigured } from '@/lib/email';
import { verifyTxOnChain, normalizeTxHash, DEFAULT_WALLET } from '@/lib/blockchain';
import { json, applyCors, maskEmail, sessionLabelFromUtc, pad6 } from '@/lib/api-utils';

// ---------- Constants ----------
const DEFAULT_GOAL = 250;

// EVM/BEP20 address format: 0x + 40 hex chars.
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

// OTP resend cooldown — independent of any client-supplied value.
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

// Password-recovery email rate limiting — independent of any client-supplied
// value, keyed only on the server-observed IP (ipKey), matching the pattern
// used for OTP resend above. Prevents unlimited recovery-email spam:
//   - Minimum gap between any two recovery emails.
//   - Hard cap on recovery emails sent within a rolling window.
const RECOVERY_RESEND_COOLDOWN_MS = 60 * 1000;        // 1 minute between sends
const RECOVERY_MAX_PER_WINDOW     = 5;                 // max sends per window
const RECOVERY_WINDOW_MS          = 60 * 60 * 1000;    // 1-hour rolling window

// ---------- Simple in-memory IP rate limiter (POST /contributors) ----------
// Best-effort: resets on cold start, which is acceptable for this limiter's
// purpose (blunting bursts from a single serverless instance). Combined with
// the DB-backed duplicate/verification short-circuits below, this keeps
// outbound RPC calls bounded even across many instances.
const CONTRIBUTORS_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const CONTRIBUTORS_RATE_LIMIT_MAX = 10;
const _contributorsRateLimitState = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const key = String(ip || 'unknown');
  const entry = _contributorsRateLimitState.get(key);
  if (!entry || now - entry.windowStart > CONTRIBUTORS_RATE_LIMIT_WINDOW_MS) {
    _contributorsRateLimitState.set(key, { windowStart: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > CONTRIBUTORS_RATE_LIMIT_MAX;
}

// ---------- Safe upsert (retries once on a duplicate-key race) ----------
async function safeUpsert(collection, filter, update) {
  try {
    return await collection.updateOne(filter, update, { upsert: true });
  } catch (e) {
    if (e?.code === 11000) {
      // Another concurrent request just inserted the same document —
      // the row now exists, so a plain update (still upsert:true as a
      // belt-and-suspenders) will succeed.
      try {
        return await collection.updateOne(filter, update, { upsert: true });
      } catch (e2) {
        if (e2?.code === 11000) {
          // Structural conflict, not a transient race (e.g. a unique index
          // on a secondary field — such as deviceKey — that isn't scoped
          // with a partial filter, so multiple documents missing that field
          // collide as duplicate nulls). Retrying the identical operation
          // fails identically. Drop the offending field from this write and
          // retry once more, so a stale/misconfigured index on one field
          // never blocks writes to the document identified by `filter`.
          const keyPattern = e2?.keyPattern || e2?.errorResponse?.keyPattern;
          const offendingField = keyPattern ? Object.keys(keyPattern)[0] : null;
          if (offendingField && update?.$set && offendingField in update.$set) {
            const sanitized = { ...update, $set: { ...update.$set } };
            delete sanitized.$set[offendingField];
            return collection.updateOne(filter, sanitized, { upsert: true });
          }
        }
        throw e2;
      }
    }
    throw e;
  }
}

// ---------- Atomic contributor sequence counter ----------
async function nextContributorSeq(database) {
  const counters = database.collection('counters');
  const doc = await counters.findOneAndUpdate(
    { key: 'contributorSeq' },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  // Driver compatibility: some versions/configs wrap the doc as { value }.
  const result = doc && typeof doc === 'object' && 'value' in doc ? doc.value : doc;
  return result?.seq || 1;
}

// ============================================================
// Settings helpers
// ============================================================
async function getSettings(database) {
  const col = database.collection('settings');
  // Atomic upsert — $setOnInsert only takes effect if no "main" document
  // exists yet, so concurrent cold-start calls can never create duplicates
  // (settings.key has a unique index — see lib/db.js ensureIndexes).
  await col.updateOne(
    { key: 'main' },
    {
      $setOnInsert: {
        key: 'main',
        goal: DEFAULT_GOAL,
        primaryWallet: DEFAULT_WALLET,
        lastSyncAt: 0,
        createdAt: new Date().toISOString(),
      },
    },
    { upsert: true }
  );
  return col.findOne({ key: 'main' });
}

async function setSettings(database, patch) {
  const col = database.collection('settings');
  await col.updateOne({ key: 'main' }, { $set: patch }, { upsert: true });
  return getSettings(database);
}

// ============================================================
// Content helpers + static defaults
// ============================================================
const DEFAULT_CONTENT = {
  contentVersion: 2,
  about: {
    intro: {
      fullName: 'Chintu Kumar',
      location: 'Uttar Pardesh (currently living in Haryana, India)',
      experience: 'Over 1 year of trading',
      markets: 'Focused on stable markets like EUR/USD (CFD). Occasionally Gold when opportunity presents.',
      milestones: 'Took loans from friends and family, rebuilt from deep losses, paid every loan back. Today debt-free.',
      motivation: 'Part-time freelancer and trader. Dropped out of college to support my family. Goal: move family from rented house into a home of our own.',
    },
    chapters: [
      {
        letter: 'a',
        title: 'How I discovered trading',
        body: 'I had known about trading and the stock market for a long time, and I always enjoyed learning about how financial markets work. However, my real interest started when one of my older friends began making profits through options trading. After he explained how trading worked, I became genuinely curious and decided to give it a try myself. What made it even more inspiring was that he was also underage, just like me, which made me believe that I could learn it too. Around the same time, social media algorithms started showing me more trading-related content, which further strengthened my interest and motivated me to dive deeper into trading.',
      },
      {
        letter: 'b',
        title: 'The early days — struggles, blown accounts, lessons',
        body: 'I started my trading journey around the beginning of last year after downloading Dhan, a stock trading platform. At that time, I genuinely felt like I was ahead of people my age because I had discovered something that seemed full of opportunity. However, reality turned out to be very different. I signed up in the app through my elder brother.\n\nTo place my first NIFTY options trade, I had to save money and even borrow small amounts from friends because I couldn\u2019t afford the minimum lot size on my own. During my very first trade, I saw profits initially, but I had almost no understanding of risk management or stop-losses. I kept holding the position, believing the market would eventually move back in my favor. Instead, my broker automatically squared off my position, and I experienced my first real trading loss. That moment taught me that confidence without knowledge can be very expensive.\n\nIn the months that followed, I repeated many common beginner mistakes. I chased big profits instead of focusing on consistency, overtraded to recover losses, and depended too much on trading instead of building another source of income. I also failed several funded account challenges \u2014 around seven or eight in total. While those accounts weren\u2019t very expensive individually, they represented a significant amount for someone from a low-income background like me.\n\nBecause of my limited capital, I often relied on small loans from friends to keep going. The financial pressure became overwhelming, and eventually I realized that this approach wasn\u2019t sustainable. During the winter, I worked almost around the clock doing freelance work to repay everyone I had borrowed from. It took time, but I took full responsibility and paid every loan back. That experience changed my mindset far more than any trading loss ever could.\n\nToday, after spending around a year and a half studying the markets, I approach trading with much greater patience and discipline. I haven\u2019t taken many live trades in recent months because my focus has been on improving my strategy, reviewing the markets daily, and preparing myself properly before risking capital again.',
      },
      {
        letter: 'c',
        title: 'The turning point \u2014 becoming disciplined and consistent',
        body: 'My biggest turning point came during the winter of last year. After taking too many risks in an attempt to recover my losses, I was finally able to earn enough to pay off a large portion of my debt. That experience made me realize that constantly taking high-risk trades is not a sustainable way to build a trading career.\n\nToday, I don\u2019t trade with real capital because the income I earn from my freelance work on Upwork is used to support my family, cover personal expenses, and pay my monthly obligations. Unlike before, I am no longer emotionally or financially dependent on trading for income.\n\nThat change in mindset has made me far more disciplined. My goal now is not to chase quick profits but to trade with patience, proper risk management, and consistency. I would rather wait for high-quality setups than force trades just to make money.',
      },
      {
        letter: 'd',
        title: 'Where I am today \u2014 current skill level and focus',
        body: 'After experiencing several losses in the stock market, I discovered the world of forex trading and learned about proprietary trading firms that provide funded accounts to traders who successfully pass their evaluation challenges. That immediately caught my interest because it offered a way to trade professionally without needing a large amount of personal capital.\n\nI didn\u2019t quit the stock market \u2014 instead, I saw forex as an opportunity to diversify my knowledge and eventually diversify my trading risk. I dedicated a significant amount of time to learning the forex market, although I also experienced many losses there. Those experiences taught me valuable lessons about discipline, patience, and the importance of following a structured trading plan.\n\nI don\u2019t consider myself an expert, nor do I like to rate my own skills. I would describe myself as a serious and committed beginner who is determined to keep improving. Regardless of the challenges or setbacks I face, I have never considered giving up on trading. My current goal is to raise enough capital to trade responsibly, and I will explain my trading strategy and skill set in more detail on the next page.',
      },
      {
        letter: 'e',
        title: 'Why $250 \u2014 exactly how I will use it',
        body: 'I don\u2019t base my trading journey on receiving funding from someone else. Even if I don\u2019t receive this grant, I will continue building my trading capital through my freelance work. My commitment to trading doesn\u2019t depend on this opportunity \u2014 it only affects how quickly I can reach my goals.\n\nIf I am awarded the $250, I will use it responsibly to accelerate my progress, not to take unnecessary risks. My long-term vision goes beyond my own success. I want to build a project that helps genuine and serious traders who struggle with limited capital, just as I once did.\n\nI know how difficult it is for talented traders to give up simply because they lack financial resources. If I succeed, I want to use my experience to create opportunities for others who are willing to put in the same dedication and hard work.\n\nI don\u2019t want to be the last person who benefits from this opportunity \u2014 I want to create opportunities so that others can benefit too.',
      },
    ],
  },
  strategy: {
    approach: 'My trading approach is primarily based on price action, but I don\u2019t rely on price action alone. Before looking for an entry, I focus on understanding the overall market context and structure. I believe that trading with the broader market direction provides higher-probability setups.\n\nMost of my entries are based on trendline reactions and market structure breaks rather than relying on a single indicator or pattern. I also pay close attention to small details that many traders overlook, such as precise trendline alignment, reaction points, and how price behaves around key levels. These subtle confirmations help me filter out weaker setups and improve the quality of my trades.',
    markets: 'I mainly focus on the forex market, particularly EUR/USD.',
    riskFull: 'My risk management depends on the size and purpose of the trading account. When trading a $250 account, maximum risk per trade is approximately 1/25 of the account size. I use a stop-loss on every single trade without exception.',
    routineFull: 'I begin market analysis around 11:30 AM IST, preparing for the London session. I spend around three to four hours observing the market and waiting patiently for a setup that meets my criteria.',
    toolsFull: 'For chart analysis: TradingView. For trade execution: MetaTrader 5 with RoboForex.',
    tools: ['TradingView', 'MetaTrader 5 (MT5)', 'RoboForex (broker)', 'ForexFactory calendar', 'Custom personal journal', 'RSI Divergence \u00b7 Volume Profile'],
    rules: [
      'I never place a trade without a stop-loss, even for scalping setups. Capital preservation always comes first.',
      'I never trade during high-impact (red-folder) economic news events.',
      'I never try to recover losses by scalping or taking impulsive trades.',
      'If I take a loss during my planned intraday session, I stop trading for the rest of that session.',
      'If my trading setup is not present, I simply don\u2019t trade.',
    ],
    differentiator: 'What sets me apart is my long-term commitment. I don\u2019t see trading as a shortcut \u2014 I see it as a profession I want to build over the course of my life.',
    usage: 'If I receive the $250, I will use the entire amount as trading capital in a personal live account with full transparency.',
    riskStats: [
      { label: 'Risk per trade (on $250)', value: '~1/25' },
      { label: 'Avg risk : reward',         value: '1 : 3' },
      { label: 'Quality trades / day',       value: '1' },
      { label: 'Stop-loss on every trade',   value: 'Always' },
    ],
    strategies: [
      {
        name: 'Compression',
        volume: 'Volume 1',
        caption: 'A Higher-Timeframe Trend Compression Breakout & Reclaim Strategy',
        images: ['/strategy/compression-1.png', '/strategy/compression-2.png'],
        sections: [
          { heading: 'Strategy Overview', body: 'The Compression Strategy is a trend-following breakout methodology designed to identify periods where price compresses between converging support and resistance trendlines before expanding into a new directional move. Rather than entering immediately after a breakout, the strategy waits for confirmation through a successful reclaim of the broken structure.' },
          { heading: 'Market Theory', body: 'Trending markets often pause before their next expansion. During this pause, buyers continue creating higher lows while sellers defend lower highs, creating compression. Liquidity builds inside this structure until price eventually breaks out.' },
          { heading: 'Best Markets', body: 'Recommended: EUR/USD, GBP/USD and NZD/USD.' },
          { heading: 'Breakout Confirmation', body: 'A breakout alone is never an entry signal. Wait for a Break of Structure, trendline reclaim and Higher Timeframe candle confirmation.' },
          { heading: 'Entry Rules', body: 'Enter only after price retests the broken trendline and the Higher Timeframe candle confirms the breakout.' },
          { heading: 'Stop-Loss', body: 'Place the stop-loss below the latest swing low for long positions (or above the latest swing high for shorts).' },
          { heading: 'Profit Target', body: 'Targets should be based on the next liquidity level or major market structure.' },
          { heading: 'Risk Management', body: 'Always trade with a stop-loss, never force entries, never ignore Higher Timeframe confirmation.' },
          { heading: 'Final Philosophy', body: 'The Compression Strategy is not designed to predict breakouts \u2014 it is designed to confirm them.' },
        ],
      },
      {
        name: 'Twice Trend Setup',
        volume: 'Volume 2',
        caption: 'A Higher-Timeframe Trend Continuation Strategy with Dynamic Trendline Reclaim',
        images: ['/strategy/twicetrend-1.png', '/strategy/twicetrend-2.png'],
        sections: [
          { heading: 'Strategy Overview', body: 'The Twice Trend Setup is a trend continuation methodology designed to identify a second continuation opportunity inside an already established trend.' },
          { heading: 'Market Theory', body: 'A strong trend frequently develops smaller internal trends before continuing. After an internal resistance or support trendline is broken, that same trendline often changes its role.' },
          { heading: 'Entry Rules', body: 'Never enter simply because price touches the reclaimed trendline. Wait for a Higher Timeframe rejection candle to close and confirm.' },
          { heading: 'Stop-Loss', body: 'Place the stop-loss below the Higher Timeframe rejection candle for long positions or above it for short positions.' },
          { heading: 'Risk Management', body: 'Always trade with the dominant trend, wait for Higher Timeframe confirmation, avoid emotional entries.' },
          { heading: 'Final Philosophy', body: 'The strongest trends rarely end after their first expansion. They often provide another continuation opportunity for traders willing to wait for confirmation.' },
        ],
      },
      {
        name: 'First Taker',
        volume: 'Volume 3',
        caption: 'A Predictive Trendline Strategy Based on Early Market Participation & Liquidity Psychology',
        images: ['/strategy/firsttaker-1.png', '/strategy/firsttaker-2.png', '/strategy/firsttaker-3.png'],
        sections: [
          { heading: 'Strategy Overview', body: 'The First Taker Strategy focuses on identifying high-probability continuation opportunities before a trendline becomes obvious to the majority of traders.' },
          { heading: 'ABS Line', body: 'The ABS (Absolute Structure) Line is created by connecting the previous structural swing with the small rejection formed immediately after the breakout candle.' },
          { heading: 'Entry Rules', body: 'The preferred opportunity is the first interaction with the ABS Line. Wait for a lower timeframe rejection and clear price action confirmation before entering.' },
          { heading: 'Stop-Loss', body: 'Place the stop-loss beyond the rejection candle while leaving enough room for natural price movement.' },
          { heading: 'Profit Target', body: 'Targets should be based on the next liquidity objective or the following liquidity level if momentum remains strong.' },
          { heading: 'Final Philosophy', body: 'The best opportunities often appear before they become obvious.' },
        ],
      },
    ],
  },
  transparency: {
    forexFactoryUrl: 'https://www.forexfactory.com/tradeexplorer.php?do=account&id=96&note=UNIBATCH+%24250',
    binanceId:       '1120105237',
    email:           'chintukumar911@outlook.com',
    instagram:       '',
    tradingView:     '',
    responseHours:   36,
    timezone:        'IST',
  },
  faq: [
    { q: 'What is UNIBATCH?',                       a: 'UNIBATCH is a personal trading education and transparency platform with a voluntary fundraising campaign.' },
    { q: 'Why are you raising funds?',              a: 'To support trading capital, website development, educational content, research, and infrastructure.' },
    { q: 'Is this an investment opportunity?',      a: 'No. This is not an investment, equity campaign, or profit-sharing program. Contributions are voluntary donations.' },
    { q: 'Will I receive any profits or returns?',  a: 'No. Donations do not provide ownership, dividends, revenue sharing, or guaranteed returns.' },
    { q: 'Which cryptocurrencies do you accept?',   a: 'Currently: USDT (BEP20). More networks may be added in the future.' },
    { q: 'How does the progress bar work?',         a: 'The donation progress is automatically updated by monitoring verified blockchain transactions.' },
    { q: 'Why hasn\u2019t my donation appeared yet?',  a: 'Blockchain confirmations require time. Updates may take several minutes after a transaction is mined.' },
    { q: 'Can I verify my donation was received?',  a: 'Yes. Every donation can be verified on the blockchain using the transaction hash (TXID).' },
    { q: 'Is my personal information stored?',      a: 'No. The site does not collect personal information. Only public blockchain data is used for verification.' },
    { q: 'Can donations be refunded?',              a: 'No. Blockchain transactions are irreversible. All contributions are voluntary donations.' },
    { q: 'Are the strategies financial advice?',    a: 'No. All strategies are for educational purposes only. Always conduct your own research before trading.' },
    { q: 'Can I verify your trading performance?',  a: 'Yes. Statistics and public profiles are available in the Transparency section.' },
    { q: 'Will more strategies be added?',          a: 'Yes. The library will expand with new concepts, risk management guides, and educational content.' },
    { q: 'How secure is this website?',             a: 'Security is a priority. Admin access uses two-factor authentication and server-side sessions.' },
    { q: 'How can I contact you?',                  a: 'Email: chintukumar911@outlook.com' },
    { q: 'Where can I follow updates?',             a: 'Updates will be published on this website and linked social profiles.' },
  ],
};

async function getContent(database) {
  const col = database.collection('site_content');
  // Atomic upsert — see getSettings() above for why this avoids duplicate
  // "main" documents under concurrent cold starts (site_content.key has a
  // unique index — see lib/db.js ensureIndexes).
  await col.updateOne(
    { key: 'main' },
    { $setOnInsert: { key: 'main', ...DEFAULT_CONTENT, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
  return col.findOne({ key: 'main' });
}

async function setContent(database, patch) {
  const col = database.collection('site_content');
  await col.updateOne(
    { key: 'main' },
    { $set: { ...patch, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
  return getContent(database);
}

// ============================================================
// Public stats
// ============================================================
async function computeStats(database) {
  // Progress is calculated ONLY from verified on-chain donations — it never
  // depends on contributor attribution records (name/nickname), and is
  // credited the moment a transaction is confirmed on-chain regardless of
  // whether the donor ever submits (or an admin approves) the attribution
  // form. See the `donations` collection, populated in POST /contributors
  // and PATCH /admin/contributors/:id whenever a tx reaches 'confirmed'.
  const donationsCol = database.collection('donations');
  const settings      = await getSettings(database);
  const agg = await donationsCol.aggregate([
    { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]).toArray();
  const raised = Number(agg[0]?.total) || 0;
  const count  = Number(agg[0]?.count) || 0;
  const goal   = Number(settings.goal) || DEFAULT_GOAL;

  return {
    goal,
    raised:     Number(raised.toFixed(2)),
    remaining:  Number(Math.max(0, goal - raised).toFixed(2)),
    count,
    progress:   Number(Math.min(100, (raised / goal) * 100).toFixed(2)),
    wallet:     settings.primaryWallet || DEFAULT_WALLET,
    network:    'USDT (BEP20)',
    lastSyncAt: settings.lastSyncAt || 0,
  };
}

// ---------- Donation ledger helper ----------
/**
 * Idempotently records a fully-confirmed on-chain transfer into the
 * `donations` collection, which is the sole source for computeStats().
 * Safe to call multiple times for the same txHash (unique index + upsert).
 * Contains no name/nickname/attribution fields by design.
 */
async function recordDonation(database, { txHash, amount, fromAddress, blockNumber }) {
  const col = database.collection('donations');
  try {
    await col.updateOne(
      { txHash },
      {
        $setOnInsert: {
          txHash,
          amount,
          fromAddress,
          blockNumber,
          verifiedAt: new Date().toISOString(),
        },
      },
      { upsert: true }
    );
  } catch (e) {
    if (e?.code !== 11000) throw e;
  }
}

// ============================================================
// CORS preflight
// ============================================================
export async function OPTIONS() {
  return applyCors(new NextResponse(null, { status: 204 }));
}

// ============================================================
// Main handler
// ============================================================
async function handle(request, { params }) {
  // ---------- Parse route — always produces a string ----------
  let route = '/';
  let pathSegs = [];
  try {
    const resolved = await params;
    pathSegs = Array.isArray(resolved?.path) ? resolved.path : [];
    route = '/' + pathSegs.join('/');
  } catch {
    route = '/';
    pathSegs = [];
  }

  const method = request.method;

  // ---- Acquire DB connection ----
  // Separated from the inner try so DB errors produce a clear 503, not a
  // generic 500 that the user then has to dig through to understand.
  let database;
  try {
    database = await getDb();
  } catch (dbErr) {
    // Full error stays in server logs only — never in the client response
    // (Fix #10). Infrastructure details like hostnames, auth failures, or
    // network diagnostics must not be exposed to API callers.
    console.error('[api] Database connection failed:', dbErr?.message, dbErr?.stack);
    return json(
      { error: 'Service temporarily unavailable. Please try again shortly.' },
      503
    );
  }

  try {

    // ========================================================
    // PUBLIC ROUTES
    // ========================================================

    // GET /stats
    if (route === '/stats' && method === 'GET') {
      return json(await computeStats(database));
    }

    // GET /contributors
    // Public wall shows ONLY admin-approved contributors. Approval is a
    // separate, explicit admin action (PATCH /admin/contributors/:id) — a
    // verified on-chain transaction is never enough by itself to publish a
    // name (the amount is already counted in /stats via the `donations`
    // collection regardless of approval).
    if (route === '/contributors' && method === 'GET') {
      const col  = database.collection('contributors');
      const list = await col.find({ approved: true, hidden: { $ne: true } })
        .sort({ createdAt: -1 }).limit(500).toArray();
      const cleaned = list.map((c) => ({
        id:          c.id,
        displayId:   c.displayId,
        name:        c.name     || null,
        nickname:    c.nickname || null,
        amount:      c.amount,
        txHash:      c.txHash     || null,
        fromAddress: c.fromAddress || null,
        session:     c.session,
        createdAt:   c.createdAt,
        approved:    true,
        highlighted: Boolean(c.highlighted),
        source:      c.source || 'form',
      }));
      return json({ contributors: cleaned });
    }

    // POST /contributors
    // Attribution-only: this endpoint never determines the campaign total by
    // itself. A confirmed on-chain match is recorded into the `donations`
    // ledger (feeding /stats) independent of whether this submission is ever
    // approved for public display.
    if (route === '/contributors' && method === 'POST') {
  const ip = getClientIp(request);
  if (isRateLimited(ip)) {
    return json({ error: 'Too many submissions. Please try again in a minute.' }, 429);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  // ✅ EMAIL FIELD ADDED
  const name     = typeof body.name     === 'string' ? body.name.slice(0, 60).trim()     : '';
  const nickname = typeof body.nickname === 'string' ? body.nickname.slice(0, 40).trim() : '';
  const email    = typeof body.email    === 'string' ? body.email.trim().toLowerCase()   : '';
  const txHash   = normalizeTxHash(body.txHash);

  // ✅ Valid email check
  if (!email || !email.includes('@') || !email.includes('.')) {
    return json({ error: 'Valid email is required' }, 400);
  }

  if (!name && !nickname) return json({ error: 'Name or nickname required' }, 400);
  if (!txHash)             return json({ error: 'Please submit a valid transaction hash' }, 400);
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) return json({ error: 'That does not look like a valid transaction hash' }, 400);

  const col = database.collection('contributors');

  // ✅ Duplicate check: same email + txHash
  const existing = await col.findOne({ email, txHash });
  if (existing) {
    return json({ error: 'This transaction has already been claimed with this email' }, 409);
  }

  // ✅ Duplicate check: same txHash (any email)
  const txExists = await col.findOne({ txHash });
  if (txExists) {
    return json({ error: 'This transaction hash has already been submitted' }, 409);
  }

  const settings = await getSettings(database);
  const wallet   = settings.primaryWallet || DEFAULT_WALLET;
  const now      = new Date();

  const onchain = await verifyTxOnChain(wallet, txHash);
  const seq     = await nextContributorSeq(database);

  if (onchain && onchain.status === 'confirmed') {
    await recordDonation(database, {
      txHash, amount: onchain.amount, fromAddress: onchain.fromAddress, blockNumber: onchain.blockNumber,
    });

    const doc = {
      id: uuidv4(), displayId: pad6(seq), seq,
      name, nickname, email,  // ✅ EMAIL SAVED
      amount:      onchain.amount,
      txHash,
      fromAddress: onchain.fromAddress,
      blockNumber: onchain.blockNumber,
      session:     sessionLabelFromUtc(now),
      createdAt:   now.toISOString(),
      approved: false, highlighted: false, hidden: true,
      verified: true, source: 'form+onchain',
      emailVerified: false,
      verifiedAt: null,
    };

    try {
      await col.insertOne(doc);
    } catch (e) {
      if (e?.code === 11000) {
        const raced = await col.findOne({ txHash });
        return json({ ok: true, contributor: raced, message: 'Received — already recorded.' });
      }
      throw e;
    }

     

      // Not found on-chain at all — either a fake/malformed hash or a
      // transaction sent to a different wallet. Reject at submission
      // time instead of creating a junk entry for admin review.
      return json(
        { error: 'We could not find this transaction on the blockchain for our wallet address. Please double-check the hash and try again.' },
        400
      );
    }

    // GET /content
    if (route === '/content' && method === 'GET') {
      const [content, settings] = await Promise.all([
        getContent(database),
        getSettings(database),
      ]);
      const wallets = await database.collection('wallets').find({}).toArray();
      return json({
        about:         content.about,
        strategy:      content.strategy,
        transparency:  content.transparency,
        faq:           content.faq,
        goal:          settings.goal,
        primaryWallet: settings.primaryWallet || DEFAULT_WALLET,
        wallets:       wallets.map((w) => ({
          id:      w.id,
          label:   w.label,
          network: w.network,
          address: w.address,
          active:  Boolean(w.active),
        })),
      });
    }

    // ========================================================
    // ADMIN AUTH ROUTES  (no session required)
    // ========================================================

    /**
     * POST /admin/login
     *
     * Step 1 of two-factor login.
     * Validates username + password (bcrypt). On success: generates a
     * 6-digit OTP, stores it in admin_security, sends it via SMTP.
     * Returns { step: 'otp', sentTo: 'ch***@outlook.com' }.
     *
     * Lockout rules:
     *   3 wrong in cycle 1 → 15-minute lock  → show "Try again later."
     *   3 wrong in cycle 2 → 24-hour block   → show "Try again later."
     *   Success after lock  → reset counter completely
     *   Never reveal remaining lock time or which field was wrong.
     *
     * Returns 401 for wrong credentials — NEVER 500.
     */
    if (route === '/admin/login' && method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

      // Coerce inputs to strings before any string operation
      const username    = typeof body.username    === 'string' ? body.username    : '';
      const password    = typeof body.password    === 'string' ? body.password    : '';
      const fingerprint = typeof body.fingerprint === 'string' ? body.fingerprint : '';

      if (!username || !password) {
        return json({ error: 'Invalid credentials. Please try again.' }, 401);
      }

      const ip = getClientIp(request);
      // Brute-force lockout is keyed ONLY on the server-observed IP
      // (ipKey) — this cannot be influenced by anything in the request
      // body, so it cannot be bypassed by varying the client-supplied
      // fingerprint. deviceKey is still computed and stored purely as
      // diagnostic metadata alongside the record.
      const ipKey     = computeIpKey(ip);
      const deviceKey = computeDeviceKey(fingerprint, ip);
      const security  = database.collection('admin_security');
      const now       = new Date();

      // Load security record for this IP (may not exist yet — default to empty)
      const sec = (await security.findOne({ ipKey })) || {};

      // ---- Active 24-hour block ----
      if (sec.pwBlockedUntil && new Date(sec.pwBlockedUntil) > now) {
        return json({ error: 'Try again later.' }, 429);
      }

      // ---- Active 15-minute lock ----
      if (sec.pwLockedUntil && new Date(sec.pwLockedUntil) > now) {
        return json({ error: 'Try again later.' }, 429);
      }

      // Determine which cycle we're in:
      //   If the 15-minute lock has EXPIRED, transition to cycle 2 (reset attempt count).
      const firstLockExpired = !!(sec.pwLockedUntil && new Date(sec.pwLockedUntil) <= now);
      const inCycle2         = firstLockExpired || sec.pwCycle === 2;

      // ---- Credential check ----
      // checkAdminCredentials handles all undefined/empty cases internally.
      const credentialsOk = await checkAdminCredentials(username, password);

      if (!credentialsOk) {
        const cycle       = inCycle2 ? 2 : 1;
        const prevAttempts = firstLockExpired ? 0 : (Number(sec.pwAttempts) || 0);
        const newAttempts  = prevAttempts + 1;

        let pwLockedUntil  = firstLockExpired ? null : (sec.pwLockedUntil || null);
        let pwBlockedUntil = sec.pwBlockedUntil || null;

        if (cycle === 1 && newAttempts >= 3) {
          pwLockedUntil = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
        } else if (cycle === 2 && newAttempts >= 3) {
          pwBlockedUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
          pwLockedUntil  = null;
        }

        await safeUpsert(
          security,
          { ipKey },
          { $set: { ipKey, deviceKey, pwAttempts: newAttempts, pwCycle: cycle, pwLockedUntil, pwBlockedUntil, updatedAt: now.toISOString() } }
        );

        // Generic message — never reveal which field was wrong
        return json({ error: 'Invalid credentials. Please try again.' }, 401);
      }

      // ---- Credentials correct ----
      // Reset password-attempt counters unconditionally.
      await safeUpsert(
        security,
        { ipKey },
        { $set: { ipKey, deviceKey, pwAttempts: 0, pwCycle: 1, pwLockedUntil: null, updatedAt: now.toISOString() } }
      );

      // ---- OTP resend cooldown ----
      // Independent of any client-supplied value (fingerprint) and applied
      // per-IP regardless of which device is used, to prevent mailbox
      // flooding / SMTP abuse via repeated login calls.
      const freshSec = await security.findOne({ ipKey });
      if (freshSec?.otpLastSentAt) {
        const elapsedMs = now.getTime() - new Date(freshSec.otpLastSentAt).getTime();
        if (elapsedMs < OTP_RESEND_COOLDOWN_MS) {
          const waitSeconds = Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsedMs) / 1000);
          return json(
            { error: `Please wait ${waitSeconds}s before requesting another code.` },
            429
          );
        }
      }

      // Check SMTP before generating OTP — give a clear error if unconfigured.
      // Log the specific cause server-side only; the client never learns
      // which env vars are involved (Fix — previously leaked env var names).
      if (!isSmtpConfigured()) {
        console.error('[api/login] SMTP is not configured (SMTP_USER / SMTP_PASSWORD / RECOVERY_EMAIL).');
        return json(
          { error: 'Verification email cannot be sent right now. Please try again later.' },
          503
        );
      }

      // Generate and store OTP
      const otp          = generateOtp();
      const otpHash       = await hashOtp(otp); // never store the OTP itself
      const otpExpiresAt = new Date(now.getTime() + 60 * 1000).toISOString(); // 1 minute

      await safeUpsert(
        security,
        { ipKey },
        { $set: { ipKey, deviceKey, otpCode: otpHash, otpExpiresAt, otpAttempts: 0, otpBlockedUntil: null, updatedAt: now.toISOString() } }
      );

      // Send OTP email
      try {
        await sendOtpEmail(otp);
      } catch (e) {
        console.error('[api/login] SMTP send failed:', e?.message);
        // Remove the pending OTP so a retry works cleanly. Do NOT clear
        // otpLastSentAt — a failed send still attempted delivery and
        // should not bypass the cooldown.
        await security.updateOne({ ipKey }, { $set: { otpCode: null, otpExpiresAt: null } });
        return json({ error: 'Could not send verification email. Check SMTP configuration and try again.' }, 500);
      }

      // Record successful send time for the cooldown check above.
      await security.updateOne({ ipKey }, { $set: { otpLastSentAt: now.toISOString() } });

      return json({ ok: true, step: 'otp' });
    }

    /**
     * POST /admin/verify-otp
     *
     * Step 2 of two-factor login.
     * Validates the 6-digit OTP. On success:
     *  - Invalidates all existing sessions (single-session enforcement).
     *  - Creates a new session in admin_sessions.
     *  - Sets a Secure HttpOnly SameSite=Strict session cookie.
     *
     * OTP rules:
     *  - Valid for exactly 1 minute.
     *  - Max 3 incorrect attempts → 7-day device block.
     *  - Generic error message always ("Invalid or expired code.").
     */
    if (route === '/admin/verify-otp' && method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

      const otpInput    = typeof body.otp         === 'string' ? body.otp.trim()         : '';
      const fingerprint = typeof body.fingerprint === 'string' ? body.fingerprint        : '';

      if (!otpInput) return json({ error: 'Invalid or expired code.' }, 401);

      const ip        = getClientIp(request);
      // The OTP record was created and stored in POST /admin/login keyed
      // by ipKey (server-observed IP only — see Fix #1). Lookup here must
      // use the same key, or a legitimate verify-otp call would never
      // find its own pending code. deviceKey is still computed and
      // persisted purely as diagnostic metadata alongside the session.
      const ipKey     = computeIpKey(ip);
      const deviceKey = computeDeviceKey(fingerprint, ip);
      const security  = database.collection('admin_security');
      const now       = new Date();

      const sec = await security.findOne({ ipKey });

      // No pending OTP on record for this IP
      if (!sec || !sec.otpCode) {
        return json({ error: 'Invalid or expired code.' }, 401);
      }

      // 7-day OTP block
      if (sec.otpBlockedUntil && new Date(sec.otpBlockedUntil) > now) {
        return json({ error: 'Try again later.' }, 429);
      }

      // OTP expired (1-minute window)
      if (!sec.otpExpiresAt || new Date(sec.otpExpiresAt) <= now) {
        await security.updateOne(
          { ipKey },
          { $set: { otpCode: null, otpAttempts: 0, updatedAt: now.toISOString() } }
        );
        return json({ error: 'Invalid or expired code.' }, 401);
      }

      // Compare OTP — timing-safe, fixed-length comparison (Fix #3).
      // verifyOtp() validates both values are exactly 6 digits before
      // ever touching crypto.timingSafeEqual, and fails closed (false)
      // on any malformed input without leaking timing information.
      const storedOtpHash = typeof sec.otpCode === 'string' ? sec.otpCode : '';
      const otpOk         = await compareOtp(otpInput, storedOtpHash);

      if (!otpOk) {
        const newAttempts  = (Number(sec.otpAttempts) || 0) + 1;
        let otpBlockedUntil = sec.otpBlockedUntil || null;
        if (newAttempts >= 3) {
          otpBlockedUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
        }
        await security.updateOne(
          { ipKey },
          { $set: { otpAttempts: newAttempts, otpBlockedUntil, updatedAt: now.toISOString() } }
        );
        return json({ error: 'Invalid or expired code.' }, 401);
      }

      // ---- OTP correct ----
      // Clear OTP from security record
      await security.updateOne(
        { ipKey },
        { $set: { otpCode: null, otpExpiresAt: null, otpAttempts: 0, updatedAt: now.toISOString() } }
      );

      // Create session (invalidates all previous sessions internally)
      const sessionId = await createSession(database, deviceKey, ip);

      const response = NextResponse.json({ ok: true });
      applySessionCookie(response, sessionId);
      applyCors(response);
      return response;
    }

    /**
     * POST /admin/logout
     *
     * Deletes the session from the DB and clears the cookie.
     * Always returns 200 — even if the session was already gone.
     */
    if (route === '/admin/logout' && method === 'POST') {
      const raw       = request.cookies.get(SESSION_COOKIE)?.value;
      const sessionId = unsignSession(raw);
      if (sessionId) {
        await database.collection('admin_sessions').deleteOne({ sessionId }).catch(() => {});
      }
      const response = NextResponse.json({ ok: true });
      clearSessionCookie(response);
      applyCors(response);
      return response;
    }

    /**
     * POST /admin/recovery
     *
     * Sends password-recovery instructions to RECOVERY_EMAIL.
     * Does NOT reset the password or expose any credentials.
     *
     * Rate limiting (Fix — previously unlimited):
     *  - Keyed ONLY on the server-observed IP (ipKey), same as the OTP
     *    resend cooldown, so it cannot be bypassed by client-supplied values
     *    or by omitting them.
     *  - Minimum 60s gap between any two recovery emails.
     *  - Hard cap of RECOVERY_MAX_PER_WINDOW sends per rolling window,
     *    persisted in the DB so it survives cold starts / multiple instances.
     *  - Only a successful send updates the rate-limit state — a failed
     *    SMTP attempt does not consume the cooldown or the window quota.
     *  - Generic 429 messages; no account/email enumeration is possible
     *    since this route has no user-supplied identifier at all.
     */
    if (route === '/admin/recovery' && method === 'POST') {
      const ip       = getClientIp(request);
      const ipKey    = computeIpKey(ip);
      const security = database.collection('admin_security');
      const now      = new Date();

      const sec = (await security.findOne({ ipKey })) || {};

      // ---- Minimum gap between recovery emails ----
      if (sec.recoveryLastSentAt) {
        const elapsedMs = now.getTime() - new Date(sec.recoveryLastSentAt).getTime();
        if (elapsedMs < RECOVERY_RESEND_COOLDOWN_MS) {
          const waitSeconds = Math.ceil((RECOVERY_RESEND_COOLDOWN_MS - elapsedMs) / 1000);
          return json(
            { error: `Please wait ${waitSeconds}s before requesting another recovery email.` },
            429
          );
        }
      }

      // ---- Rolling-window cap ----
      const windowStart   = sec.recoveryWindowStart ? new Date(sec.recoveryWindowStart) : null;
      const windowExpired = !windowStart || (now.getTime() - windowStart.getTime()) > RECOVERY_WINDOW_MS;
      const currentCount  = windowExpired ? 0 : (Number(sec.recoveryCount) || 0);

      if (!windowExpired && currentCount >= RECOVERY_MAX_PER_WINDOW) {
        return json({ error: 'Too many recovery requests. Please try again later.' }, 429);
      }

      // Log the specific cause server-side only; the client never learns
      // which env vars are involved (Fix — previously leaked env var names).
      if (!isSmtpConfigured()) {
        console.error('[api/recovery] Recovery email is not configured (SMTP_USER / SMTP_PASSWORD / RECOVERY_EMAIL).');
        return json(
          { error: 'Recovery email cannot be sent right now. Please try again later.' },
          503
        );
      }

      try {
        await sendRecoveryEmail();
      } catch (e) {
        console.error('[api/recovery] SMTP send failed:', e?.message);
        return json({ error: 'Could not send recovery email. Check SMTP configuration.' }, 500);
      }

      // Record successful send — reset the window if it expired, otherwise increment it.
      await safeUpsert(
        security,
        { ipKey },
        {
          $set: {
            ipKey,
            recoveryLastSentAt:  now.toISOString(),
            recoveryWindowStart: windowExpired ? now.toISOString() : (sec.recoveryWindowStart || now.toISOString()),
            recoveryCount:       windowExpired ? 1 : currentCount + 1,
            updatedAt:           now.toISOString(),
          },
        }
      );

      return json({ ok: true });
    }

    // ========================================================
    // ADMIN ROUTES  (session cookie required)
    // ========================================================
    if (route.startsWith('/admin/')) {
      const session = await validateSession(request, database);
      if (!session) {
        return json({ error: 'Unauthorized' }, 401);
      }

      // GET /admin/me
      if (route === '/admin/me' && method === 'GET') {
        return json({ ok: true, user: { username: ADMIN_USERNAME } });
      }

      // GET /admin/stats
      if (route === '/admin/stats' && method === 'GET') {
        const stats = await computeStats(database);
        const col   = database.collection('contributors');
        const [pending, approvedCount, hiddenCount, onchain, formCount] = await Promise.all([
          col.countDocuments({ approved: false, hidden: { $ne: true } }),
          col.countDocuments({ approved: true,  hidden: { $ne: true } }),
          col.countDocuments({ hidden: true }),
          col.countDocuments({ source: 'onchain' }),
          col.countDocuments({ source: { $in: ['form', 'form+onchain'] } }),
        ]);
        return json({ ...stats, pending, approvedCount, hiddenCount, onchain, formCount });
      }

      // GET /admin/contributors
      if (route === '/admin/contributors' && method === 'GET') {
        const col  = database.collection('contributors');
        const list = await col.find({}).sort({ createdAt: -1 }).limit(500).toArray();
        return json({ contributors: list });
      }

      // PATCH /admin/contributors/:id
      if (route.startsWith('/admin/contributors/') && method === 'PATCH') {
        const id = pathSegs[pathSegs.length - 1];
        if (!id) return json({ error: 'Contributor ID required' }, 400);

        let body;
        try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

        const patch = {};
        if (typeof body.approved    === 'boolean') patch.approved    = body.approved;
        if (typeof body.highlighted === 'boolean') patch.highlighted = body.highlighted;
        if (typeof body.hidden      === 'boolean') patch.hidden      = body.hidden;
        if (typeof body.name        === 'string')  patch.name        = body.name.slice(0, 60);
        if (typeof body.nickname    === 'string')  patch.nickname    = body.nickname.slice(0, 40);

        let warning = null;

        if (typeof body.txHash === 'string' && body.txHash.trim()) {
          const txHash  = normalizeTxHash(body.txHash);
          if (!txHash)  return json({ error: 'Invalid transaction hash format' }, 400);

          const current = await database.collection('contributors').findOne({ id });
          if (current && current.txHash !== txHash) {
            const dupe = await database.collection('contributors').findOne({ txHash, id: { $ne: id } });
            if (dupe) {
              return json({ error: `That tx hash is already linked to contributor ${dupe.displayId}.` }, 400);
            }
            const settings = await getSettings(database);
            const wallet   = settings.primaryWallet || DEFAULT_WALLET;
            const onchain  = await verifyTxOnChain(wallet, txHash);
            patch.txHash   = txHash;
            if (onchain) {
              patch.amount      = onchain.amount;
              patch.fromAddress = onchain.fromAddress;
              patch.blockNumber = onchain.blockNumber;
              patch.verified    = true;
              patch.source      = (current.name || current.nickname) ? 'form+onchain' : 'onchain';
            } else {
              patch.verified = false;
              warning = 'Could not verify this tx hash on-chain (not found, wrong wallet, or not mined yet). Amount was NOT changed — double-check before approving.';
            }
          }
        }

        await database.collection('contributors').updateOne({ id }, { $set: patch });
        const updated = await database.collection('contributors').findOne({ id });
        return json({ ok: true, contributor: updated, warning });
      }

      // PATCH /admin/content
      if (route === '/admin/content' && method === 'PATCH') {
        let body;
        try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

        const allowed = ['about', 'strategy', 'transparency', 'faq'];
        const patch   = {};
        for (const k of allowed) {
          if (body[k] !== undefined) patch[k] = body[k];
        }
        if (Object.keys(patch).length === 0) return json({ error: 'No valid content fields provided' }, 400);
        const updated = await setContent(database, patch);
        return json({ ok: true, content: updated });
      }

      // PATCH /admin/goal
      if (route === '/admin/goal' && method === 'PATCH') {
        let body;
        try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

        const goal = Number(body.goal);
        if (!Number.isFinite(goal) || goal < 1) return json({ error: 'goal must be a positive number' }, 400);
        const s = await setSettings(database, { goal });
        return json({ ok: true, goal: s.goal });
      }

      // GET /admin/wallets
      if (route === '/admin/wallets' && method === 'GET') {
        const wallets  = await database.collection('wallets').find({}).toArray();
        const settings = await getSettings(database);
        return json({ wallets, primaryWallet: settings.primaryWallet || DEFAULT_WALLET });
      }

      // POST /admin/wallets
      if (route === '/admin/wallets' && method === 'POST') {
        let body;
        try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

        const network = typeof body.network === 'string' ? body.network.trim() : '';
        const address = typeof body.address === 'string' ? body.address.trim() : '';
        if (!network || !address) return json({ error: 'network and address are required' }, 400);

        const w = {
          id:        uuidv4(),
          label:     typeof body.label === 'string' ? body.label.slice(0, 40) : network,
          network:   network.slice(0, 40),
          address:   address.slice(0, 100),
          active:    body.active !== false,
          createdAt: new Date().toISOString(),
        };
        await database.collection('wallets').insertOne(w);
        return json({ ok: true, wallet: w });
      }

      // DELETE /admin/wallets/:id
      if (route.startsWith('/admin/wallets/') && method === 'DELETE') {
        const id = pathSegs[pathSegs.length - 1];
        if (!id) return json({ error: 'Wallet ID required' }, 400);
        await database.collection('wallets').deleteOne({ id });
        return json({ ok: true });
      }

      // PATCH /admin/primary-wallet
      if (route === '/admin/primary-wallet' && method === 'PATCH') {
        let body;
        try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

        const address = typeof body.address === 'string' ? body.address.trim().slice(0, 100) : '';
        if (!address) return json({ error: 'address is required' }, 400);
        const s = await setSettings(database, { primaryWallet: address });
        return json({ ok: true, primaryWallet: s.primaryWallet });
      }
    }

    // ========================================================
    // Health check
    // ========================================================
    if (route === '/' || route === '') {
      return json({ ok: true, service: 'unibatch-api', version: '2.0' });
    }

    // ========================================================
    // Not found
    // ========================================================
    return json({ error: 'Not found' }, 404);

  } catch (err) {
    // Sanitised 500 — stack trace stays in server logs, not in the response.
    console.error('[api] Unhandled error on', method, route, '—', err?.message, err?.stack);
    return json(
      { error: 'An unexpected server error occurred. Please try again.' },
      500
    );
  }
}

export const GET    = handle;
export const POST   = handle;
export const PUT    = handle;
export const DELETE = handle;
export const PATCH  = handle;
