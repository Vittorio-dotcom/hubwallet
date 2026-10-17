# TASKS — team AVL (final, aligned with `docs/PLAN.md` of Saturday midday)

`docs/PLAN.md` is the source of truth for *what* and *how*; this file says *who* and *when*.
Update the status when you start (`doing`) and finish (`done`). `git pull --no-rebase` → small commit → `git push`, every 20–30 min.
Commit prefixes: `hub:` `wallet:` `signer:` `web:` `ai:`. No rebase, no amend, no force-push. Never commit `data/`, seeds, keys, `.env`.
Task numbers 17, 24, 25 and 26 are referenced by the plan: keep them.

## ★ Demo scope (Saturday afternoon)
Laundry hub with washing machine + dryer (pay per use). No door/keys/bike/minibar. Order of work:
1. real payment guest → hub → host (the guest taps the device and pays; **no AI on the guest side**, decided Sat 17 Oct) · 2. device rules · 3. second host.
The local AI is used by the **host** only: add a device (plug-and-play) and "Describe changes" on a device (docs/HOST-APP.md §3).
Tasks about stay keys and the door (3, part of 19) and the bike (5) are **dropped for the demo**.

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
| 26 | `wallet.js`: `Wallet` (seed, WDK) + `WatchWallet` (xpubs, rgb-sdk) with `prepareSend` / `prepareUtxos` / `finish`; `signer.js` `init` + `watch` | 1, 2.1, 2.4 | Sat 15:00 | done (offline-tested; signer signs through WDK; Mutinynet test next) |
| 1 | `hub.js`: services (access/use/rent), orders, payment watcher, `fulfil`, device state; serves `web/` | 2.5 | Sat 15:00 | doing (payment layer done in `src/hub-core.js`, see `API_usage.md`; services layer on top still to do) |
| 2 | "To sign" queue + routes `GET /api/to-sign`, `POST /api/to-sign/:id`, `/reject`, expiry 10 min, one prepared send at a time | 2.3, 6 | Sat 15:00 | done (offline-tested) |
| 3 | Flow B: stay key issued by the hub, sent after signature; door check-in session until `to` | 2.6 B | — | dropped for the demo |
| 4 | Flow A: pay per use (washing machine) | 2.6 A | Sat 18:00 | todo |
| 5 | Flow C: rental (bike), lock when time is up | 2.6 C | — | dropped for the demo |
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
| 14 | `/api/ai/*` routes in `hub.js` (service, behaviour: owner; bundle: public), agreed with Alessandro | 6 | Sat evening | dropped (the AI is called by the device routes of #34: POST /api/devices, POST /api/devices/:id/edit) |
| 15 | Plug-and-play: device descriptor → proposed service + behaviours | 3a | Sun 10:00 | done (`deviceToService`, contract in CLAUDE.md; route /api/ai/device in #14) |
| 16 | House documents: contract → proposed behaviours; guest questions answered from the documents (RAG) | 3b | Sun 10:00 | done (`documentToBehaviours`, `answerFromDocuments`; demo docs in prompts/documents/; routes in #14) |
| 17 | Questions to mentors: QVAC on another LAN machine counts as on-device? WDK bonus with watch-only hubs? 0-conf unlock? | 0-bis | Sat 15:00 | done (answers in Notes) |
| 18 | Decide where QVAC runs in the demo (demo PC or Lapo's GPU PC) and measure answer time there | 0-bis | Sat 18:00 | done (Lapo's GPU PC, mentor OK; ~1–5 s per answer) |

### Vittorio — interfaces (pages call the HTTP API of plan section 6 and `CLAUDE.md`)
| # | Task | Plan | Due | Status |
|---|---|---|---|---|
| 19 | Host app (docs/HOST-APP.md): wallet cards, hubs with earnings + sweep, To sign, devices, add device, edit by text with diff + Apply | 2.6, 6 | Sat 18:00 | done on example data; next: wire to the real routes |
| 20 | "To sign" view in the host app: pending items with summary, approve / reject (the signer signs) | 2.3 | Sat 18:00 | todo |
| 21 | Guest app (rebuild): wallet cards (swipe, connect wallet), hub search, devices, pay → live status | 2.6 A | Sat 18:00 | done on example data; next: pay with `/api/check` + `/api/pay-request` (API_usage.md §4) |
| 22 | Device pages: big state, countdown, device functions with `lastTriggered`, QR to the guest app | 4 | Sat evening | todo |
| 23 | Host AI panel: create services/behaviours by text, add a device by descriptor, upload documents | 3 | Sun 10:00 | todo |
| 27 | "Ask the home" box in the guest app (calls `/api/ai/bundle`) | 3 | Sun 10:00 | dropped (no AI on the guest side) |

### Everyone
| # | Task | Who | Due | Status |
|---|---|---|---|---|
| 28 | Choose the demo PC (Vittorio's Linux or Alessandro's Mac) and rehearse the full demo there | all | Sun 11:00 | todo |
| 29 | Pitch (5 min), demo script, answers to likely questions | Vittorio + Lapo | Sun 12:00 | todo |

### Device layer (from docs/HOST-APP.md — please confirm)
| # | Task | Who | Due | Status |
|---|---|---|---|---|
| 34 | Device/service layer on top of hub-core: one JSON per device in `data/<hub>/devices/` with versions, validation, routes `/api/devices` (list, add, edit → proposed + diff, apply, rollback) and public `/api/services` + `/api/services/:id/order` via `requestPayment`; `paid` → device `running` | Alessandro (or who he agrees) | Sat 18:00 | proposed |
| 35 | AI: `editDevice(text, currentJson)` → proposed device JSON, and `deviceToService(descriptor)` in the same format (HOST-APP.md §2) | Lapo | Sat evening | doing (format of HOST-APP.md §2 confirmed by Lapo) |

### Stretch (only after the Sunday 10:00 milestone)
| # | Task | Who | Status |
|---|---|---|---|
| 30 | Device-to-device payment hub A → hub B, auto-signed within signer limits | Alessandro | later |
| 31 | Plug-and-play from a photo of the device label (vision) | Lapo | later |
| 32 | Host report: earnings and incidents per device | Lapo | later |
| 33 | Raspberry/ESP32 device driven by the hub | — | later |

## Notes
- **For Alessandro (guest wallet service):** the guest app can hold several wallets (each a `guest.js` on its own port) and calls them from the page. A wallet on another port is cross-origin: `guest.js` needs CORS, but since `/api/pay` spends, allow only local origins (e.g. `http://127.0.0.1:*`, `http://localhost:*`), never `*`.
- **For Alessandro (behaviours.js):** the AI can now also emit the trigger `use_count` (value = every N uses, e.g. "every 50 washes propose maintenance", demo step 2). Please support it next to `stock_below`/`weekday`/`overdue`/`after_hour`. Demo phrase for the AI bundle: "un lavaggio e poi l'asciugatrice" (~1 s, always washer + dryer).
- **Mentor answers (Sat 17 Oct):** (1) QVAC on another machine of the local network counts as on-device: yes, say it clearly in the pitch. (2) Watch-only hub with every signature through WDK already counts for the WDK bonus. (3) 0-conf door unlock: being handled by Lapo + Vittorio while reworking the demo devices. (4) Our own test dollar HUSD on signet instead of the event USDT: fine for the RGB score. (5) RAG: no recommendation from the mentors; we keep the simple approach (short documents go whole into the prompt, long ones cut to the paragraphs sharing words with the question): no extra embedding model, ~1.5 s per answer.
- **For Alessandro (laundry demo):** "Ask the laundry" pays the proposed devices one after the other (the guest's HUSD sit on one UTXO, busy until the first transfer settles: ~1 min each). If you add `POST /api/bundle/order { items: [{ serviceId }] }` → one invoice for the total, the page can pay a wash + dryer with a single transfer.
- **For Alessandro (from the guest app, web/guest.js):** the app sends a stay key only to the hub whose `name` the key's asset name starts with, so please name stay keys `"<HUB_NAME> stay <from>-<to>"`. Defence in depth for later: let the guest wallet (`/api/pay`) refuse invoices from hubs the guest has not confirmed. The name match is weak (a hub can claim any name): the robust fix is to record the issuing hub's identity when the key is received (e.g. the hub's xpub/fingerprint or URL stored by `guest.js` with the key) and send the key back only to that hub.
- Demo PC (Vittorio, Linux): `192.168.7.246`. AI server (Lapo, GPU): `http://192.168.6.169:11434`, ~1–2 s per answer.
- Demo rental hour = 1 minute (`HOUR_MS=60000`).
- Work against stubs while the other parts are not ready: fake JSON for the pages, a fixed answer instead of QVAC.
