# TASKS — team AVL (reset on Saturday 17 October, after the plan in `docs/PLAN.md`)

Development restarts here, following the agreed plan (architecture C: user wallet, host signer, watch-only hubs).
Update the status when you start (`doing`) and finish (`done`). `git pull --no-rebase` before editing, push right after.
Deadline: last commit on `main` by **Sunday 18 October, 13:00**. Full demo rehearsed by **Sunday 11:00**.

Kept from the morning: `src/wallet.js` (to be rewritten for C), `src/ai.js` + `prompts/` (Lapo), the funded demo
wallets in `data/` (not in git). Removed: the first hub, guest and web code.

## Owners and boundaries
| Who | Owns | Area |
|---|---|---|
| **Vittorio's Claude** (demo PC, wallets live there) | `src/wallet.js`, `src/signer.js`, `src/hub.js`, `src/guest.js` | RGB core with architecture C, hub API, wiring of AI and behaviours into the hub |
| **Alessandro** | `src/behaviours.js`, `src/supplier.js`, `test/` | Device functions engine, supplier wallet and restock, end-to-end tests, hub B setup, backups |
| **Lapo** | `src/ai.js`, `prompts/`, `README.md` | Local AI: plug-and-play, house documents, onboarding plan; final README; questions to mentors |
| **Vittorio** | `web/` | Host app, signer page (host's phone), guest app, device pages |

## Interfaces between the parts (agree here before coding against them)
- **Hub API**: written in `CLAUDE.md` by Vittorio's Claude as the routes are built. Vittorio builds `web/` against it.
- **Behaviours** (`src/behaviours.js`, Alessandro): a pure module, no wallet access.
  `export function evaluate(hubState, now) → actions[]`, where an action is one of
  `{ kind: 'propose_purchase', serviceId, to: 'supplier', amount, reason }` · `{ kind: 'set_price', serviceId, price }` ·
  `{ kind: 'lock' | 'unlock', serviceId }` · `{ kind: 'keep_deposit', orderId, amount }` · `{ kind: 'notify', text }`.
  The hub calls it on every tick and executes the actions (spending actions go to "To sign").
- **AI** (`src/ai.js`, Lapo): functions return JSON only, validated by the caller; the hub exposes them as `/api/ai/*`.
- **Signer** (`src/signer.js`): holds the hubs' seeds (the host's phone). The hub sends `{ id, summary, psbt }`,
  the signer shows the summary, the host approves, the signer returns the signed PSBT.

## Board
| # | Task | Owner | Status |
|---|---|---|---|
| **Core RGB (architecture C)** | | | |
| 1 | `wallet.js` for C: watch-only hub wallet (xpubs + RGB stash) and full wallet for guest/signer; prepare (PSBT) / finish split | Vittorio's Claude | todo |
| 2 | `signer.js`: host signer server, one seed per hub, pending requests, approve = sign, reject | Vittorio's Claude | todo |
| 3 | `hub.js`: services (access / use / rent), orders, payment watcher (asset + amount check), device state, no guest identity stored | Vittorio's Claude | todo |
| 4 | Stay keys: hub issues the key, the transfer to the guest waits for the host's signature | Vittorio's Claude | todo |
| 5 | `guest.js`: the guest's own wallet (localhost), receive, pay, refresh | Vittorio's Claude | todo |
| 6 | Hub routes for AI (`/api/ai/*`) and behaviours tick wired in | Vittorio's Claude | todo |
| 7 | Migrate the demo: hub A and hub B as watch-only, seeds moved to the signer, HUSD and guest funds in place | Vittorio's Claude | todo |
| **Device functions** | | | |
| 8 | `behaviours.js` with the `evaluate()` interface above: stock below, after hour (lock), weekday price, overdue rental (keep deposit), maintenance counter, notify | Alessandro | todo |
| 9 | Supplier wallet (`supplier.js` or a guest-type wallet) receiving restock payments | Alessandro | todo |
| 10 | End-to-end tests against the running hub: door, washing machine, bike (expiry), restock signed and paid | Alessandro | todo |
| 11 | Hub B services (e.g. charging station, laundry) and its setup script | Alessandro | todo |
| 12 | Encrypted backup of the demo wallets (Saturday evening, outside the repo) | Alessandro | todo |
| **Local AI** | | | |
| 13 | Plug-and-play: device descriptor JSON → proposed service + behaviours (stretch: label photo with vision) | Lapo | todo |
| 14 | House documents: contract/rules/manual → proposed behaviours; guest questions answered from the documents (RAG) | Lapo | todo |
| 15 | Host onboarding plan: "create the hub of X with …" → setup plan JSON (services, behaviours), code executes after confirmation | Lapo | todo |
| 16 | Host report: earnings and incidents per device, in plain language | Lapo | later |
| **Interfaces** | | | |
| 17 | Host app: services, add device (plug-and-play), documents, stays (send key), proposals, activity log with explorer links | Vittorio | todo |
| 18 | Signer page (host's phone): pending requests with a readable summary, approve = sign | Vittorio | todo |
| 19 | Guest app: my key, my HUSD, services of the hub (QR link), order → pay → live status, "ask the home" | Vittorio | todo |
| 20 | Device pages: big state, countdown, functions of the device, QR to the guest app | Vittorio | todo |
| **Submission** | | | |
| 21 | Final README: how to run, real vs simulated, third-party tools, prior work (declare the WDK feasibility test and the UI mockup) | Lapo | todo |
| 22 | Questions to mentors: 0-conf unlock, WDK bonus with watch-only hubs, AI on another LAN machine | Lapo | todo |
| 23 | Pitch (5 min), demo script, answers to likely questions | Vittorio + Lapo | todo |
| **Stretch** | | | |
| 24 | Device-to-device payment between hub A and hub B, auto-signed within signer limits | Vittorio's Claude + Alessandro | later |
| 25 | Raspberry/ESP32 device driven by the hub | — | later |

## Notes
- Demo PC (Vittorio): `192.168.7.246`. AI server (Lapo): `http://192.168.6.169:11434`, ~1–2 s per answer.
- Demo rental hour = 1 minute (`HOUR_MS=60000`).
- Never commit `data/`, seeds, keys or `.env`.
