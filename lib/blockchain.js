/**
 * lib/blockchain.js — BSC on-chain USDT (BEP20) transaction verification.
 *
 * Uses public BSC JSON-RPC endpoints — no API key required.
 * Falls back through multiple RPC URLs on failure.
 *
 * All functions are safe to call with any input — they validate internally
 * and return null rather than throwing on bad/missing data.
 */

// ---------- Constants ----------
export const USDT_BEP20_CONTRACT =
  '0x55d398326f99059fF775485246999027B3197955';

export const DEFAULT_WALLET =
  '0x815c9aeE32b098f7256A51957E1A4eE7290DF314';

const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const BSC_RPC_URLS = [
  'https://bsc-pokt.nodies.app',
  'https://1rpc.io/bnb',
  'https://bsc-dataseed1.ninicoin.io',
];

// Minimum number of blocks that must be mined on top of a transaction's
// block before it is treated as final (protects against short reorgs).
// Configurable via MIN_CONFIRMATIONS; falls back to a sane default.
const DEFAULT_MIN_CONFIRMATIONS = 3;
function getMinConfirmations() {
  const n = Number(process.env.MIN_CONFIRMATIONS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MIN_CONFIRMATIONS;
}

// ---------- RPC ----------
async function rpcCall(method, params) {
  let lastErr;
  for (const url of BSC_RPC_URLS) {
    try {
      const resp = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        cache:   'no-store',
        signal:  AbortSignal.timeout(15_000),
        body:    JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (!resp.ok) { lastErr = new Error(`HTTP ${resp.status}`); continue; }
      const data = await resp.json();
      if (data.error) { lastErr = new Error(data.error.message || 'RPC error'); continue; }
      return data.result;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('All BSC RPC endpoints failed');
}

// ---------- Helpers ----------
function paddedAddress(addr) {
  if (!addr || typeof addr !== 'string') return '';
  return '0x' + '0'.repeat(24) + addr.toLowerCase().slice(2);
}

function decodeTransferAmount(dataHex) {
  if (!dataHex || typeof dataHex !== 'string') return 0;
  try {
    const raw     = BigInt(dataHex);
    const divisor = BigInt(10) ** BigInt(18);
    const whole   = raw / divisor;
    const frac    = raw % divisor;
    const fracStr = frac.toString().padStart(18, '0').slice(0, 6);
    return parseFloat(`${whole.toString()}.${fracStr}`) || 0;
  } catch {
    return 0;
  }
}

/**
 * Normalizes a raw tx hash input into a lowercase 0x-prefixed 64-hex-char
 * string, or returns an empty string if input is not a valid hash.
 */
export function normalizeTxHash(raw) {
  if (!raw) return '';
  const t = String(raw).trim().toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(t) ? t : '';
}

// ---------- On-chain verification ----------
/**
 * Verifies that a given BSC transaction hash represents a USDT BEP20
 * Transfer to `wallet`, and returns the transferred amount + metadata.
 *
 * Returns null on any failure (bad hash, wrong wallet, tx not found,
 * network error, etc.) — never throws.
 *
 * The result's `status` field is either:
 *  - 'confirmed' — at least MIN_CONFIRMATIONS blocks have been mined on top
 *    of the transaction's block; safe to treat as final.
 *  - 'pending'   — a valid matching Transfer log was found, but the chain
 *    hasn't yet mined enough blocks on top of it to rule out a reorg.
 *
 * @returns {{ status: 'confirmed' | 'pending', amount: number, fromAddress: string, blockNumber: number, confirmations: number, requiredConfirmations: number } | null}
 */
export async function verifyTxOnChain(wallet, txHash) {
  try {
    if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return null;
    if (!wallet || typeof wallet !== 'string') return null;

    const receipt = await rpcCall('eth_getTransactionReceipt', [txHash]);
    if (!receipt || !Array.isArray(receipt.logs)) return null;
    if (receipt.status !== '0x1') return null; // reverted

    const walletPadded = paddedAddress(wallet);

    for (const log of receipt.logs) {
      if (
        typeof log.address === 'string' &&
        log.address.toLowerCase() === USDT_BEP20_CONTRACT.toLowerCase() &&
        Array.isArray(log.topics) &&
        typeof log.topics[0] === 'string' &&
        log.topics[0].toLowerCase() === TRANSFER_TOPIC.toLowerCase() &&
        typeof log.topics[2] === 'string' &&
        log.topics[2].toLowerCase() === walletPadded.toLowerCase()
      ) {
        const amount = decodeTransferAmount(log.data);
        if (amount <= 0) continue;

        const fromAddress =
          typeof log.topics[1] === 'string'
            ? '0x' + log.topics[1].slice(-40)
            : 'unknown';

        const blockNumber =
          typeof log.blockNumber === 'string'
            ? parseInt(log.blockNumber, 16)
            : 0;

        // ---- Confirmation depth check ----
        const requiredConfirmations = getMinConfirmations();
        let confirmations = 0;
        try {
          const currentHex   = await rpcCall('eth_blockNumber', []);
          const currentBlock = typeof currentHex === 'string' ? parseInt(currentHex, 16) : 0;
          if (blockNumber > 0 && currentBlock > 0) {
            confirmations = Math.max(0, (currentBlock - blockNumber) + 1);
          }
        } catch {
          // If we can't determine chain height, be conservative and treat
          // the transaction as unconfirmed rather than finalizing it.
          confirmations = 0;
        }

        const status = confirmations >= requiredConfirmations ? 'confirmed' : 'pending';

        return { status, amount, fromAddress, blockNumber, confirmations, requiredConfirmations };
      }
    }
    return null;
  } catch {
    return null;
  }
}
