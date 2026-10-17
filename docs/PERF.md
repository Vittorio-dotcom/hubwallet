# Why the app is slow — analysis (18 Oct, branch `perf-threads`)

`main` is untouched; the state before this work is tagged `demo-safe-2026-10-18`.

## 1. Every rgb-lib call blocks Node
`@utexo/rgb-lib` is a SWIG binding (`swig_wrap.cxx`): no async workers, every call runs on
the main thread. A call that waits for the network (indexer, proxy) freezes the whole server:
pages, API, timers. `async` and the queue in `src/wallet.js` only put calls in a line.

Measured (fresh wallet, `getBtcBalance`): main thread → call 16.5 s, **event loop frozen 16.7 s**;
same call in a `worker_thread` → event loop frozen **1 ms**. The addon is context-aware on
Node 22, so it loads in a worker.

## 2. The real cost: reads that re-sync with the indexer every time
`@utexo/rgb-sdk` hard-codes `skipSync = false` in `registerWallet()` / `getBtcBalance()`
(our `balance()`) and `listUnspents()` (our `unspents()`). Each one is a full indexer sync,
~50 sequential HTTPS requests to Esplora (~0.3 s each).

Copy of the hub-demo wallet (9 transfers, 5 UTXOs — tiny):

| call | with sync | without sync (`skipSync = true`) |
|---|---|---|
| getBtcBalance | 16.8 / 19.7 / 24.8 s | 1 ms |
| listUnspents | 10.1 / 14.0 s | 1–2 ms |
| listAssets, listTransfers, witnessReceive, decodeInvoice | — | 0–5 ms (local) |

After one sync, the no-sync reads return **identical** balance and unspents.
Other indexers: mutinynet.com/api is 3–4× slower (52–64 s); the SDK's default Electrum
(46.224.75.237:50001) is another chain (tip 717k vs 3.5M). Keep kaleidoswap.

From the rgb-lib logs of today's run (real usage):

| wallet | balance syncs | unspents syncs | refresh | time frozen by balance+unspents |
|---|---|---|---|---|
| hub-demo | 87 × median 5.2 s (max 24) | 87 × 4.9 s (max 29) | 32 × median 1.1 s | **~22 min** |
| guest-demo | 161 × median 10 s (max 40) | — | 53 × 1.0 s | **~36 min** |
| hub-a | 106 × 6.9 s | 103 × 7.3 s | 1381 × 0.5 s | ~23 min |

So the refresh (payment watcher) is cheap; the page reads of the balance are what freeze the servers.
`GET /api/wallet` (hub: balance + unspents = 2 syncs) and `GET /api/me` (guest) re-sync every
30 s cache window while a page is open.

## 3. Head-of-line blocking in the wallet queue
All calls of one wallet share one queue. A 0 ms call waits behind a 10–25 s sync:
- guest taps a machine → `requestPayment` (witness invoice, 0 ms) waits for the host page's `/api/wallet` sync;
- guest `/api/check` → `decodeInvoice` (0 ms) waits for its own `/api/me` sync.

## Fix plan (on this branch)
1. **Reads without sync** (small, low risk): `balance()` / `unspents()` call rgb-lib with
   `skipSync = true` (`manager.client.wallet.getBtcBalance(online, true)`,
   `listUnspents(online, false, true)`; guest: `account._wallet.client.wallet`).
   One explicit `sync` only when the numbers can change: end of a payment/refresh burst, after a send,
   after creating UTXOs, and on `?fresh=1`. Expected: pages 10–25 s → milliseconds.
2. **Worker thread per wallet** (optional, after 1): the remaining syncs/refreshes no longer freeze
   HTTP. Rules: the wallet is opened ONLY inside the worker (never two openers on one stash);
   only plain JSON crosses threads (`plain()` already does it); same public API of `src/wallet.js`.
3. Re-run the real end-to-end test (pay, sign, sweep, restart) before merging into `main`.
