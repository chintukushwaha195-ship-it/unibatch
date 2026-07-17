/**
 * lib/db.js — MongoDB connection with singleton caching, auto-reconnect,
 * and collection index bootstrapping.
 *
 * Rules:
 *  - Never crashes the process — errors are thrown to the caller.
 *  - One connection is shared across all serverless invocations in the same
 *    Node.js runtime (standard Next.js / Vercel behaviour).
 *  - If MONGO_URL is missing, every getDb() call throws a clear message.
 *  - If the connection drops, the next getDb() call reconnects automatically.
 */

import { MongoClient } from 'mongodb';

// ---------- Validate env at import time (not at build time, safe) ----------
const MONGO_URL = process.env.MONGO_URL;
const DB_NAME   = process.env.DB_NAME || 'unibatch';

if (!MONGO_URL) {
  // Warn loudly in server logs. getDb() will also throw before touching Mongo.
  console.error('[db] MONGO_URL is not set. Every API call will fail until it is configured.');
}

// ---------- Module-level state ----------
/** Pending connection Promise — prevents parallel cold-start races. */
let _connectionPromise = null;
/** Resolved MongoClient — kept for event listener bookkeeping. */
let _client = null;
/** Resolved Db instance — returned directly on warm requests. */
let _db = null;

// ---------- Index bootstrapping ----------
async function ensureIndexes(database) {
  const tasks = [
    // contributors — unique tx hash (partial: only when txHash is a string)
    database.collection('contributors').createIndex(
      { txHash: 1 },
      {
        unique: true,
        partialFilterExpression: { txHash: { $type: 'string' } },
        background: true,
      }
    ),
    // admin_sessions — unique session ID + TTL expiry
    database.collection('admin_sessions').createIndex(
      { sessionId: 1 },
      { unique: true, background: true }
    ),
    database.collection('admin_sessions').createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, background: true }
    ),
      //  New INDEX — unique email 
    database.collection('contributors').createIndex(
      { email: 1, txHash: 1 },
      { unique: true, background: true }
    ), 
   
    // admin_security — unique device key (kept for backward-compat / diagnostics).
    // Partial filter is required here: /admin/recovery upserts admin_security
    // documents keyed by ipKey WITHOUT setting deviceKey (recovery has no
    // device fingerprint to record). Without this filter, every such document
    // is treated as deviceKey: null for uniqueness purposes, and a plain
    // unique index only permits a single null across the whole collection —
    // so the next login for any IP that previously used Forgot Password
    // throws an uncaught duplicate-key error the moment it tries to set
    // deviceKey for the first time.
    database.collection('admin_security').createIndex(
      { deviceKey: 1 },
      { unique: true, background: true, partialFilterExpression: { deviceKey: { $type: 'string' } } }
    ),
    // admin_security — unique IP-derived security key. This is the field
    // actual brute-force lockout state is keyed on (see lib/auth.js
    // computeIpKey) — unlike deviceKey, it cannot be influenced by anything
    // in the request body.
    database.collection('admin_security').createIndex(
      { ipKey: 1 },
      { unique: true, background: true, partialFilterExpression: { ipKey: { $type: 'string' } } }
    ),
    // settings / site_content — singleton documents keyed by "main".
    // Unique index prevents duplicate "main" docs from concurrent
    // find-then-insert races on cold serverless starts.
    database.collection('settings').createIndex(
      { key: 1 },
      { unique: true, background: true }
    ),
    database.collection('site_content').createIndex(
      { key: 1 },
      { unique: true, background: true }
    ),
    // donations — verified on-chain transfers that count toward campaign
    // progress, independent of contributor attribution records.
    database.collection('donations').createIndex(
      { txHash: 1 },
      { unique: true, background: true }
    ),
    // counters — atomic sequence generator (contributor display IDs, etc).
    database.collection('counters').createIndex(
      { key: 1 },
      { unique: true, background: true }
    ),
  ];

  for (const task of tasks) {
    try {
      await task;
    } catch (e) {
      // Code 85/86 = IndexOptionsConflict / IndexKeySpecsConflict — already exists, fine.
      if (![85, 86].includes(e?.code)) {
        console.warn('[db] Index creation warning (non-fatal):', e?.message);
      }
    }
  }
}

// ---------- Internal connect ----------
async function _connect() {
  if (!MONGO_URL) {
    throw new Error(
      'MONGO_URL environment variable is not set. ' +
      'Add it to .env.local (development) or your Vercel project settings (production).'
    );
  }

  const client = new MongoClient(MONGO_URL, {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS:         10_000,
    socketTimeoutMS:          45_000,
    // Each serverless function instance keeps its own client/pool, and many
    // instances can run concurrently under Vercel — a smaller per-instance
    // pool avoids exhausting the Atlas cluster's total connection limit
    // under high concurrency while still allowing a little local headroom.
    maxPoolSize:              5,
  });

  await client.connect();
  const database = client.db(DB_NAME);

  // Bootstrap indexes asynchronously — do not block the first request.
  ensureIndexes(database).catch((e) =>
    console.error('[db] ensureIndexes error:', e?.message)
  );

  // On disconnect, clear cached state so the next getDb() reconnects.
  client.on('close', () => {
    console.warn('[db] MongoDB connection closed — will reconnect on next request.');
    _db = null;
    _client = null;
    _connectionPromise = null;
  });

  _client = client;
  _db = database;
  return database;
}

// ---------- Public API ----------
/**
 * Returns a connected Db instance.
 * Throws with a human-readable message if MONGO_URL is missing or the
 * connection fails — callers should catch and return HTTP 503.
 */
export async function getDb() {
  // Fast path: already connected.
  if (_db) return _db;

  // Mid-flight: a connection attempt is already in progress — await it.
  if (_connectionPromise) return _connectionPromise;

  // Cold start: kick off a new connection.
  _connectionPromise = _connect().catch((err) => {
    // Allow future retries.
    _connectionPromise = null;
    throw err;
  });

  return _connectionPromise;
}
