import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';

// ---------- Environment ----------
const MONGO_URL = process.env.MONGO_URL;
const DB_NAME = process.env.DB_NAME || 'unibatch';
const BSCSCAN_API_KEY = process.env.BSCSCAN_API_KEY;

// Auth — Phase 1 vars (ADMIN_USER / ADMIN_PASS kept as fallbacks for legacy deployments)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || process.env.ADMIN_USER || 'admin001';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';

// SMTP (Outlook)
const SMTP_HOST = 'smtp.office365.com';
const SMTP_PORT = 587;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASSWORD = process.env.SMTP_PASSWORD || '';
const RECOVERY_EMAIL = process.env.RECOVERY_EMAIL || '';

// Session signing
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.JWT_SECRET || 'dev-session-secret-change-me';

// Kept for compatibility — no longer used for auth in Phase 1+
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

// ---------- On-chain constants ----------
const USDT_BEP20_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';
const DEFAULT_WALLET = '0x815c9aeE32b098f7256A51957E1A4eE7290DF314';
const DEFAULT_GOAL = 250;
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const BSC_RPC_URLS = ['https://bsc-pokt.nodies.app', 'https://1rpc.io/bnb'];

// ---------- Session cookie ----------
const SESSION_COOKIE = 'unibatch_session';

// ---------- RPC ----------
async function rpcCall(method, params) {
  let lastErr;
  for (const url of BSC_RPC_URLS) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const data = await resp.json();
      if (data.error) { lastErr = new Error(data.error.message); continue; }
      return data.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('All RPCs failed');
}

function paddedAddr(addr) { return '0x' + '0'.repeat(24) + addr.toLowerCase().slice(2); }

function decodeTransferAmount(dataHex) {
  const raw = BigInt(dataHex);
  const divisor = BigInt(10) ** BigInt(18);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(18, '0').slice(0, 6);
  return parseFloat(`${whole.toString()}.${fracStr}`) || 0;
}

function normalizeTxHash(raw) {
  const t = (raw || '').toString().trim().toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(t) ? t : t.slice(0, 120);
}

