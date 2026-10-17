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
  behaviours from plain language, spending proposals, and a **public assistant API for guests**
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

> ⚠️ **Being rewritten for architecture C** (TASKS.md #1–7). The routes below describe the removed first version and will be replaced by Vittorio's Claude as the new hub is built. Build against the new section once it appears.
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
Test without the hub: `node src/ai.js service|behaviour|bundle|device "<text or descriptor JSON>"` (`HUB_URL=...` to use a hub's services).

Functions (all `async`, throw `Error` with a message to show the user):
- `textToService(text)` → `{ name, icon, type: access|use|rent, price (cents, per hour for rent; 0 for access), unit: use|hour, maxHours? }`
- `textToBehaviour(text, services)` → `{ serviceId, trigger: { kind, value }, action: { kind, ... }, text }`
  - trigger: `stock_below` value = items left · `weekday` value = `['sat','sun']` (mon..sun) · `overdue` value = hours late · `after_hour` value = 0–23
  - action (same names as `behaviours.js`): `propose_purchase { item, quantity?, maxAmount? (cents) }` · `change_price { percent }` (+20, -10) ·
    `notify { message }` · `lock {}` · `unlock {}` · `keep_deposit { amount? (cents; absent = whole deposit) }`
  - money guard: `maxAmount` / `amount` are kept only if that number is written in the host's text
- `textToBundle(text, services)` → `[{ serviceId, hours? }]` (only ids from `services`, no access services, hours clamped to `maxHours`)
- `deviceToService(descriptor)` (plug-and-play; descriptor = any JSON object or string: name, type, commands, sensors…) →
  `{ service: <as textToService, with a suggested price>, behaviours: [{ trigger, action, text }] }` (0–3 rules, no `serviceId`:
  the hub adds it after creating the service; no timed lock/unlock on access services)

Hub routes (for `src/hub.js`):
```js
import { textToService, textToBehaviour, textToBundle, deviceToService } from './ai.js'
app.post('/api/ai/service', owner, wrap(async (req, res) => res.json(await textToService(req.body?.text))))
app.post('/api/ai/behaviour', owner, wrap(async (req, res) => res.json(await textToBehaviour(req.body?.text, state.services))))
app.post('/api/ai/device', owner, wrap(async (req, res) => res.json(await deviceToService(req.body?.descriptor))))
app.post('/api/ai/bundle', wrap(async (req, res) => res.json(await textToBundle(req.body?.text, state.services))))
```
The routes only return a proposal; the page shows it and the human confirms (e.g. `POST /api/services` with the JSON).

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
