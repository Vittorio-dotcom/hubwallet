# HubWallet — project guide for Claude Code (team AVL)

Three people work on this repo, each with their own Claude Code on their own PC.
The repo is the only shared channel: read this file and `TASKS.md` before starting,
update `TASKS.md` when you start or finish a task. Talk to the humans in Italian.

## What we build
Hubs, one per owner, each with its own self-custodial RGB wallet (Tether WDK + UTEXO
`wdk-wallet-rgb`). A hub sells or rents services from its devices:
- **access**: an RGB token (one per stay) the guest hands to the device (door);
- **use**: pay per use in our test dollar HUSD (washing machine);
- **rent**: pay for N hours, the hub locks the device when time is up (bike).
Services can have **behaviours** ("if fewer than 3 beers, propose a restock").
The owner describes services and behaviours in plain language; a **local AI (QVAC)**
turns them into JSON. The AI never moves money: code executes, the owner approves spending.

## Scope decided on Saturday 17 October (team)
- **Two hubs** (hub A "Casa Rossi", hub B), each with **its own WDK wallet**. The host connects devices to each hub.
- **The guest has their own wallet** and uses the services of both hubs with the same wallet.
- **Devices can have a function (behaviour)** attached: rules like "if stock < 3 propose a restock", "weekend price +20%", "rental overdue → keep deposit", "notify".
- **AI only on the hub** (decided 17 Oct, later): the guest-side AI was decorative and is dropped. The hub's AI does
  host onboarding ("create the hub of Casa Rossi with a door, a washing machine and a bike"), services and
  behaviours from plain language, spending proposals, and ~~a public assistant API for guests~~ **(dropped Sat 17 Oct: no AI on the guest side; the guest taps and pays)**
  (`POST /api/ai/bundle {text}` → `[{ serviceId, hours? }]`). The guest app stays simple and calls that API.
- **One wallet per hub** (not per host): properties are not linked on-chain and a compromised hub does not expose the
  others. Later: one host seed with one account per hub; a watch-only hub that can receive but not spend, with the host
  signing spending from their phone.
- The hub stores no guest identity: only services, orders, payments and device state.
- ⚠️ **The AI never generates keys or seeds.** Wallets are created by code (WDK, `bip39.generateMnemonic`, crypto RNG). The AI only understands the request and proposes the setup; code executes it; the human confirms.

## Architecture
Full plan: `docs/PLAN.md` (wallets, AI roles, device functions, RGB, priorities).

```
web/ (browser pages)  ──HTTP──▶  src/hub.js   (hub server: API + WDK wallet + rules + device state)
                                 src/guest.js (guest server: the guest's own WDK wallet, localhost only)
                                 src/wallet.js (WDK wrapper, one wallet per hub/guest, data/<name>/)
                                 src/ai.js     (QVAC calls, OpenAI-compatible server on the AI PC)
Money never goes through the HTTP API: it moves wallet to wallet over RGB
(invoice → consignment via the RGB proxy → Bitcoin tx on Mutinynet).
```
Network: Mutinynet opened as rgb-lib `signet`; indexer `https://esplora.signet.kaleidoswap.com`,
proxy `rpcs://proxy.kaleidoswap.com/json-rpc`. Explorer `https://mutinynet.com/tx/<txid>`.
Node **22.x** only (WDK does not build on Node 24). Linux x86_64, glibc ≥ 2.38.

## Run (demo PC)
```bash
npm install
HUB_NAME="Casa Rossi" PORT=8080 WALLET=hub-a npm run hub     # owner key printed, stored in data/hub-a/owner-key.txt
PORT=8090 WALLET=guest-marta npm run guest                   # localhost only
```
Pages are served by both servers from `web/`. Env: `HOUR_MS` (rental hour length, demo 60000),
`USE_MS` (pay-per-use run time), `POLL_MS` (payment check interval), `QVAC_URL` (AI server).

## Hub API (contract — change it only together with TASKS.md + a note here)

> ⚠️ **Architecture C payment layer is in: see `API_usage.md`** (hub-core routes `/api/payments`, `/api/to-sign`, `/api/transfers`, payer wallet `/api/check` + `/api/pay-request`). The service routes below (`/api/services`, `/api/orders`) are from the removed first version: the service layer rebuilds them on top of `hub-core` (example in `API_usage.md` §5).
Amounts are integers in **HUSD cents** (precision 2). Owner routes need header `X-Hub-Key`.