async function verifyTxOnChain(wallet, txHash) {
  try {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return null;
    const receipt = await rpcCall('eth_getTransactionReceipt', [txHash]);
    if (!receipt || !receipt.logs || receipt.status !== '0x1') return null;
    const walletPadded = paddedAddr(wallet);
    for (const log of receipt.logs) {
      if (
        log.address?.toLowerCase() === USDT_BEP20_CONTRACT.toLowerCase() &&
        log.topics?.[0]?.toLowerCase() === TRANSFER_TOPIC.toLowerCase() &&
        log.topics?.[2]?.toLowerCase() === walletPadded.toLowerCase()
      ) {
        const amount = decodeTransferAmount(log.data);
        if (amount <= 0) continue;
        return {
          amount,
          fromAddress: '0x' + log.topics[1].slice(-40),
          blockNumber: parseInt(log.blockNumber, 16),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ---------- Database ----------
let client;
let db;
async function getDb() {
  if (db) return db;
  client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DB_NAME);
  try {
    await db.collection('contributors').createIndex(
      { txHash: 1 },
      { unique: true, partialFilterExpression: { txHash: { $type: 'string' } } }
    );
  } catch (e) {
    console.error('txHash unique index creation failed (non-fatal):', e.message);
  }
  // Indexes for Phase 1 auth collections
  try {
    await db.collection('admin_sessions').createIndex({ sessionId: 1 }, { unique: true });
    await db.collection('admin_sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await db.collection('admin_security').createIndex({ deviceKey: 1 }, { unique: true });
  } catch {
    // Non-fatal if indexes already exist
  }
  return db;
}

// ---------- Device / fingerprint helpers ----------
/**
 * Derive a stable device key from the client-supplied fingerprint and the
 * server-observed IP.  Neither alone is sufficient — fingerprint avoids
 * shared-IP collisions; IP guards against trivially forged fingerprints.
 */
function computeDeviceKey(fingerprint, ip) {
  const data = `${(fingerprint || '').slice(0, 256)}:${ip || 'unknown'}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

function getClientIp(request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

// ---------- Session helpers ----------
/**
 * Sign a sessionId so that even if an attacker can enumerate UUIDs they still
 * cannot craft a valid cookie without SESSION_SECRET.
 * Cookie value format: <uuid>.<hmac-hex>
 */
function signSession(sessionId) {
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(sessionId).digest('hex');
  return `${sessionId}.${sig}`;
}

function unsignSession(cookieValue) {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf('.');
  if (dot < 0) return null;
  const id = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(id).digest('hex');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  return id;
}

async function validateSession(request, database) {
  const raw = request.cookies.get(SESSION_COOKIE)?.value;
  const sessionId = unsignSession(raw);
  if (!sessionId) return null;
  const sessions = database.collection('admin_sessions');
  const session = await sessions.findOne({ sessionId });
  if (!session) return null;
  if (new Date(session.expiresAt) < new Date()) {
    await sessions.deleteOne({ sessionId });
    return null;
  }
  await sessions.updateOne({ sessionId }, { $set: { lastUsedAt: new Date().toISOString() } });
  return session;
}

function applySessionCookie(response, sessionId) {
  response.cookies.set(SESSION_COOKIE, signSession(sessionId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });
}

function clearSessionCookie(response) {
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });
}

// ---------- SMTP ----------
async function sendOtpEmail(otp) {
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false, // STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    tls: { ciphers: 'SSLv3' },
  });
  await transporter.sendMail({
    from: `"UNIBATCH Security" <${SMTP_USER}>`,
    to: RECOVERY_EMAIL,
    subject: 'UNIBATCH Admin — Your Login Code',
    text: [
      'Your one-time login code is:',
      '',
      `  ${otp}`,
      '',
      'This code expires in 1 minute. Do not share it with anyone.',
      'If you did not request this, your password may be compromised.',
    ].join('\n'),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#0ea5e9">UNIBATCH Admin Login</h2>
        <p>Your one-time login code is:</p>
        <div style="font-size:2rem;font-weight:bold;letter-spacing:0.3em;padding:16px;background:#0f172a;color:#38bdf8;border-radius:8px;text-align:center">${otp}</div>
        <p style="color:#64748b;font-size:0.875rem">This code expires in <strong>1 minute</strong>. Do not share it with anyone.</p>
        <p style="color:#64748b;font-size:0.875rem">If you did not request this code, your password may be compromised.</p>
      </div>
    `,
  });
}

async function sendRecoveryEmail() {
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    tls: { ciphers: 'SSLv3' },
  });
  await transporter.sendMail({
    from: `"UNIBATCH Security" <${SMTP_USER}>`,
    to: RECOVERY_EMAIL,
    subject: 'UNIBATCH Admin — Password Recovery Request',
    text: [
      'A password recovery request was submitted for the UNIBATCH admin panel.',
      '',
      'To regain access, update the ADMIN_PASSWORD_HASH environment variable with a new bcrypt hash.',
      '',
      'If you did not make this request, someone may be attempting to access your admin panel.',
    ].join('\n'),
  });
}

// ---------- JWT helpers (kept for backward-compat — not used for session auth in Phase 1) ----------
function b64url(s) { return Buffer.from(s).toString('base64url'); }
function signJwt(payload, ttlSeconds = 60 * 60 * 24 * 7) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}
function verifyJwt(token) {
  try {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
    if (s.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

// ---------- Utils ----------
function sessionLabelFromUtc(date) {
  const h = new Date(date).getUTCHours();
  if (h >= 5 && h < 11) return 'Morning';
  if (h >= 11 && h < 17) return 'Afternoon';
  if (h >= 17 && h < 22) return 'Evening';
  return 'Night';
}
function pad6(n) { return '#' + String(n).padStart(6, '0'); }
function cors(res) {
  res.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return res;
}
function json(data, status = 200) { return cors(NextResponse.json(data, { status })); }

// Mask email for display (e.g. ch***@outlook.com)
function maskEmail(email) {
  if (!email) return '***';
  return email.replace(/^(.{2}).+(@.+)$/, '$1***$2');
}

// ---------- Settings & Content defaults ----------
async function getSettings(database) {
  const settings = database.collection('settings');
  let s = await settings.findOne({ key: 'main' });
  if (!s) {
    s = { key: 'main', goal: DEFAULT_GOAL, primaryWallet: DEFAULT_WALLET, lastSyncAt: 0, createdAt: new Date().toISOString() };
    await settings.insertOne(s);
  }
  return s;
}
async function setSettings(database, patch) {
  const settings = database.collection('settings');
  await settings.updateOne({ key: 'main' }, { $set: patch }, { upsert: true });
  return getSettings(database);
}

const DEFAULT_CONTENT = {
  contentVersion: 2,
  about: {
    intro: {
      fullName: 'Chintu Kumar',
      location: 'Bihar (currently living in Haryana, India)',
      age: 17,
      experience: 'Over 1 year of trading',
      markets: 'Focused on stable markets like EUR/USD (CFD). Occasionally Gold when opportunity presents. Not interested in stocks or options anymore.',
      milestones: 'I have taken loans from my elder friends and family circle. After deep losses and moments without hope, I saved small capital, rebuilt profits and paid every loan back. Today I am debt-free.',
      motivation: 'I am now a part-time freelancer and a trader. I dropped out of college to support my family. My goal is to move my family out of the rental house and into a home of our own. My family is happy with the work I do — that keeps me going every day.',
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
    markets: 'I mainly focus on the forex market, particularly EUR/USD. In fact, it is the only currency pair I actively trade because I prefer specializing in one market rather than spreading my attention across multiple pairs. EUR/USD suits my trading style due to its relatively stable price movements, deep liquidity, lower spreads, and cleaner price action with less unnecessary noise.\n\nFor intraday trading, I primarily focus on the London session and the London\u2013New York overlap, as these periods usually provide the best liquidity and the highest-quality trading opportunities. I also observe the Asian session beforehand to understand the market context and identify important price levels before entering a trade.\n\nAlthough the London\u2013New York overlap can offer excellent scalping opportunities, I personally prefer taking only one high-quality trade per day. My focus is on intraday trading with patience rather than taking multiple positions.\n\nI also study other markets, including stocks, commodities, and crude oil, to broaden my understanding of financial markets. However, I intentionally limit my live trading to EUR/USD because I believe consistency comes from mastering one market instead of constantly switching between different assets.',
    riskFull: 'My risk management depends on the size and purpose of the trading account. When trading with a smaller personal account, I may allow slightly more flexibility because the capital is easier to replace. However, as my account grows, I become increasingly conservative because larger capital represents the result of my hard work and I don\u2019t believe in taking unnecessary risks with it.\n\nIf I were trading a $250 account, my maximum risk per trade would be approximately 1/25 of the account size, and I would reduce my percentage risk further as the account grows. My objective is to preserve capital first and grow it consistently over time.\n\nI use a stop-loss on every single trade without exception. For occasional scalping setups, I use automation to place my stop-loss instantly, but I generally avoid scalping because I find it creates unnecessary stress and encourages overtrading. Intraday trading suits my personality much better.\n\nRather than using a fixed take-profit, I usually target the next significant liquidity area. When price approaches that level, I observe the candle behavior and overall market reaction before deciding whether to close the trade. I prefer managing my exits based on price action instead of waiting for an exact target or allowing the market to reverse unnecessarily. My setups typically offer an average risk-to-reward ratio of around 1:3 while keeping my stop-loss relatively tight.\n\nI normally aim for just one quality trade per day. If I don\u2019t find a setup that meets my criteria, I simply don\u2019t trade. I believe that not trading is often a better decision than forcing a low-quality trade.\n\nI maintain my trading journal in two ways. First, I save screenshots of all my trades in Google Drive for later review and can share them if required. Second, instead of only recording profits and losses, I keep a written journal where I document what I learned from the market each day. I believe the lessons behind each trade are often more valuable than the trade itself.',
    routineFull: 'I work as a part-time freelance web designer, so my trading routine is built around my client work. I\u2019ll admit that I\u2019m not naturally an early-morning person, but I make sure to be available whenever the market reaches the sessions I trade.\n\nTo stay informed about market sentiment, I regularly follow financial updates and macroeconomic discussions on platforms like X (formerly Twitter) and Telegram. Over time, I have become familiar with the weekly schedule of major economic events, so I usually know when high-impact news is expected. Even so, I always check the Forex Factory economic calendar before placing any trade to make sure there are no important events that could increase volatility. Trading during major news releases is against my trading rules.\n\nRather than relying on automated backtesting, I prefer manually reviewing historical charts and comparing current market conditions with previous setups. This helps me better understand how my strategy performs under different market environments.\n\nSince I only trade EUR/USD, my preparation is very focused. I usually begin my market analysis around 11:30 AM IST, preparing for the London session. I spend around three to four hours observing the market and waiting patiently for a setup that meets my criteria. If no quality opportunity appears, I simply don\u2019t trade. Although the London\u2013New York overlap can sometimes provide another opportunity, I usually avoid forcing a second trade because mental fatigue can affect my decision-making. I believe protecting my discipline is more important than increasing my trading frequency.',
    toolsFull: 'For chart analysis, I primarily use TradingView. In my opinion, it is one of the best platforms for market analysis because of its clean interface, powerful charting tools, and flexibility. I use it to analyze every market I study and consider it an essential part of my trading workflow.\n\nFor trade execution, I use MetaTrader 5 (MT5), and my current broker is RoboForex. I previously used Exness, but I later closed that account and switched brokers.\n\nI have built my own custom trading journal as a personal website, which helps me organize and review my trading process in a way that suits my workflow. Alongside that, I also keep a handwritten journal. Instead of only recording profits and losses, I write down the lessons I learn from the market, the reasons behind stressful trades, and the psychological mistakes I want to avoid in the future. This helps me improve both technically and mentally.\n\nI don\u2019t rely heavily on indicators. My analysis is mainly based on price action and overall market structure. However, I occasionally use the RSI Divergence indicator as an additional confirmation and Volume Profile to identify important high-volume price levels. I also observe futures market data when it provides additional context, but I never allow indicators to replace my own market analysis.',
    tools: ['TradingView', 'MetaTrader 5 (MT5)', 'RoboForex (broker)', 'ForexFactory calendar', 'Custom personal journal', 'RSI Divergence · Volume Profile'],
    rules: [
      'I never place a trade without a stop-loss, even for scalping setups. Capital preservation always comes first.',
      'I never trade during high-impact (red-folder) economic news events. The risk of slippage and unpredictable volatility is simply not worth it for my strategy.',
      'I never try to recover losses by scalping or taking impulsive trades. In the past, this was one of my biggest mistakes, and I have made it a permanent rule to avoid it.',
      'If I take a loss during my planned intraday session, I stop trading for the rest of that session. This rule helps me avoid revenge trading and protects my decision-making from emotions.',
      'If my trading setup is not present, I simply don\u2019t trade. I would rather miss an opportunity than force a low-quality entry.',
    ],
    differentiator: 'What sets me apart from many people my age is my long-term commitment. I don\u2019t see trading as a shortcut to making money \u2014 I see it as a profession that I want to build over the course of my life.\n\nI\u2019ve seen many traders give up after experiencing losses and move on to something else. I respect those decisions, but I made a promise to myself that I would continue learning and improving, no matter how long it takes. My goal isn\u2019t to get rich quickly \u2014 it\u2019s to become consistently profitable while using responsible risk management and avoiding excessive leverage.\n\nBeyond trading, I work as a freelancer to support myself and gradually build my trading capital instead of relying entirely on the markets. That balance has made me more patient and disciplined.\n\nMy biggest personal goal is to improve my family\u2019s financial future. One day, I want to help my family move from rented housing into a home of our own. That goal motivates me every day to keep learning, improving, and making responsible decisions.',
    usage: 'If I receive the $250, I will use the entire amount as trading capital in a personal live account rather than purchasing a proprietary trading challenge.\n\nWhile I respect reputable prop firms, I prefer building a verified trading record on my own account first. This approach gives me complete control over my trading without worrying about challenge rules or account restrictions that may not always align with my strategy.\n\nTransparency is very important to me. To ensure complete accountability, I am willing to share my investor password so that contributors can monitor my trades in real time and see exactly how their support is being used. I want every dollar to be managed responsibly and with full transparency.\n\nI already have the tools, trading setup, and workflow I need. What I lack is trading capital \u2014 not knowledge or commitment. This funding would allow me to put my preparation into practice while continuing to grow my account through disciplined risk management.',
    riskStats: [
      { label: 'Risk per trade (on $250)', value: '~1/25' },
      { label: 'Avg risk : reward', value: '1 : 3' },
      { label: 'Quality trades / day', value: '1' },
      { label: 'Stop-loss on every trade', value: 'Always' },
    ],
    strategies: [
      {
        name: 'Compression',
        volume: 'Volume 1',
        caption: 'A Higher-Timeframe Trend Compression Breakout & Reclaim Strategy',
        images: ['/strategy/compression-1.png', '/strategy/compression-2.png'],
        sections: [
          { heading: 'Strategy Overview', body: 'The Compression Strategy is a trend-following breakout methodology designed to identify periods where price compresses between converging support and resistance trendlines before expanding into a new directional move. Rather than entering immediately after a breakout, the strategy waits for confirmation through a successful reclaim of the broken structure. It performs best in stable and highly liquid currency markets where price action respects technical structure.' },
          { heading: 'Market Theory', body: 'Trending markets often pause before their next expansion. During this pause, buyers continue creating higher lows while sellers defend lower highs, creating compression. Liquidity builds inside this structure until price eventually breaks out. The strategy participates only after the breakout has been confirmed.' },
          { heading: 'Best Markets', body: 'Recommended: EUR/USD, GBP/USD and NZD/USD. Highly volatile instruments such as Gold or cryptocurrencies are less suitable because they frequently produce false breakouts and poor retests.' },
          { heading: 'Compression Identification', body: 'A valid compression should be visible on both the execution timeframe and the Higher Timeframe. The greater the number of clean touches on both trendlines, the stronger and more reliable the setup becomes.' },
          { heading: 'Breakout Confirmation', body: 'A breakout alone is never an entry signal. Wait for a Break of Structure, trendline reclaim and Higher Timeframe candle confirmation. A candle wick alone is not enough; the candle must close outside the compression.' },
          { heading: 'Entry Rules', body: 'Enter only after price retests the broken trendline and the Higher Timeframe candle confirms the breakout. Avoid chasing price immediately after the breakout.' },
          { heading: 'Stop-Loss', body: 'Place the stop-loss below the latest swing low for long positions (or above the latest swing high for shorts) while respecting market structure.' },
          { heading: 'Profit Target', body: 'Targets should be based on the next liquidity level or major market structure. Instead of relying on fixed take-profit levels, monitor candle behaviour and secure profits if rejection appears.' },
          { heading: 'Risk Management', body: 'Always trade with a stop-loss, never force entries, never ignore Higher Timeframe confirmation and prioritise discipline over frequency.' },
          { heading: 'Final Philosophy', body: 'The Compression Strategy is not designed to predict breakouts \u2014 it is designed to confirm them. Patience, market structure, trendline compression and Higher Timeframe confirmation create its edge.' },
        ],
      },
      {
        name: 'Twice Trend Setup',
        volume: 'Volume 2',
        caption: 'A Higher-Timeframe Trend Continuation Strategy with Dynamic Trendline Reclaim',
        images: ['/strategy/twicetrend-1.png', '/strategy/twicetrend-2.png'],
        sections: [
          { heading: 'Strategy Overview', body: 'The Twice Trend Setup is a trend continuation methodology designed to identify a second continuation opportunity inside an already established trend. Instead of predicting reversals after an extended move, the strategy waits for the market to confirm that the dominant trend remains intact through a reclaimed trendline and Higher Timeframe confirmation.' },
          { heading: 'Market Theory', body: 'A strong trend frequently develops smaller internal trends before continuing. After an internal resistance or support trendline is broken, that same trendline often changes its role. A previous resistance becomes dynamic support in a bullish market, while previous support becomes dynamic resistance in a bearish market. This creates a \u201ctrend inside a trend\u201d, giving the strategy its name.' },
          { heading: 'Market Psychology', body: 'Many traders assume that a strong move is already overextended and begin searching for reversals. The Twice Trend Setup follows the opposite philosophy by trading with the dominant trend instead of attempting to catch tops or bottoms.' },
          { heading: 'Entry Rules', body: 'Never enter simply because price touches the reclaimed trendline. Wait for a Higher Timeframe rejection candle to close and confirm that the trendline has successfully flipped its role before opening a position.' },
          { heading: 'Liquidity Logic', body: 'Liquidity is used as a directional objective rather than a mandatory take-profit. If strong rejection appears before the liquidity zone, securing profits is generally a better decision than forcing a larger risk-to-reward ratio.' },
          { heading: 'Stop-Loss', body: 'Place the stop-loss below the Higher Timeframe rejection candle for long positions or above it for short positions. If the rejection candle has a very large wick, either reduce position size or refine the entry using a lower timeframe Fair Value Gap.' },
          { heading: 'Trade Management', body: 'Allow the trend to develop naturally, continue monitoring Higher Timeframe structure, and manage exits according to price behaviour instead of fixed targets.' },
          { heading: 'Risk Management', body: 'Always trade with the dominant trend, wait for Higher Timeframe confirmation, avoid emotional entries, and protect capital before seeking profit.' },
          { heading: 'Final Philosophy', body: 'The strongest trends rarely end after their first expansion. They often provide another continuation opportunity for traders willing to wait for confirmation. Following the dominant trend consistently is generally more effective than predicting where it will end.' },
        ],
      },
      {
        name: 'First Taker',
        volume: 'Volume 3',
        caption: 'A Predictive Trendline Strategy Based on Early Market Participation & Liquidity Psychology',
        images: ['/strategy/firsttaker-1.png', '/strategy/firsttaker-2.png', '/strategy/firsttaker-3.png'],
        sections: [
          { heading: 'Strategy Overview', body: 'The First Taker Strategy focuses on identifying high-probability continuation opportunities before a trendline becomes obvious to the majority of traders. Instead of waiting for several confirmations and visible touches, the strategy aims to participate at the earliest institutional-quality interaction using market structure and price behaviour.' },
          { heading: 'Market Theory', body: 'Every trend begins before most traders recognise it. Small structural reactions often appear long before a trendline becomes obvious. The First Taker Strategy uses these early reactions to anticipate future movement rather than reacting after the crowd has already entered.' },
          { heading: 'Market Psychology', body: 'Most retail traders wait for multiple trendline touches before trading. By then, liquidity has accumulated around the trendline. The First Taker Strategy attempts to enter before the setup becomes crowded, reducing the chance of becoming part of obvious retail liquidity.' },
          { heading: 'ABS Line', body: 'The ABS (Absolute Structure) Line is created by connecting the previous structural swing with the small rejection formed immediately after the breakout candle. This predictive trendline often identifies future reaction areas before they become visible to most traders.' },
          { heading: 'Scary Gap', body: 'A large Fair Value Gap before a breakout often creates fear among traders. Many assume the gap must always be filled and therefore avoid the breakout. The strategy does not automatically treat every Fair Value Gap as an inevitable target. Market structure always has priority over emotional expectations.' },
          { heading: 'Entry Rules', body: 'The preferred opportunity is the first interaction with the ABS Line. Wait for a lower timeframe rejection and clear price action confirmation before entering. If no confirmation appears, it is acceptable to miss the trade rather than forcing an entry.' },
          { heading: 'Later Touches', body: 'Later trendline touches remain valid, but each additional touch attracts more traders and therefore more liquidity. This increases the probability of stop hunts before the market continues.' },
          { heading: 'Stop-Loss', body: 'Place the stop-loss beyond the rejection candle while leaving enough room for natural price movement. Avoid placing stops directly on the wick.' },
          { heading: 'Profit Target', body: 'Targets should be based on the next liquidity objective or the following liquidity level if momentum remains strong. Exit decisions should always be based on live market behaviour rather than fixed take-profit levels.' },
          { heading: 'Risk Management', body: 'Respect market structure, wait for confirmation, protect capital first and avoid assuming that every Fair Value Gap must be filled.' },
          { heading: 'Final Philosophy', body: 'The best opportunities often appear before they become obvious. The First Taker Strategy combines predictive market structure, liquidity awareness and trader psychology to participate before obvious trendline setups become crowded.' },
        ],
      },
    ],
  },
  transparency: {
    forexFactoryUrl: 'https://www.forexfactory.com/tradeexplorer.php?do=account&id=96&note=UNIBATCH+%24250',
    binanceId: '1120105237',
    email: 'chintukumar911@outlook.com',
    instagram: '',
    tradingView: '',
    responseHours: 36,
    timezone: 'IST',
  },
  faq: [
    { q: 'What is UNIBATCH?', a: 'UNIBATCH is a personal trading education and transparency platform where I share trading strategies, educational resources, and a voluntary fundraising campaign to support future development.' },
    { q: 'Why are you raising funds?', a: 'The funds are used to support trading capital, website development, educational content creation, research, infrastructure, and future community projects.' },
    { q: 'Is this an investment opportunity?', a: 'No. This is not an investment, crowdfunding equity campaign, or profit-sharing program. Contributions are completely voluntary donations.' },
    { q: 'Will I receive any profits or returns?', a: 'No. Donations do not provide ownership, investment rights, dividends, revenue sharing, or guaranteed returns.' },
    { q: 'Which cryptocurrencies do you currently accept?', a: 'Currently accepted cryptocurrencies include: USDT (BEP20). More networks may be added in the future.' },
    { q: 'How does the donation progress bar work?', a: 'The donation progress is automatically updated by monitoring verified blockchain transactions through secure backend services.' },
    { q: 'Why hasn\u2019t my donation appeared yet?', a: 'Blockchain confirmations require time. Depending on network activity, updates may take several minutes before appearing on the website.' },
    { q: 'Can I verify that my donation was received?', a: 'Yes. Every donation can be verified directly on the blockchain using the transaction hash (TXID).' },
    { q: 'Is my personal information stored?', a: 'No. The website does not collect personal information unless you voluntarily contact us. Only public blockchain transaction data is used for donation verification.' },
    { q: 'Can cryptocurrency donations be refunded?', a: 'No. Blockchain transactions are irreversible. Because all contributions are voluntary donations, refunds cannot be issued after confirmation.' },
    { q: 'Are the trading strategies financial advice?', a: 'No. All strategies, examples, and educational materials are provided strictly for educational and informational purposes. Always conduct your own research before trading.' },
    { q: 'Can I verify your trading performance?', a: 'Yes. Trading statistics and public profiles are available through the transparency section whenever applicable.' },
    { q: 'Will more trading strategies be added?', a: 'Yes. The strategy library will continue expanding with new concepts, market structure guides, risk management techniques, and educational content.' },
    { q: 'How secure is this website?', a: 'Security is a priority. Sensitive information is stored securely, administrative functions are protected, and blockchain verification is performed through secure backend infrastructure.' },
    { q: 'How can I contact you?', a: 'For collaboration, questions, or community requests, please use the Contact page or email: chintukumar911@outlook.com' },
    { q: 'Where can I follow future updates?', a: 'Future updates, strategies, announcements, and platform improvements will be published directly on the website and linked social profiles.' },
  ],
};

async function getContent(database) {
  const col = database.collection('site_content');
  let doc = await col.findOne({ key: 'main' });
  if (!doc) {
    doc = { key: 'main', ...DEFAULT_CONTENT, updatedAt: new Date().toISOString() };
    await col.insertOne(doc);
  }
  return doc;
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

// ---------- Public stats ----------
async function computeStats(database) {
  const contribs = database.collection('contributors');
  const settings = await getSettings(database);
  const all = await contribs.find({ hidden: { $ne: true } }).toArray();
  const raised = all.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const count = all.length;
  const goal = settings.goal || DEFAULT_GOAL;
  const progress = Math.min(100, (raised / goal) * 100);
  return {
    goal,
    raised: Number(raised.toFixed(2)),
    remaining: Number(Math.max(0, goal - raised).toFixed(2)),
    count,
    progress: Number(progress.toFixed(2)),
    wallet: settings.primaryWallet || DEFAULT_WALLET,
    network: 'USDT (BEP20)',
    lastSyncAt: settings.lastSyncAt || 0,
  };
}

// ---------- Handler ----------
export async function OPTIONS() { return cors(new NextResponse(null, { status: 204 })); }

async function handle(request, { params }) {
  const resolved = await params;
  const pathSegs = resolved?.path || [];
  const route = '/' + pathSegs.join('/');
  const method = request.method;

  try {
    const database = await getDb();

    // ---------------- PUBLIC ----------------
    if (route === '/stats' && method === 'GET') {
      const stats = await computeStats(database);
      return json(stats);
    }

    if (route === '/contributors' && method === 'GET') {
      const contribs = database.collection('contributors');
      const list = await contribs.find({ hidden: { $ne: true } }).sort({ createdAt: -1 }).limit(500).toArray();
      const cleaned = list.map((c) => ({
        id: c.id,
        displayId: c.displayId,
        name: c.approved ? c.name : null,
        nickname: c.approved ? c.nickname : null,
        amount: c.amount,
        txHash: c.txHash || null,
        fromAddress: c.fromAddress || null,
        session: c.session,
        createdAt: c.createdAt,
        approved: !!c.approved,
        highlighted: !!c.highlighted,
        source: c.source || 'form',
      }));
      return json({ contributors: cleaned });
    }

    if (route === '/contributors' && method === 'POST') {
      const body = await request.json();
      const name = (body.name || '').toString().slice(0, 60).trim();
      const nickname = (body.nickname || '').toString().slice(0, 40).trim();
      const txHash = normalizeTxHash(body.txHash);
      if (!name && !nickname) return json({ error: 'Name or nickname required' }, 400);
      if (!txHash) return json({ error: 'Transaction hash is required' }, 400);
      if (!/^0x[0-9a-f]{64}$/.test(txHash)) return json({ error: 'That does not look like a valid transaction hash' }, 400);
      const contribs = database.collection('contributors');
      const settings = await getSettings(database);
      const wallet = settings.primaryWallet || DEFAULT_WALLET;
      const now = new Date();

      const existing = await contribs.findOne({ txHash });
      if (existing) {
        await contribs.updateOne({ id: existing.id }, { $set: { name, nickname, approved: false } });
        const updated = await contribs.findOne({ id: existing.id });
        return json({
          ok: true,
          contributor: updated,
          message: updated.verified
            ? `Verified! Your donation counts toward the goal now — your name will show once reviewed.`
            : 'Received — this will appear once we verify it on-chain.',
        });
      }

      const onchain = await verifyTxOnChain(wallet, txHash);
      if (onchain) {
        const seq = (await contribs.countDocuments({})) + 1;
        const doc = {
          id: uuidv4(), displayId: pad6(seq), seq,
          name, nickname,
          amount: onchain.amount,
          txHash, fromAddress: onchain.fromAddress, blockNumber: onchain.blockNumber,
          session: sessionLabelFromUtc(now),
          createdAt: now.toISOString(),
          approved: false, highlighted: false, hidden: false,
          verified: true, source: 'form+onchain',
        };
        try {
          await contribs.insertOne(doc);
        } catch (e) {
          if (e?.code === 11000) {
            const raced = await contribs.findOne({ txHash });
            return json({ ok: true, contributor: raced, message: 'Received — this transaction was already recorded.' });
          }
          throw e;
        }
        return json({ ok: true, contributor: doc, message: `Verified! Your donation counts toward the goal now — your name will show once reviewed.` });
      }

      const seq = (await contribs.countDocuments({})) + 1;
      const doc = {
        id: uuidv4(), displayId: pad6(seq), seq,
        name, nickname,
        amount: 0,
        txHash,
        session: sessionLabelFromUtc(now),
        createdAt: now.toISOString(),
        approved: false, highlighted: false, hidden: true,
        verified: false, source: 'form-pending',
      };
      try {
        await contribs.insertOne(doc);
      } catch (e) {
        if (e?.code === 11000) {
          const raced = await contribs.findOne({ txHash });
          return json({ ok: true, contributor: raced, message: 'Received — this transaction was already recorded.' });
        }
        throw e;
      }
      return json({ ok: true, contributor: doc, message: 'Thanks! This will appear on the wall once verified on-chain (or reviewed by admin).' });
    }

    if (route === '/content' && method === 'GET') {
      const [content, settings] = await Promise.all([getContent(database), getSettings(database)]);
      const wallets = await database.collection('wallets').find({}).toArray();
      return json({
        about: content.about,
        strategy: content.strategy,
        transparency: content.transparency,
        faq: content.faq,
        goal: settings.goal,
        primaryWallet: settings.primaryWallet || DEFAULT_WALLET,
        wallets: wallets.map((w) => ({ id: w.id, label: w.label, network: w.network, address: w.address, active: !!w.active })),
      });
    }

    // ---------------- ADMIN AUTH (Phase 1) ----------------

    /**
     * Step 1: Password check.
     * On success: generates a 6-digit OTP, emails it via Outlook SMTP, and returns { step: 'otp' }.
     * Never reveals whether username, password, or any other field was wrong.
     *
     * Lockout rules:
     *   - 3 wrong passwords in cycle 1  → 15-minute lock  (show "Try again later.")
     *   - 3 wrong passwords in cycle 2  → 24-hour block   (lazy check)
     *   - Never reveal remaining lock time.
     */
    if (route === '/admin/login' && method === 'POST') {
      const body = await request.json();
      const { username, password, fingerprint } = body || {};
      const ip = getClientIp(request);
      const deviceKey = computeDeviceKey(fingerprint, ip);
      const security = database.collection('admin_security');
      const now = new Date();

      const sec = await security.findOne({ deviceKey }) || {};

      // --- Active 24-hour device block (lazy check) ---
      if (sec.pwBlockedUntil && new Date(sec.pwBlockedUntil) > now) {
        return json({ error: 'Try again later.' }, 429);
      }

      // --- Active 15-minute lock ---
      if (sec.pwLockedUntil && new Date(sec.pwLockedUntil) > now) {
        return json({ error: 'Try again later.' }, 429);
      }

      // Detect whether 15-min lock has expired → we are now in the second attempt cycle
      const firstLockExpired = !!(sec.pwLockedUntil && new Date(sec.pwLockedUntil) <= now);
      const inSecondCycle = firstLockExpired || sec.pwCycle === 2;

      // --- Credential check — use constant-time comparison where possible ---
      const usernameOk = username === ADMIN_USERNAME;
      let passwordOk = false;
      if (ADMIN_PASSWORD_HASH && password) {
        try {
          passwordOk = await bcrypt.compare(String(password), ADMIN_PASSWORD_HASH);
        } catch {
          passwordOk = false;
        }
      }

      if (!usernameOk || !passwordOk) {
        // Failure path
        const cycle = inSecondCycle ? 2 : 1;
        // Reset attempt counter when transitioning from expired first lock to second cycle
        const prevAttempts = firstLockExpired ? 0 : (sec.pwAttempts || 0);
        const newAttempts = prevAttempts + 1;

        let pwLockedUntil = firstLockExpired ? null : (sec.pwLockedUntil || null);
        let pwBlockedUntil = sec.pwBlockedUntil || null;

        if (cycle === 1 && newAttempts >= 3) {
          // First three failures → 15-minute lock
          pwLockedUntil = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
        } else if (cycle === 2 && newAttempts >= 3) {
          // Second set of three failures → 24-hour block
          pwBlockedUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
          pwLockedUntil = null;
        }

        await security.updateOne(
          { deviceKey },
          { $set: { deviceKey, pwAttempts: newAttempts, pwCycle: cycle, pwLockedUntil, pwBlockedUntil, updatedAt: now.toISOString() } },
          { upsert: true }
        );
        // Generic message — never reveal which field was wrong or how many attempts remain
        return json({ error: 'Invalid credentials. Please try again.' }, 401);
      }

      // --- Credentials correct: reset password attempt counters ---
      // Spec: "if the next login succeeds after the 15-minute lock, reset the failed-attempt counter completely."
      await security.updateOne(
        { deviceKey },
        { $set: { pwAttempts: 0, pwCycle: 1, pwLockedUntil: null, updatedAt: now.toISOString() } },
        { upsert: true }
      );

      // --- Generate 6-digit OTP ---
      // Use crypto.randomInt for a cryptographically secure integer
      const otp = String(crypto.randomInt(100000, 1000000));
      const otpExpiresAt = new Date(now.getTime() + 60 * 1000).toISOString(); // 1 minute

      await security.updateOne(
        { deviceKey },
        { $set: { otpCode: otp, otpExpiresAt, otpAttempts: 0, otpBlockedUntil: null, updatedAt: now.toISOString() } },
        { upsert: true }
      );

      // --- Send OTP via Outlook SMTP ---
      try {
        await sendOtpEmail(otp);
      } catch (e) {
        console.error('[SMTP] Failed to send OTP:', e.message);
        // Clean up pending OTP so a retry is possible
        await security.updateOne({ deviceKey }, { $set: { otpCode: null, otpExpiresAt: null } });
        return json({ error: 'Could not send verification email. Please check SMTP configuration.' }, 500);
      }

      return json({ ok: true, step: 'otp', sentTo: maskEmail(RECOVERY_EMAIL) });
    }

    /**
     * Step 2: OTP verification.
     * On success: invalidates all existing sessions (single-session enforcement),
     * creates a new session, and sets a Secure HttpOnly SameSite=Strict cookie.
     *
     * OTP rules:
     *   - Exactly 6 digits
     *   - Valid for exactly 1 minute
     *   - Maximum 3 incorrect attempts
     *   - After 3 incorrect attempts → device blocked for 7 days
     */
    if (route === '/admin/verify-otp' && method === 'POST') {
      const body = await request.json();
      const { otp, fingerprint } = body || {};
      const ip = getClientIp(request);
      const deviceKey = computeDeviceKey(fingerprint, ip);
      const security = database.collection('admin_security');
      const sessions = database.collection('admin_sessions');
      const now = new Date();

      const sec = await security.findOne({ deviceKey });

      // No pending OTP for this device
      if (!sec || !sec.otpCode) {
        return json({ error: 'Invalid or expired code.' }, 401);
      }

      // 7-day OTP device block
      if (sec.otpBlockedUntil && new Date(sec.otpBlockedUntil) > now) {
        return json({ error: 'Try again later.' }, 429);
      }

      // OTP expired (1-minute window)
      if (!sec.otpExpiresAt || new Date(sec.otpExpiresAt) <= now) {
        await security.updateOne({ deviceKey }, { $set: { otpCode: null, otpAttempts: 0, updatedAt: now.toISOString() } });
        return json({ error: 'Invalid or expired code.' }, 401);
      }

      // Check OTP value — compare as strings (both are exactly 6 decimal digits)
      const otpOk = sec.otpCode === String(otp || '').trim();

      if (!otpOk) {
        const newAttempts = (sec.otpAttempts || 0) + 1;
        let otpBlockedUntil = sec.otpBlockedUntil || null;
        if (newAttempts >= 3) {
          // 3 incorrect OTP attempts → 7-day device block
          otpBlockedUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
        }
        await security.updateOne(
          { deviceKey },
          { $set: { otpAttempts: newAttempts, otpBlockedUntil, updatedAt: now.toISOString() } }
        );
        // Generic message — never reveal OTP correctness
        return json({ error: 'Invalid or expired code.' }, 401);
      }

      // --- OTP correct ---

      // Single-session enforcement: invalidate every existing admin session
      await sessions.deleteMany({});

      // Clear OTP from security record
      await security.updateOne(
        { deviceKey },
        { $set: { otpCode: null, otpExpiresAt: null, otpAttempts: 0, updatedAt: now.toISOString() } }
      );

      // Create new session
      const sessionId = uuidv4();
      const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await sessions.insertOne({
        sessionId,
        deviceKey,
        ip,
        createdAt: now.toISOString(),
        expiresAt,
        lastUsedAt: now.toISOString(),
      });

      // Set Secure HttpOnly SameSite=Strict session cookie
      const response = NextResponse.json({ ok: true });
      applySessionCookie(response, sessionId);
      cors(response);
      return response;
    }

    /**
     * Logout: clear the session cookie and delete the session from DB.
     */
    if (route === '/admin/logout' && method === 'POST') {
      const raw = request.cookies.get(SESSION_COOKIE)?.value;
      const sessionId = unsignSession(raw);
      if (sessionId) {
        await database.collection('admin_sessions').deleteOne({ sessionId });
      }
      const response = NextResponse.json({ ok: true });
      clearSessionCookie(response);
      cors(response);
      return response;
    }

    /**
     * Password recovery: sends a notification to RECOVERY_EMAIL via SMTP.
     * Does NOT expose any account details or reset the password automatically.
     */
    if (route === '/admin/recovery' && method === 'POST') {
      if (!SMTP_USER || !SMTP_PASSWORD || !RECOVERY_EMAIL) {
        return json({ error: 'Recovery email is not configured. Set SMTP_USER, SMTP_PASSWORD, and RECOVERY_EMAIL.' }, 503);
      }
      try {
        await sendRecoveryEmail();
        return json({ ok: true, sentTo: maskEmail(RECOVERY_EMAIL) });
      } catch (e) {
        console.error('[SMTP] Recovery email failed:', e.message);
        return json({ error: 'Could not send recovery email.' }, 500);
      }
    }

    // ---------------- ADMIN (requires valid session cookie) ----------------
    if (route.startsWith('/admin/')) {
      const session = await validateSession(request, database);
      if (!session) {
        return json({ error: 'Unauthorized' }, 401);
      }

      if (route === '/admin/me' && method === 'GET') {
        return json({ ok: true, user: { username: ADMIN_USERNAME } });
      }

      if (route === '/admin/stats' && method === 'GET') {
        const stats = await computeStats(database);
        const contribs = database.collection('contributors');
        const [pending, approved, hidden, onchain, formCount] = await Promise.all([
          contribs.countDocuments({ approved: false, hidden: { $ne: true } }),
          contribs.countDocuments({ approved: true, hidden: { $ne: true } }),
          contribs.countDocuments({ hidden: true }),
          contribs.countDocuments({ source: 'onchain' }),
          contribs.countDocuments({ source: { $in: ['form', 'form+onchain'] } }),
        ]);
        return json({ ...stats, pending, approvedCount: approved, hiddenCount: hidden, onchain, formCount });
      }

      if (route === '/admin/contributors' && method === 'GET') {
        const contribs = database.collection('contributors');
        const list = await contribs.find({}).sort({ createdAt: -1 }).limit(500).toArray();
        return json({ contributors: list });
      }

      if (route.startsWith('/admin/contributors/') && method === 'PATCH') {
        const id = pathSegs[pathSegs.length - 1];
        const body = await request.json();
        const patch = {};
        if (typeof body.approved === 'boolean') patch.approved = body.approved;
        if (typeof body.highlighted === 'boolean') patch.highlighted = body.highlighted;
        if (typeof body.hidden === 'boolean') patch.hidden = body.hidden;
        if (typeof body.name === 'string') patch.name = body.name.slice(0, 60);
        if (typeof body.nickname === 'string') patch.nickname = body.nickname.slice(0, 40);

        let warning = null;
        if (typeof body.txHash === 'string' && body.txHash.trim()) {
          const txHash = normalizeTxHash(body.txHash);
          const current = await database.collection('contributors').findOne({ id });
          if (current && current.txHash !== txHash) {
            const dupe = await database.collection('contributors').findOne({ txHash, id: { $ne: id } });
            if (dupe) {
              return json({ error: `That tx hash is already linked to contributor ${dupe.displayId}.` }, 400);
            }
            const settings = await getSettings(database);
            const wallet = settings.primaryWallet || DEFAULT_WALLET;
            const onchain = await verifyTxOnChain(wallet, txHash);
            patch.txHash = txHash;
            if (onchain) {
              patch.amount = onchain.amount;
              patch.fromAddress = onchain.fromAddress;
              patch.blockNumber = onchain.blockNumber;
              patch.verified = true;
              patch.source = (current.name || current.nickname) ? 'form+onchain' : 'onchain';
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

      if (route === '/admin/content' && method === 'PATCH') {
        const body = await request.json();
        const allowed = ['about', 'strategy', 'transparency', 'faq'];
        const patch = {};
        for (const k of allowed) if (body[k] !== undefined) patch[k] = body[k];
        const updated = await setContent(database, patch);
        return json({ ok: true, content: updated });
      }

      if (route === '/admin/goal' && method === 'PATCH') {
        const body = await request.json();
        const goal = Math.max(1, Number(body.goal) || DEFAULT_GOAL);
        const s = await setSettings(database, { goal });
        return json({ ok: true, goal: s.goal });
      }

      if (route === '/admin/wallets' && method === 'GET') {
        const wallets = await database.collection('wallets').find({}).toArray();
        return json({ wallets, primaryWallet: (await getSettings(database)).primaryWallet });
      }

      if (route === '/admin/wallets' && method === 'POST') {
        const body = await request.json();
        const w = {
          id: uuidv4(),
          label: (body.label || 'Wallet').slice(0, 40),
          network: (body.network || '').slice(0, 40),
          address: (body.address || '').slice(0, 100),
          active: body.active !== false,
          createdAt: new Date().toISOString(),
        };
        await database.collection('wallets').insertOne(w);
        return json({ ok: true, wallet: w });
      }

      if (route.startsWith('/admin/wallets/') && method === 'DELETE') {
        const id = pathSegs[pathSegs.length - 1];
        await database.collection('wallets').deleteOne({ id });
        return json({ ok: true });
      }

      if (route === '/admin/primary-wallet' && method === 'PATCH') {
        const body = await request.json();
        const primaryWallet = (body.address || '').slice(0, 100);
        if (!primaryWallet) return json({ error: 'address required' }, 400);
        const s = await setSettings(database, { primaryWallet });
        return json({ ok: true, primaryWallet: s.primaryWallet });
      }
    }

    if (route === '/' || route === '') {
      return json({ ok: true, service: 'unibatch-api', version: '0.3' });
    }

    return json({ error: 'Not found', route }, 404);
  } catch (err) {
    console.error('API error:', err);
    return json({ error: err?.message || 'Server error' }, 500);
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
