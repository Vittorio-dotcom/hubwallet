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
| 7 | Guest page: my key, my HUSD, nearby services (via QR link), order + pay + live status | Vittorio | done (first version, checks asset and amount before paying) |
| 8 | Device pages: big state (locked/open, running, rented + countdown), one per service, QR to the guest page | Vittorio | todo |
| 9 | QVAC server running on the AI PC, reachable on the venue network | Lapo | done (http://192.168.6.169:11434, ~1–2 s per answer) |
| 10 | `src/ai.js`: text → service JSON (3 templates), text → behaviour, text → bundle | Lapo | done |
| 11 | Hub routes `/api/ai/*` wired to ai.js | Lapo + Alessandro | doing (Alessandro: paste the 3 routes from CLAUDE.md "AI contract" into hub.js) |
| 12 | `src/behaviours.js`: rules engine (stock below, weekday price, overdue rental, notify); spending proposals go to the owner inbox | Alessandro | todo |
| 13 | Restock proposal approved → hub pays a supplier wallet (real transfer) | Alessandro | todo |
| 14 | Second hub (hub B) with its own wallet and 1–2 services; same guest wallet uses both | Alessandro | todo |
| 15 | Final README: how to run, real vs simulated, third-party tools, prior work (declare the WDK feasibility test) | Alessandro | todo |
| 16 | Pitch (5 min) + demo script + answers to likely questions | Vittorio + Lapo | todo |
| 17 | Questions to mentors (0-conf unlock, WDK bonus) | Lapo | todo |
| 18 | Stretch: Raspberry/ESP32 device driven by the hub | — | later |
| 19 | Host onboarding: AI turns "create the hub of X with door, washer, bike" into a setup plan JSON; code creates the wallet (WDK), UTXOs and services after the host confirms | Lapo (AI) + Alessandro (code) | todo |
| 20 | Guest onboarding (code only, no AI): create the guest wallet, show the address to fund and the first invoice to receive the key | Alessandro + Vittorio (UI) | todo |
| 21 | "Ask the home" box in the guest app: calls the hub's public `/api/ai/bundle`, shows the bundle and total, confirm → pay | Vittorio (UI) + Lapo (hub AI) | todo |
| 22 | Host AI panel in the host app: create services/behaviours by text, see the JSON, confirm | Vittorio (UI) + Lapo | todo |
| 23 | Device functions shown on device and host pages (behaviours list, last triggered) | Vittorio + Alessandro | todo |
| 24 | Privacy fix: `/api/stays` stores the guest name in hub-state.json, but we claim the hub keeps no guest identity. Make the name an optional label (or drop it) | Alessandro | todo |
| 26 | Architecture C: watch-only hub wallet (xpubs + stash), `src/signer.js` host signer, spending operations wait for the host's signature | Vittorio's Claude | doing |
| 27 | Plug-and-play: device descriptor (or label photo, stretch) → proposed service + behaviours → host confirms | Lapo | todo |
| 28 | House documents: upload contract/rules/manual; contract → proposed behaviours; guest questions answered from the documents (RAG) | Lapo | todo |
| 29 | Host page "To sign": pending spending (key to guest, restock, sweep) with a readable summary, approve = sign | Vittorio | todo |
| 25 | Encrypted backup of the demo wallets (WDK `createBackup`) on Saturday evening, kept outside the repo | Alessandro | todo |

## Notes
- Hub A runs on Vittorio's PC: `http://192.168.7.246:8080` (venue network).
- Alessandro: to run wallets on your own PC you need Node 22 and your own funded test wallets (`WALLET=hub-dev`); the demo wallets stay on Vittorio's PC. Owner key: ask Vittorio on Telegram.
- Demo rental hour = 1 minute (`HOUR_MS=60000`).
