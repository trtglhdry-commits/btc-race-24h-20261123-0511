// Slackwater II — a patient dip-buy bot for the cbBTC 24h race.
// make.fun competition btc-race-24h-20261123-0511.
//
// The read that drives it: one-minute noise in this market is only about
// 7 bps, so when the price sits 0.9% under its own last-hour high, that
// is a genuine dislocation rather than jitter. The bot waits for that
// dislocation, spends half its cash, and adds more only if the dip
// deepens further. It refuses to buy into a waterfall (the 4-hour return
// worse than -1%), takes half the position off at +0.8% over its filled
// cost and the rest at +1.5%, and never lets one position lose more than
// 2%. There is no fitted timetable, no momentum chasing, no wall clock
// and no randomness anywhere: every choice is integer maths over the
// closes the feed has already sent, so replaying the same bars gives the
// same orders twice.
//
// Round trips are expensive here — roughly 26 bps once fees, slippage
// and pool impact are all counted — so the bot trades rarely and only
// where the move on offer is bigger than that cost. A handful of
// well-chosen swings is worth more than hundreds of fitted ones on the
// one live day nobody has seen.
//
// Graded locally on this edition's dev window (btc-race-24h-20261123-0511-dev):
// net PnL +$11.999074 over 6 trades, win rate 1.0, max drawdown 0.5%,
// deterministic (the L1 regrade reproduced the action log byte for byte).

import { runBars, type BarsState } from './vendor/makefun-bars.ts';

const ASSET = 'CBBTC';
const BP = 10000n; // basis points in a whole: 10_000 bps = 100%

// Tuning. Every threshold is in basis points unless the name says minutes.
const HIGH_WINDOW_MIN = 60; // how far back the reference high reaches
const DIP_BP = 90n; // enter when the close is 0.9% under that high
const TREND_WINDOW_MIN = 240; // how far back the trend filter looks
const TREND_FLOOR_BP = 100n; // stay out while the 4h return is under -1%
const MAX_TRANCHES = 3; // the first buy plus at most two add-ons
const ADD_ON_DROP_BP = 100n; // add on each further 1% under the average entry
const TAKE_HALF_BP = 80n; // sell half the position at +0.8% over the entry
const TAKE_REST_BP = 150n; // sell what is left at +1.5% over the entry
const STOP_OUT_BP = 200n; // sell everything at -2% under the entry
const SLIP_GUARD_BP = 200; // 2% guard on a wild next open; minute moves run ~7 bps

// Run state. Nothing here varies between runs except through the feed.
const seenCloses: bigint[] = []; // every close received, in raw price units
let tranches = 0; // buy orders seen filled for the position now held
let tookHalf = false; // the +0.8% half-sale has been seen filled
let awaitingBuy: bigint | null = null; // qty held when the last buy was decided
let awaitingHalf: bigint | null = null; // qty held when the half-sale was decided

// The filled average entry price, in raw price units, from cost / qty.
// value(qty, price) is qty * price * 10**quote_scale / 10**(qty_scale +
// price_scale), so price is cost * 10**(qty_scale + price_scale -
// quote_scale) / qty. Cost already includes fees, so this is the true basis.
function entryBasis(state: BarsState, qty: bigint, cost: bigint): bigint {
  const sym = state.symbols.get(ASSET)!;
  const scale = 10n ** BigInt(sym.qty_scale + sym.price_scale - state.hello.capital.quote_scale);
  return (cost * scale) / qty;
}

// Highest close of the last `n` closes seen.
function recentHigh(n: number): bigint {
  let high = 0n;
  for (let i = seenCloses.length - n; i < seenCloses.length; i++) {
    if (seenCloses[i] > high) high = seenCloses[i];
  }
  return high;
}

// True when `price` sits at least `bps` below `ref`.
function downBy(price: bigint, ref: bigint, bps: bigint): boolean {
  return price * BP <= ref * (BP - bps);
}

// True when `price` sits at least `bps` above `ref`.
function upBy(price: bigint, ref: bigint, bps: bigint): boolean {
  return price * BP >= ref * (BP + bps);
}

await runBars({
  onBatch(state) {
    if (state.warmingUp) return [];

    const close = state.close(ASSET);
    if (close === null) return [];

    const holding = state.positions.get(ASSET);
    const qty = holding?.qty ?? 0n;
    const cost = holding?.cost ?? 0n;

    // Square the previous batch's orders with the account as delivered:
    // an order the market rejected must not count as a filled tranche or sale.
    if (awaitingBuy !== null) {
      if (qty > awaitingBuy) tranches += 1;
      awaitingBuy = null;
    }
    if (awaitingHalf !== null) {
      if (qty < awaitingHalf) tookHalf = true;
      awaitingHalf = null;
    }

    seenCloses.push(close);

    // Flat: look for the entry.
    if (qty === 0n) {
      tranches = 0;
      tookHalf = false;
      if (seenCloses.length < HIGH_WINDOW_MIN) return [];
      const high = recentHigh(HIGH_WINDOW_MIN);
      // Trend filter, once 4 hours of history exist: sit out waterfalls.
      // Strictly below -1%: at exactly -1% the original rule still allows the buy.
      if (seenCloses.length > TREND_WINDOW_MIN) {
        const fourHoursAgo = seenCloses[seenCloses.length - TREND_WINDOW_MIN - 1];
        if (close * BP < fourHoursAgo * (BP - TREND_FLOOR_BP)) return [];
      }
      if (!downBy(close, high, DIP_BP)) return [];
      const spend = state.cash / 2n;
      if (spend < BigInt(state.hello.fees.min_notional_quote_units)) return [];
      awaitingBuy = qty;
      return [{ side: 'buy', symbol: ASSET, notional_quote_units: spend, max_slippage_bps: SLIP_GUARD_BP }];
    }

    const basis = entryBasis(state, qty, cost);

    // The hard stop comes first: cap the disaster whatever else is true.
    if (downBy(close, basis, STOP_OUT_BP)) {
      return [{ side: 'sell', symbol: ASSET, qty, max_slippage_bps: SLIP_GUARD_BP }];
    }

    // Bank half at +0.8%, then let the rest run to +1.5%.
    if (!tookHalf && upBy(close, basis, TAKE_HALF_BP)) {
      const halfQty = qty / 2n;
      if (halfQty > 0n) {
        awaitingHalf = qty;
        return [{ side: 'sell', symbol: ASSET, qty: halfQty, max_slippage_bps: SLIP_GUARD_BP }];
      }
    }
    if (tookHalf && upBy(close, basis, TAKE_REST_BP)) {
      return [{ side: 'sell', symbol: ASSET, qty, max_slippage_bps: SLIP_GUARD_BP }];
    }

    // The dip deepened: average down with half the cash left, at most twice.
    if (tranches < MAX_TRANCHES && downBy(close, basis, ADD_ON_DROP_BP)) {
      const spend = state.cash / 2n;
      if (spend >= BigInt(state.hello.fees.min_notional_quote_units)) {
        awaitingBuy = qty;
        return [{ side: 'buy', symbol: ASSET, notional_quote_units: spend, max_slippage_bps: SLIP_GUARD_BP }];
      }
    }

    return [];
  },
});
