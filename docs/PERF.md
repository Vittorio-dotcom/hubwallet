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

## 4. The watcher was late after the block (payments 50–150 s)
Today's real payments (hub-state.json + block_time on the indexer): block after ~35 s on average,
hub said "paid" ~40 s later (11–89 s). Two causes: the burst checked only at 0/35/70/120 s, and the
refresh waited in the queue behind balance syncs (hub-demo, with the host page open: 25–89 s late;
hub-a without it: 11–16 s). Inside rgb-lib, settling a witness payment also runs two indexer syncs
(`wait_confirmations` → `sync_db_txos` when `skip_sync` is false: ~30 s on a tiny wallet).

## Done on this branch (tested with real payments, guest-marta → hub-a on ports 8190/8180)
1. `balance()` / `unspents()` read the local database (`skipSync = true`): **15–30 ms** instead of 10–25 s.
2. Explicit `sync()` only at start-up, 20 s after a burst, on manual refresh (`POST /api/refresh`), after a guest payment burst.
3. Hub watcher after a claim: refresh every 5 s until the payment settles (max 3 min).
4. Fast refresh (`skip_sync = true`) while only incoming payments are followed. Safe: the witness txo is
   written to the database when the consignment is accepted (rgb-lib online.rs, `pending_witness`).
   Spends (signed PSBTs) keep the full refresh.
5. An unpaid invoice stays `waiting` (rgb-lib also calls it WaitingCounterparty; the guest refused to pay it).

Results: order + check + send **~1 s** (was 10–30 s when queued behind syncs). Paid after the block:
12 s and 31 s in the clean runs (was 25–89 s on hub-demo); what remains is rgb-lib's client-side
validation (one or two rounds of ~10–13 s after "Getting TX height"), which must stay.
Still blocking: the syncs themselves (start-up, end of burst, ~10–25 s) and the validation → worker thread (step below).

## Incident during the test (my mistake, repaired)
A test hub was started twice on the same wallet (the first one did not listen yet: at start-up the
hub binds its port only after the first rgb-lib calls, 20–40 s). Both appended to
`bdk_db_watch_only` (bdk file store: no locking) → truncated entry → "bincode error … failed to fill
whole buffer" at the next start. The RGB stash (`rgb/*.dat`, `rgb_lib_db`) was intact.
Repair, tried first on a copy: move `bdk_db_watch_only` aside, start, sync → consistency check passes,
same BTC balance, assets and UTXOs. Corrupt file kept as `data/hub-a/bdk_db_watch_only.corrupt-2026-10-18`.
Lesson: before starting a wallet, check the PROCESS (pgrep + WALLET env), not the port.

## Next (optional)
1. ~~Reads without sync~~ (done, see above): `balance()` / `unspents()` call rgb-lib with
   `skipSync = true` (`manager.client.wallet.getBtcBalance(online, true)`,
   `listUnspents(online, false, true)`; guest: `account._wallet.client.wallet`).
   One explicit `sync` only when the numbers can change: end of a payment/refresh burst, after a send,
   after creating UTXOs, and on `?fresh=1`. Expected: pages 10–25 s → milliseconds.
2. **Worker thread per wallet** (optional, after 1): the remaining syncs/refreshes no longer freeze
   HTTP. Rules: the wallet is opened ONLY inside the worker (never two openers on one stash);
   only plain JSON crosses threads (`plain()` already does it); same public API of `src/wallet.js`.
3. Re-run the real end-to-end test (pay, sign, sweep, restart) before merging into `main`.
