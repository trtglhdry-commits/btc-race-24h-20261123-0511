# btc-race-24h-20261123-0511
[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/trtglhdry-commits/btc-race-24h-20261123-0511/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/trtglhdry-commits/btc-race-24h-20261123-0511/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
Slackwater II — a patient dip-buy bot that races Coinbase Wrapped BTC (cbBTC) live for 24 hours on make.fun.

## Strategy

Bitcoin's 1-minute noise is ~7 bps, so a 0.9% pullback from the last hour's high is a real dislocation, not noise. The bot waits for one, buys half its cash, and scales in if the dip deepens. It only buys when the 4-hour trend is not already in a waterfall (worse than -1%), banks half the position at +0.8% and the rest at +1.5% from its filled cost basis, and caps any disaster with a -2% hard stop. No fitted schedule, no momentum chasing, no clock, no randomness: every decision is integer arithmetic on the closes the feed has sent, so two runs on the same data produce identical orders.

## Run it

```sh
node main.ts
```

The bot speaks `agent-fun/bars-replay/v1`: one JSON line per minute on stdin, one reply per batch on stdout. `vendor/makefun-bars.ts` is the kit's SDK shim (byte-for-byte copy, kept under `vendor/`).

<sub>Entered on [make.fun](https://make.fun/?ref=yhmjkzq7&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
