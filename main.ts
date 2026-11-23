// Slackwater II: a patient dip-buy bot for the cbBTC 24h race
// (make.fun btc-race-24h-20261123-0511).
//
// Idea: Bitcoin's 1-minute noise is ~7 bps, so a 0.9% pullback from the
// last hour's high is a real dislocation, not noise. Slackwater II waits
// for one, buys half its cash, and scales in if the dip deepens. It only
// buys when the 4-hour trend is not already in a waterfall (worse than
// -1%), banks half the position at +0.8% and the rest at +1.5% from its
// filled cost basis, and caps any disaster with a -2% hard stop. No fitted
// schedule, no momentum chasing, no clock, no randomness: every decision
// is integer arithmetic on the closes the feed has sent, so two runs on
// the same data produce identical orders.
//
// Why so few trades: a full round trip costs ~26 bps in fees, slippage
// and impact, and fitted high-frequency schedules do not survive the one
// unseen live day. One or two well-chosen swings beat hundreds of fitted
// ones. This bot is the successor of Slackwater, which made +$9.67 on the
// 2026-11-18 edition's dev window with the same shape of strategy; it is
// re-implemented here for this edition's dev window and re-graded on it
// before submission.

import { runBars, type BarsState } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// --- parameters (basis points unless noted) ---
const LOOKBACK = 60; // minutes of closes forming the reference high
const DIP_BPS = 90n; // buy when close is 0.9% below the 60-min high
const TREND_LEN = 240; // minutes of history for the trend filter
const TREND_BPS = 100n; // refuse new buys when the 4h return is worse than -1%
const MAX_BUYS = 3; // first buy + at most two scale-ins
const STEP_BPS = 100n; // scale in each further 1% below the average entry
const HALF_BPS = 80n; // bank half the position at +0.8% from average entry
const REST_BPS = 150n; // sell the rest at +1.5% from average entry
const STOP_BPS = 200n; // hard stop: sell everything at -2% from average entry
const MAX_SLIPPAGE_BPS = 200; // 2% guard against a wild next open; 1-min moves are ~7 bps
const BPS = 10000n;

// --- run state (only feed data; nothing else varies between runs) ---
const closes: bigint[] = []; // closes seen so far, raw price units
let buys = 0; // buy orders observed filled for the current position
let halfSold = false; // the +0.8% half-sale has been observed filled
let pendingBuyQty: bigint | null = null; // qty held when a buy was decided
let pendingHalfQty: bigint | null = null; // qty held when the half-sale was decided

function avgPrice(state: BarsState, qty: bigint, cost: bigint): bigint {
  // Filled average entry price in raw price units, from cost / qty.
  // value(qty, price) = qty * price * 10**quote_scale / 10**(qty_scale +
  // price_scale), so price = cost * 10**(qty_scale + price_scale -
  // quote_scale) / qty. Cost includes fees, so this is the true basis.
  const sym = state.symbols.get(SYMBOL)!;
  const factor = 10n ** BigInt(sym.qty_scale + sym.price_scale - state.hello.capital.quote_scale);
  return (cost * factor) / qty;
}

await runBars({
  onBatch(state) {
    if (state.warmingUp) return [];

    const close = state.close(SYMBOL);
    if (close === null) return [];

    const holding = state.positions.get(SYMBOL);
    const qty = holding?.qty ?? 0n;
    const cost = holding?.cost ?? 0n;

    // Confirm last batch's orders against the account actually delivered:
    // a rejected order must not count as a filled tranche or sale.
    if (pendingBuyQty !== null) {
      if (qty > pendingBuyQty) buys += 1;
      pendingBuyQty = null;
    }
    if (pendingHalfQty !== null) {
      if (qty < pendingHalfQty) halfSold = true;
      pendingHalfQty = null;
    }

    closes.push(close);

    if (qty === 0n) {
      buys = 0;
      halfSold = false;
      if (closes.length < LOOKBACK) return [];
      let high = 0n;
      for (let i = closes.length - LOOKBACK; i < closes.length; i++) {
        if (closes[i] > high) high = closes[i];
      }
      // Trend filter, once 4 hours of history exist: sit out waterfalls.
      if (closes.length > TREND_LEN) {
        if (close * BPS < closes[closes.length - TREND_LEN - 1] * (BPS - TREND_BPS)) return [];
      }
      if (close * BPS > high * (BPS - DIP_BPS)) return [];
      const notional = state.cash / 2n;
      if (notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
      pendingBuyQty = qty;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }

    const avg = avgPrice(state, qty, cost);

    // Hard stop first: cap the disaster, whatever else is true.
    if (close * BPS <= avg * (BPS - STOP_BPS)) {
      return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }

    // Bank half at +0.8%, then let the rest run to +1.5%.
    if (!halfSold && close * BPS >= avg * (BPS + HALF_BPS)) {
      const halfQty = qty / 2n;
      if (halfQty > 0n) {
        pendingHalfQty = qty;
        return [{ side: 'sell', symbol: SYMBOL, qty: halfQty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }
    if (halfSold && close * BPS >= avg * (BPS + REST_BPS)) {
      return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }

    // The dip deepened: average down with half the cash left, at most twice.
    if (buys < MAX_BUYS && close * BPS <= avg * (BPS - STEP_BPS)) {
      const notional = state.cash / 2n;
      if (notional >= BigInt(state.hello.fees.min_notional_quote_units)) {
        pendingBuyQty = qty;
        return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }

    return [];
  },
});
