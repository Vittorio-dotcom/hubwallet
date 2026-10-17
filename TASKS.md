# TASKS — team AVL (final, aligned with `docs/PLAN.md` of Saturday midday)

`docs/PLAN.md` is the source of truth for *what* and *how*; this file says *who* and *when*.
Update the status when you start (`doing`) and finish (`done`). `git pull --no-rebase` → small commit → `git push`, every 20–30 min.
Commit prefixes: `hub:` `wallet:` `signer:` `web:` `ai:`. No rebase, no amend, no force-push. Never commit `data/`, seeds, keys, `.env`.
Task numbers 17, 24, 25 and 26 are referenced by the plan: keep them.

## Owners (only the owner edits these files)
| Who | Area | Files |
|---|---|---|
| **Alessandro** | Everything that moves money: wallets, signer, hub, guest, behaviours, scripts, hub B, sweeps, backups, final README | `src/wallet.js` `src/signer.js` `src/hub.js` `src/guest.js` `src/behaviours.js` `scripts/` `README.md` |
| **Lapo** | Local AI (QVAC): service/behaviour/bundle, plug-and-play, house documents; the AI routes inside `hub.js` | `src/ai.js` `prompts/` (+ the `/api/ai/*` block in `hub.js`, agreed with Alessandro) |
| **Vittorio** (with his Claude) | Interfaces: host app with "To sign", guest app, device pages; pitch | `web/` |

## Milestones (plan section 7)
| When | Goal |
|---|---|
| **Sat 15:00** | `WatchWallet` + `signer.js` in the repo; hub A runs watch-only; one key sent through "To sign" |
| **Sat 18:00** | Core real: door (key), washing machine (pay per use), bike (rental + lock), with the pages |
| **Sat evening** | Behaviours engine + restock → supplier (signed); AI host panel wired |
| **Sun 10:00** | Hub B + same guest on both; sweep; plug-and-play from descriptor; one assistant question |
| **Sun 11:00** | **Feature freeze.** Full demo rehearsed; drop what does not work |
| Sun 12:00 | Final README |
| **Sun 13:00** | **Last commit on `main`** |

## Board

### Alessandro — money path (plan sections 1, 2, 4, 5)
| # | Task | Plan | Due | Status |
|---|---|---|---|---|
| 26 | `wallet.js`: `Wallet` (seed, WDK) + `WatchWallet` (xpubs, rgb-sdk) with `prepareSend` / `prepareUtxos` / `finish`; `signer.js` `init` + `watch` | 1, 2.1, 2.4 | Sat 15:00 | todo |
| 1 | `hub.js`: services (access/use/rent), orders, payment watcher, `fulfil`, device state; serves `web/` | 2.5 | Sat 15:00 | todo |
| 2 | "To sign" queue + routes `GET /api/to-sign`, `POST /api/to-sign/:id`, `/reject`, expiry 10 min, one prepared send at a time | 2.3, 6 | Sat 15:00 | todo |
| 3 | Flow B: stay key issued by the hub, sent after signature; door check-in session until `to` | 2.6 B | Sat 15:00 | todo |
| 4 | Flow A: pay per use (washing machine) | 2.6 A | Sat 18:00 | todo |
| 5 | Flow C: rental (bike), lock when time is up | 2.6 C | Sat 18:00 | todo |
| 6 | `guest.js` (guest, and supplier with `WALLET=supplier`) | 1 | Sat 18:00 | todo |
| 7 | `scripts/` demo setup: signer init, funding, UTXOs via signer, HUSD, guest funds | 2.9 | Sat 18:00 | todo |
| 8 | `behaviours.js`: `evaluate(event, state)`, triggers and actions, `effectivePrice`, `lastTriggered` | 4 | Sat evening | todo |
| 9 | Flow D: restock → supplier, approved = signed | 2.6 D | Sat evening | todo |
| 10 | Flow E: sweep earnings to the host's personal wallet | 2.6 E | Sun 10:00 | todo |
| 11 | Hub B ("Cortile", :8081), same guest uses both | 5 | Sun 10:00 | todo |
| 24 | Privacy: no guest name stored (optional label or nothing) | 2.8 | Sat evening | todo |
| 25 | Encrypted backup of hub stashes and signer seeds, outside the repo | 2.8 | Sat evening | todo |
| 12 | Final README: how to run, real vs simulated, third-party tools, prior work (WDK feasibility test, UI mockup) | 7 | Sun 12:00 | todo |

