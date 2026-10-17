# TASKS — team AVL

Update the status when you start (`doing`) and finish (`done`) a task. Pull before editing, push right after.
Deadline: last commit on `main` by **Sunday 18 October, 13:00**. Demo-ready target: **Sunday 11:00**.

## Owners
| Who | Folder | Area |
|---|---|---|
| Vittorio | `web/` | Interfaces: host app, guest app, device pages. His PC runs the demo hubs and wallets |
| Alessandro | `src/hub.js`, `src/guest.js`, `src/wallet.js`, `src/behaviours.js` | RGB + WDK backend (first version written on Vittorio's PC, now owned by Alessandro) |
| Lapo | `src/ai.js`, `prompts/` | Local AI with QVAC, AI server on the most powerful PC |

## Board
| # | Task | Owner | Status |
|---|---|---|---|
| 1 | WDK wallet module, hub and guest servers | Alessandro | done |
| 2 | Test dollar HUSD issued, guest funded, stay key issued and sent | Alessandro | done |
| 3 | Door opens when the guest hands over the key (real transfer) | Alessandro | done |
| 4 | Pay-per-use flow tested end to end (washing machine) | Alessandro | todo |
| 5 | Time-based rental tested end to end (bike), device locks when time is up | Alessandro | todo |
| 6 | Host page: services, stays (send key), earnings, inbox to approve, activity log with explorer links | Vittorio | todo |
| 7 | Guest page: my key, my HUSD, nearby services (via QR link), order + pay + live status | Vittorio | todo |
| 8 | Device pages: big state (locked/open, running, rented + countdown), one per service, QR to the guest page | Vittorio | todo |
| 9 | QVAC server running on the AI PC, reachable on the venue network | Lapo | doing |
| 10 | `src/ai.js`: text → service JSON (3 templates), text → behaviour, text → bundle | Lapo | doing |
| 11 | Hub routes `/api/ai/*` wired to ai.js | Lapo + Alessandro | todo |
| 12 | `src/behaviours.js`: rules engine (stock below, weekday price, overdue rental, notify); spending proposals go to the owner inbox | Alessandro | todo |
| 13 | Restock proposal approved → hub pays a supplier wallet (real transfer) | Alessandro | todo |
| 14 | Second hub (hub B) with 1–2 services; same guest wallet uses both | Alessandro | later |
| 15 | Final README: how to run, real vs simulated, third-party tools, prior work (declare the WDK feasibility test) | Alessandro | todo |
| 16 | Pitch (5 min) + demo script + answers to likely questions | Vittorio + Lapo | todo |
| 17 | Questions to mentors (0-conf unlock, WDK bonus) | Lapo | todo |
| 18 | Stretch: Raspberry/ESP32 device driven by the hub | — | later |

## Notes
- Hub A runs on Vittorio's PC: `http://192.168.7.246:8080` (venue network).
- Alessandro: to run wallets on your own PC you need Node 22 and your own funded test wallets (`WALLET=hub-dev`); the demo wallets stay on Vittorio's PC. Owner key: ask Vittorio on Telegram.
- Demo rental hour = 1 minute (`HOUR_MS=60000`).
