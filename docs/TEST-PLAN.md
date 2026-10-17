# Test plan and results — Saturday 17 October, evening (demo PC, Mutinynet)

Run by Vittorio's Claude Code with clean demo wallets: hub `hub-demo` "Lavanderia" (:8080, watch-only),
hub `hub-b` "Cortile" (:8081, watch-only), guest `guest-demo` (:8090), host personal wallet `provider` (:8091),
signer `src/signer.js watch` (approved by Vittorio). All transfers are real on Mutinynet.

## 0. Setup and speed (after Alessandro's targeted refreshes, c9627c9)
| # | Test | Result |
|---|---|---|
| 0.2 | API times, old wallets (hub-a, guest-marta) | ✅ pages/services/devices 2–3 ms · ⚠️ first balance 22–38 s (wallets with history) |
| 0.2 | API times, clean wallets | ✅ hub 1–2 ms · hub balance ~2 s · guest balance ~4 s |
| 0.3 | Clean wallets funded (sats from the spike wallet, 50 HUSD from guest-marta) | ✅ |
| — | Note | blinded invoice: the **sender must refresh after the receiver's ACK** to broadcast |

## 1. Real payment (demo step 1)
| # | Test | Result |
|---|---|---|
| 1.1 | Guest app connects hub from link (confirmation banner) | ✅ |
| 1.2 | Pay dryer / washer: check → confirm → pay-request → paid | ✅ 84 s (API), ~50 s confirm→running (page); receipt signed and valid |
| 1.3 | "In use · m:ss left" on guest app, host app, device screen | ✅ (USE_MS = 45 s in the demo) |
| 1.4 | Order a busy device | ✅ refused by the hub ("Dryer is busy") and by the page |
| 1.6 | Host earnings and uses | ✅ exact per device; hub balance matches |
| 1.7 | Explorer shows a normal Bitcoin tx, no HUSD amounts | ✅ |

## 2. AI and configuration (host)
| # | Test | Result |
|---|---|---|
| 2.1 | Add device by chat ("una macchina del caffè" → price → rules) | ✅ proposal, Apply, guest sees it |
| 2.2 | Vague edit ("alza il prezzo") → AI asks "How much?" → answer | ✅ with a consistent amount · ⚠️ "alza a 1.00" when it costs 2.00 asks again without explaining (Lapo) |
| 2.3 | "bloccala dopo le 22" + demo clock 23:00 | ✅ locked everywhere, order refused by the hub |
| 2.4 | Demo clock back to real time | ✅ free |
| 2.5 | Nonsense ("banana") | ✅ explains what can be changed, nothing saved |
| 2.6 | Remove device | ✅ disappears for guests, earnings kept |
| — | House document → rules | ✅ laundry rules → lock 22:00 / unlock 7:00 / maintenance every 50; duplicates skipped by the page |

## 3. Security
| # | Test | Result |
|---|---|---|
| 3.1 | Hub folder holds no seed | ✅ `hub-keys.json`, `identity.pem`, `owner-key.txt`, stash only |
| 3.2 | Sweep from host app waits in "To sign", money unmoved | ✅ (page fixed: witness invoice for a new host wallet) |
| 3.3 | Signer approves (`y`) → 5.00 HUSD reach the host wallet | ✅ tx 5d51c7b9…05b2; hub balance 0 afterwards |
| 3.5 | Owner routes without key / wrong key | ✅ 401 |
| 3.6 | Hub asks another amount or asset than confirmed | ✅ wallet refuses ("no longer matches what you confirmed") |

## 4. Second host
| # | Test | Result |
|---|---|---|
| 4.1 | Same guest pays hub B "Cortile" | ✅ paid in 93 s |
| 4.2 | Host app with two hubs, separate earnings | ✅ · ⚠️ hub B has 0 sats: send some before sweeping it |

## 5. Robustness
| # | Test | Result |
|---|---|---|
| 5.1 | Restart the hub mid-payment | ✅ paid, but 170 s: after a restart only the 2-min fallback runs (Alessandro: burst at start-up if payments are open) |
| 5.2 | Wi-Fi off 30 s | ⏳ to do with Vittorio |
| 5.3 | Two payments in a row | ⚠️ second refused (`InsufficientAssignments`: dollars still settling ~1 min). Page now explains it. Demo: one payment at a time |
| 5.4 | Device screen on a phone | ⏳ to do with Vittorio |
| — | Guest wallet ran out of colorable UTXOs after 4 payments (`InsufficientAllocationSlots`) | ⚠️ page now offers "Prepare my wallet"; demo: create ~10 UTXOs beforehand. Backend idea: auto-create when < 3 free |

## Open points
- Alessandro: hub `GET /api/wallet` is not served from cache (2nd call still ~20 s on hub-a); burst refresh at start-up; auto-replenish UTXOs.
- Lapo: explain contradictory amounts in edits ("1.00 is less than the current 2.00").