### Lapo — local AI (plan section 3)
| # | Task | Plan | Due | Status |
|---|---|---|---|---|
| 13 | QVAC server + `src/ai.js`: text → service, behaviour, bundle | 3c | — | done |
| 14 | `/api/ai/*` routes in `hub.js` (service, behaviour: owner; bundle: public), agreed with Alessandro | 6 | Sat evening | todo |
| 15 | Plug-and-play: device descriptor → proposed service + behaviours | 3a | Sun 10:00 | doing |
| 16 | House documents: contract → proposed behaviours; guest questions answered from the documents (RAG) | 3b | Sun 10:00 | todo |
| 17 | Questions to mentors: QVAC on another LAN machine counts as on-device? WDK bonus with watch-only hubs? 0-conf unlock? | 0-bis | Sat 15:00 | doing |
| 18 | Decide where QVAC runs in the demo (demo PC or Lapo's GPU PC) and measure answer time there | 0-bis | Sat 18:00 | todo |

### Vittorio — interfaces (pages call the HTTP API of plan section 6 and `CLAUDE.md`)
| # | Task | Plan | Due | Status |
|---|---|---|---|---|
| 19 | Host app: services, stays (send key → goes to "To sign"), proposals inbox, earnings, activity log with explorer links | 2.6, 6 | Sat 18:00 | todo |
| 20 | "To sign" view in the host app: pending items with summary, approve / reject (the signer signs) | 2.3 | Sat 18:00 | todo |
| 21 | Guest app (rebuild): my key, my HUSD, services of the hub (QR link), order → pay → live status | 2.6 A–C | Sat 18:00 | todo |
| 22 | Device pages: big state, countdown, device functions with `lastTriggered`, QR to the guest app | 4 | Sat evening | todo |
| 23 | Host AI panel: create services/behaviours by text, add a device by descriptor, upload documents | 3 | Sun 10:00 | todo |
| 27 | "Ask the home" box in the guest app (calls `/api/ai/bundle`) | 3 | Sun 10:00 | todo |

### Everyone
| # | Task | Who | Due | Status |
|---|---|---|---|---|
| 28 | Choose the demo PC (Vittorio's Linux or Alessandro's Mac) and rehearse the full demo there | all | Sun 11:00 | todo |
| 29 | Pitch (5 min), demo script, answers to likely questions | Vittorio + Lapo | Sun 12:00 | todo |

### Stretch (only after the Sunday 10:00 milestone)
| # | Task | Who | Status |
|---|---|---|---|
| 30 | Device-to-device payment hub A → hub B, auto-signed within signer limits | Alessandro | later |
| 31 | Plug-and-play from a photo of the device label (vision) | Lapo | later |
| 32 | Host report: earnings and incidents per device | Lapo | later |
| 33 | Raspberry/ESP32 device driven by the hub | — | later |

## Notes
- **For Alessandro (from the guest app, web/guest.js):** the app sends a stay key only to the hub whose `name` the key's asset name starts with, so please name stay keys `"<HUB_NAME> stay <from>-<to>"`. Defence in depth for later: let the guest wallet (`/api/pay`) refuse invoices from hubs the guest has not confirmed. The name match is weak (a hub can claim any name): the robust fix is to record the issuing hub's identity when the key is received (e.g. the hub's xpub/fingerprint or URL stored by `guest.js` with the key) and send the key back only to that hub.
- Demo PC (Vittorio, Linux): `192.168.7.246`. AI server (Lapo, GPU): `http://192.168.6.169:11434`, ~1–2 s per answer.
- Demo rental hour = 1 minute (`HOUR_MS=60000`).
- Work against stubs while the other parts are not ready: fake JSON for the pages, a fixed answer instead of QVAC.