Public (guests):
- `GET /api/services` → `{ name, dollar, services: [{ id, name, icon, type, price, unit, maxHours, behaviours, device: { state, until } }] }`
- `POST /api/services/:id/order` body `{ hours? , stayAssetId? }` → `{ id, serviceId, assetId, amount, hours, invoice, recipientId, status }`
  - access: `stayAssetId` = the guest's key asset id, amount 1. use/rent: HUSD, `price × hours`.
- `GET /api/orders/:id` → order + `service`. `status`: `waiting` → `WaitingCounterparty` → `WaitingConfirmations` → `paid` (or `failed`, `underpaid`).
- `device.state`: access `locked|open`, use `idle|running`, rent `idle|rented`; `until` = ms timestamp.

Owner (X-Hub-Key):
- `GET /api/hub` → name, address, btc, assets, services (with `earned`), stays, orders, inbox, log
- `POST /api/services` body = service JSON (as above, `price` in cents)
- `POST /api/stays` body `{ guest, from, to, invoice }` → issues a key (NIA, qty 1) and sends it to the guest invoice
- `POST /api/admin/utxos|issue-dollar|send|send-btc|poll` (demo setup)
- AI (to be added by src/ai.js owner): `POST /api/ai/service {text}` → service JSON; `POST /api/ai/behaviour {text}`; public `POST /api/ai/bundle {text}` → `[{ serviceId, hours? }]`

Guest server (localhost):
- `GET /api/me` → `{ address, btc, assets }` · `POST /api/receive {amount}` → `{ invoice, recipientId }` (any asset)
- `POST /api/pay {invoice, assetId, amount}` → `{ txid, link }` · `POST /api/refresh` · `GET /api/transfers`

## AI contract (src/ai.js)
QVAC via its OpenAI-compatible server (`qvac serve --openai`), model Qwen3.5 2B Q4.
Structured output with JSON schema and **`reasoning_budget: false`** (`/no_think` gives HTTP 500).
The model only fills JSON; code validates every field, computes every number, and asks a human before spending.
Requests take tens of seconds on a laptop: use the model only where it adds value, show a clear "thinking" state.

**AI server (Lapo's PC, RTX GPU):** `QVAC_URL=http://192.168.6.169:11434`, model `qwen3.5-2b`; Bearer key in env
`QVAC_API_KEY` (shared on Telegram, never in the repo). Measured: ~1–2.5 s per answer (first one after start ~7 s).
Serve config: `prompts/qvac.config.json` → `npx qvac serve --openai --host 0.0.0.0 --api-key-file <file>`.
Test without the hub: `node src/ai.js device|edit|rule|service|rules "<descriptor JSON, text or document path>"` (`edit` changes the demo washing machine).

Functions in `src/ai.js` (all `async`, host side only, throw `Error` with a message to show the host). Device format = `docs/HOST-APP.md` §2:
`{ id, name, icon, type: use|rent|access, price (HUSD cents), unit, commands, rules: [{ when: { kind, value }, do: { kind, ... } }], version }`
- `when.kind`: `after_hour` (0–23) · `weekday` (`['sat','sun']`) · `stock_below` (N) · `counter_at` (every N uses) · `overdue` (hours late)
- `do.kind`: `lock` · `unlock` · `set_price { price }` (cents; "+20%" is computed by the code from the device price) · `notify { text }` · `propose_purchase { reason }` · `keep_deposit { amount? }`
- `deviceToService(descriptor)` → a device config (version 1) with a suggested price and 0–3 rules (plug-and-play, `POST /api/devices`). lock/unlock rules only if the device has those commands; doors get no rules.
- `editDevice(text, currentConfig)` → `{ proposed }` or `{ reply }` (asks when a price, percentage or hour is missing: hours and percentages are accepted only if written; the sign of a percentage comes from the words "alza/raise" vs "sconto/lower") → the proposed config (`POST /api/devices/:id/edit`). The model returns only the changes (new name, new price or %, rules to add, rule numbers to remove); the code applies them, so `id`, `commands` and `version` never change (the hub increments `version` on Apply). Throws "I did not understand what to change…" if nothing changes.
- `textToRule(text, device)` → `{ when, do, text }` · `textToService(text)` → a device config from a sentence ("dryer, 2 dollars a cycle").
- `documentToRules(text, devices)` → `[{ deviceId, when, do, text }]` (house rules / manual → rules the devices can apply; demo documents in `prompts/documents/`).
- Money guard: a price, deposit or amount from the model is kept only if that number is written in the host's text; percentages are computed by the code; "free"/"gratis" without numbers = 0.

Device layer (#34) usage, e.g. in the routes of `docs/HOST-APP.md` §4:
```js
import { deviceToService, editDevice } from './ai.js'
r.post('/devices', owner, wrap(async (req) => ({ proposed: await deviceToService(req.body?.descriptor) })))
r.post('/devices/:id/edit', owner, wrap(async (req) => { const current = loadDevice(req.params.id); const proposed = await editDevice(req.body?.text, current); return { proposed, diff: diff(current, proposed) } }))
```
Measured on the AI PC: edit ~1.3–3.5 s, plug-and-play ~2.5–5 s, document → rules ~10 s.

## Device layer (src/devices.js, task 34 — server side by Lapo)
Mounted in `src/hub.js` before the payment routes. Never touches the wallet: only `hub.requestPayment()` and `hub.on('paid')`.
Env: `DOLLAR_ASSET` (rgb:… id of HUSD, required to sell; never a ticker) · `USE_MS` (one use runs, demo 45000) · `HOUR_MS` (rental hour) ·
`DEMO_DEVICES=1` (an empty hub starts with washer 3.00 + dryer 2.00) · `QVAC_URL`, `QVAC_API_KEY` (AI). Files: `data/<hub>/devices/<id>.json` (+ `<id>.v<n>.json`), `devices-state.json`.
Owner (`X-Hub-Key`): `GET /api/devices` → `[config + { state: { status: idle|running|locked, until? }, earned, uses, basePrice, lastTriggered }]` ·
`POST /api/devices/chat { messages: [{ role: host|ai, text }] }` → `{ reply, proposed? }` · `POST /api/devices { config }` → saved (v1) ·
`POST /api/devices/:id/edit { text, messages? }` → `{ proposed, diff: [{ field, from?, to? }] }` or `{ reply }` when the AI needs a missing value (`text` = all host requests since the last apply) ·
`POST /api/devices/documents { text }` → `[{ deviceId, rule: { when, do }, text }]` (house rules → proposed rules, not saved; add the chosen ones to the device and `/apply`) · `POST /api/devices/:id/apply { config }` → saved (version+1) ·
`POST /api/devices/:id/rollback { version }` · `DELETE /api/devices/:id` · `GET /api/devices/notices` (counter rules: maintenance, notify) ·
`POST /api/devices/clock { hour: 0–23 | null }` (demo: pretend it is that hour, to show "locked after 22:00").
Public: `GET /api/services` → `{ name, dollar, dollarId, services: [{ id, name, icon, type, price (now, incl. weekday price rules), unit, rules, state }] }` ·
`POST /api/services/:id/order { hours? }` → `{ id (= payment id), serviceId, assetId, amount, hours, invoice, recipientId, status }` (price from the device file incl. weekday and hour-band rules — `after_hour H → set_price` holds from H to the next band or midnight —,
refused if running or locked) · `GET /api/orders/:id` → public payment + `serviceId` + `service`. On `paid`: device `running` for `USE_MS`, earned/uses updated.

## Rules (from the organisers — breaking them costs points)
- **No force-push, no rebase, no amend, on any branch.** Use `git pull --no-rebase`, small commits, push often.
- **Never commit** seeds, `data/`, keys, `.env`. The owner key is shared on Telegram, never in the repo.
- Every transfer shown in the demo must be real (Mutinynet). Devices may be simulated web pages; say so.
- Work only in the folders you own (see TASKS.md) to avoid conflicts. Shared files (this file, TASKS.md,
  README.md, package.json): pull first, edit a small part, push right away.
- Commit messages in English; end them with a `Co-Authored-By` line if Claude wrote the change.

## Known traps (from our pre-hackathon feasibility test)
- A wallet that never saw an asset must create an invoice **without** assetId.
- Paying a witness invoice (`wvout`) needs `witnessData: { amountSat: 1000 }` (handled in wallet.js).
- Send = sendBegin → signPsbt → sendEnd (handled in wallet.js). Refresh both wallets after sending.
- Issuing needs colorable UTXOs (`/api/admin/utxos`) and ~1 block.
- rgb-lib is not concurrent: wallet.js serialises calls; keep it that way.
