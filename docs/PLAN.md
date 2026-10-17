# HubWallet — implementation plan (agreed Saturday 17 October, updated Saturday midday)

## What it is
HubWallet lets anyone who offers a service **connect their devices to a physical hub**, and lets users **use them by paying with RGB assets on Bitcoin**: access keys, pay-per-use, time-based rentals. No platform in the middle: money moves wallet to wallet, data stays in the home.

**One sentence for the judges:** the hub has the eyes, the owner has the key. The hub sees and receives payments, but it cannot spend. Every payment lands directly on UTXOs that only the owner's key can spend.

---

## ★ Demo scope (decided Saturday afternoon — overrides the examples below)
- **One hub: a laundry** ("Lavanderia"), with **two devices: washing machine and dryer**, both pay-per-use (template `use`).
- **No door, no stay keys, no bike, no minibar** in the demo. Those flows stay in the plan as product examples only.
- **Step 1 (must work):** a real payment **guest → hub → host**, through the hub and the **local model**: the guest asks
  in plain language (e.g. "a wash and then the dryer"), the hub's AI proposes the bundle, code computes the total, the guest
  pays from their own wallet, the hub sees it and starts the device. All real on Mutinynet.
- **Step 2:** rules on the devices (behaviours), e.g. "after 22:00 lock the washing machine", "every 50 washes propose maintenance".
- **Step 3:** a second host/hub.

## 0. Team split (who owns what)

| Who | Area | Files (only the owner edits them) |
|---|---|---|
| **Alessandro** | **Low-level hub: everything that moves money.** Wallets (watch-only hub, host signer, guest), RGB flows, signing queue, payment watcher, behaviours engine, hub B, sweeps, backups, final README | `src/wallet.js`, `src/signer.js`, `src/hub.js`, `src/guest.js`, `src/behaviours.js`, `scripts/` |
| **Lapo** | **Local AI (QVAC)** on the most powerful PC: text → service/behaviour/bundle, plug-and-play, house documents (RAG) | `src/ai.js`, `prompts/` |
| **Vittorio** | **Interfaces**: host app (with "To sign"), guest app, device pages. His PC runs the demo hubs and wallets | `web/` |

Handover: Vittorio's Claude verified the prepare/sign split on Saturday morning (section 1). From now on Alessandro owns that code (task 26).

Contracts between the three parts:
- **Hub HTTP API** (section 6): Alessandro writes it, Vittorio's pages call it. Change it only with a note in `CLAUDE.md`.
- **AI contract** (`CLAUDE.md` → "AI contract"): Lapo writes the functions, Alessandro wires the routes in `hub.js`.
- Each person can work against a stub of the others' parts: fake JSON for the pages, a fixed answer instead of QVAC.

Git (organisers' rules): `git pull --no-rebase` → small commit → `git push`, every 20–30 minutes. No rebase, no amend, no force-push. Prefix commit messages with the area: `hub:`, `wallet:`, `signer:`, `web:`, `ai:`. Shared files (`CLAUDE.md`, `TASKS.md`, `README.md`, `package.json`, this file): pull, edit a small part, push right away.

Code style: **every file starts with a header comment** (what it is, where it runs, how to start it), and every function and every non-obvious step is commented, especially RGB, PSBT and signing. Judges and teammates must be able to read the money path without asking.

---

## 0-bis. Files, where they run, who runs them

### What each file does
| File | Kind | What it does | Owner |
|---|---|---|---|
| `src/wallet.js` | library (not started on its own) | Wraps the RGB wallets. `Wallet` = full wallet with a seed (WDK): guest, supplier, host personal wallet. `WatchWallet` = hub wallet with xpubs only (rgb-sdk): invoices, receive, prepare unsigned PSBTs. One serial queue per wallet. Data in `data/<name>/` | Alessandro |
| `src/hub.js` | **server** (Express) | The hub: services, orders (invoices), payment watcher, device state, "To sign" queue, stays, sweeps; serves `web/` and the AI routes. Holds **no seed** | Alessandro (AI routes: Lapo) |
| `src/behaviours.js` | library, inside `hub.js` | Rules engine: triggers → actions; spending actions become proposals for the host | Alessandro |
| `src/signer.js` | **CLI / small server** | The host's "phone": holds the hubs' seeds and the host's personal wallet; `init` creates a hub's keys, `watch` lists "To sign", the host approves, it signs and posts the signature back | Alessandro |
| `src/guest.js` | **server**, localhost only | The guest's wallet (stands in for a phone wallet app): balance, receive invoice, pay an invoice. It can spend, so it listens only on 127.0.0.1 | Alessandro |
| `src/ai.js` | library inside `hub.js` + CLI for tests | Calls the QVAC server (OpenAI-compatible) and returns validated JSON: service, behaviour, bundle | Lapo |
| `prompts/*` | config | System prompts and QVAC serve config | Lapo |
| `web/*.html`, `web/*.js` | **browser** code | Host app, guest app, device pages. Served by `hub.js` (host + device pages) and `guest.js` (guest page); they only call HTTP APIs, never hold keys | Vittorio |
| `scripts/*` | one-off CLI | Demo setup: create keys, fund, UTXOs, issue HUSD, fund the guest | Alessandro |

### How they connect
```
 HOST'S PHONE (product) / process (demo)      THE HUB (product: a box)                            AI (QVAC)
┌───────────────────────────────┐   HTTP    ┌──────────────────────────────────────────┐  HTTP   ┌──────────────────┐
│ src/signer.js                 │◄─────────►│ src/hub.js  hub A :8080 / hub B :8081    │────────►│ qvac serve       │
│  data/signer/hub-a.seed       │ "To sign" │  ├ src/wallet.js  WatchWallet (xpubs)    │  JSON   │  --openai :11434 │
│  data/signer/hub-b.seed       │  PSBTs    │  ├ src/behaviours.js                     │         │  Qwen3.5 2B      │
│  data/signer/personal/ (WDK)  │           │  ├ src/ai.js ───────────────────────────────────►│                  │
│ supplier: src/guest.js        │           │  └ serves web/: host app, device pages   │         └──────────────────┘
│  WALLET=supplier :8091        │           │  data/hub-a/  hub-keys.json + RGB stash  │
└───────────────────────────────┘           └───────────▲──────────────────────────────┘
                                                        │ HTTP: services, orders (invoices)
                                          ┌─────────────┴──────────────┐      browsers: host app (any device with the
 GUEST'S PHONE (product)                  │ src/guest.js  :8090        │      owner key), device pages (tablets/phones)
                                          │  WALLET=guest-marta (WDK)  │
                                          │  serves web/guest.html     │
                                          └─────────────┬──────────────┘
                     every wallet ──────────────────────▼──────────────────────
                     Esplora (esplora.signet.kaleidoswap.com)  +  RGB proxy (proxy.kaleidoswap.com)  →  Mutinynet
```
Money never travels over our HTTP APIs: HTTP carries invoices, PSBTs and states. Assets move wallet to wallet through the RGB proxy and Bitcoin transactions.

### Who runs what (demo, Sunday)
The demo can run on **one PC** with every process started side by side. What keeps the roles apart is that each process has **its own port and its own data folder** (`data/<name>/`), so no process can read another one's keys. In the product each process becomes a separate device (hub box, host's phone, guest's phone). The diagram above shows that target layout.

| Process | Command (example) | Port | Data folder | Plays the role of |
|---|---|---|---|---|
| Hub A | `HUB_NAME="Casa Rossi" PORT=8080 WALLET=hub-a npm run hub` | 8080 | `data/hub-a/` (xpubs + stash, **no seed**) | the hub box |
| Hub B | `HUB_NAME="Cortile" PORT=8081 WALLET=hub-b npm run hub` | 8081 | `data/hub-b/` | the neighbour's hub |
| Host signer | `node src/signer.js watch http://localhost:8080 http://localhost:8081` | — (terminal) | `data/signer/` (hubs' seeds + host personal wallet) | the host's phone |
| Guest | `PORT=8090 WALLET=guest-marta npm run guest` | 8090 | `data/guest-marta/` | the guest's phone |
| Supplier | `PORT=8091 WALLET=supplier npm run guest` | 8091 | `data/supplier/` | the restock supplier |
| QVAC | `npx qvac serve --openai` (on the demo PC, or on Lapo's PC if the demo PC is too slow) | 11434 | — | the hub's local AI |

Browser tabs on the same PC: host app and device pages from `:8080`/`:8081`, guest page from `:8090`. Device pages can also be opened on a phone or tablet on the venue network for a better effect, but this is optional.
Which PC runs the demo is to be decided (Vittorio's Linux or Alessandro's Mac: both work). Rehearse on that PC.
For the judges: the signer is a separate process with its own data. The hub's folder contains no seed (show it), and every spend waits for the signer.
Honest note: if QVAC runs on Lapo's PC on the local network (GPU), say so; in the product it runs inside the hub. Ask a mentor whether this counts as on-device (task 17).

### During development
Everyone runs their own copies with their own test wallets (`WALLET=hub-dev`, `WALLET=guest-dev`, own faucet funds). The demo wallets live only on the demo machines and are never copied. `data/` is in `.gitignore`.

---

## 1. Wallets: three roles, two kinds of keys

| Wallet | Lives on | Holds | Library | Does |
|---|---|---|---|---|
| **Guest** | guest's phone (demo: `src/guest.js` on a PC) | seed + their assets | **WDK** (`wdk-wallet-rgb`, `WalletManagerRgb`) | receives keys, pays invoices, **signs** its own payments |
| **Host signer** | host's phone (demo: `src/signer.js`) | **the hubs' seeds** + the host's personal wallet | **WDK** / `rgb-sdk` `signPsbt` | **signs** anything a hub wants to spend; receives swept earnings |
| **Hub (watch-only)** | the physical hub | **xpubs + master fingerprint + RGB stash, no seed** | `rgb-sdk` `WalletManager` without `mnemonic` | creates invoices, receives and validates payments, **prepares** transactions for the host to sign |
| Supplier | a third wallet (demo: `src/guest.js` with `WALLET=supplier`) | seed | WDK | receives restock payments |

- **Private key (seed)** = the key to the safe: it can sign, so it can spend. Only the guest and the host signer have one.
- **xpub** = the account number plus a read-only statement: it can derive addresses, see balances and receive. The hub has only this.
- A stolen hub **cannot move funds**. It can only *ask* the signer to sign (and the signer shows what it signs).
- The hub **must** keep the RGB stash (consignments, contracts). RGB assets are not on-chain, and the seed alone does not recover them. So spending always goes **hub prepares → signer signs → hub broadcasts**.

Verified on Saturday morning with a real transfer: watch-only hub prepares a PSBT, a separate signer signs it, the hub broadcasts
(`rgb-sdk` `WalletManager` with xpubs only + `signPsbt(mnemonic, psbt)`; tx b57fc305…9563 on Mutinynet).

### Why WDK matters (bonus)
WDK is Tether's standard wallet interface (one API for every chain; `wdk-wallet-rgb` is UTEXO's RGB driver for it). Under it: `rgb-sdk` (JS helpers) → `rgb-lib` (Rust: stash, consignments, validation).
In our design **every signature in the system goes through WDK**: the guest paying, the host approving a restock, a sweep, UTXO creation. No money moves without WDK. The hub uses `rgb-sdk` directly only because it has no keys.

### One hub = one wallet; one host signer for all of them
- Each hub (hub A "Casa Rossi", hub B) has **its own seed**, kept by the host signer. The hub only gets that seed's xpubs.
- Two hubs must **never** share the same xpubs: two rgb-lib stashes on the same UTXOs break each other ("one wallet, one device").
- Properties are not linked on-chain, and a compromised hub exposes only its own history.
- Later: one host seed with one account per hub (needs multi-account support in the adapter).

---

## 2. Payment infrastructure (Alessandro)

### 2.1 `src/wallet.js`: two classes
```
class Wallet          // full wallet with seed (guest, supplier, host personal wallet) — exists today
  open() address() balance() createUtxos(n) issue() invoice() send() sendBtc() refresh() transfers()

class WatchWallet     // hub: rgb-sdk WalletManager({ xpubVan, xpubCol, masterFingerprint, network, dataDir, ... })
  open()                       reads data/<hub>/hub-keys.json (public only)
  address() balance() refresh() transfers() listAssets()
  invoice({ assetId?, amount, witness, seconds })      → { invoice, recipientId }   no signature needed
  issue({ ticker, name, amount, precision })           → asset                       no signature needed (genesis on an existing UTXO)
  prepareSend({ assetId, amount, invoice })            → { psbt }                    sendBegin, unsigned
  prepareUtxos({ num })                                → { psbt }                    createUtxosBegin, unsigned
  finish(kind, signedPsbt)                             → { txid }                    sendEnd / createUtxosEnd
```
Keep the existing serial queue (`run`): rgb-lib is not safe for concurrent calls on one wallet.

### 2.2 Which operations need the host's signature
| Operation | Who starts it | Signature? |
|---|---|---|
| Create an invoice (order) | hub | ❌ no |
| Receive and validate a payment (`refresh`) | hub | ❌ no |
| Issue a stay key (genesis) | hub | ❌ no |
| **Send** the stay key to the guest | hub prepares | ✅ host signer |
| Restock payment to a supplier | behaviour → hub prepares | ✅ host signer |
| Sweep earnings to the host wallet | host or schedule → hub prepares | ✅ host signer |
| Create colorable UTXOs | hub prepares | ✅ host signer |
| Hub A pays hub B (stretch) | behaviour → hub A prepares | ✅ signer, automatically within limits (section 4) |

### 2.3 The "To sign" queue (hub ⇄ signer)
State in `hub-state.json`:
```js
toSign: [{
  id, kind: 'stay-key' | 'restock' | 'sweep' | 'utxos' | 'd2d',
  summary: 'Send key STAY3F2A to the guest' | 'Pay 12.00 HUSD to Supplier for 6 beers',
  assetId?, amount?, recipient?,        // what the hub says it is doing (shown by the signer)
  psbt,                                 // unsigned, base64
  status: 'pending' | 'signed' | 'rejected' | 'failed' | 'expired',
  createdAt, expiresAt, txid?
}]
```
Flow:
1. The hub calls `prepareSend` / `prepareUtxos` → pushes an item with `status: 'pending'` → log + inbox.
2. The signer polls `GET /api/to-sign` (owner key) every ~5 s, or the host opens the "To sign" page.
3. Host approves → signer `signPsbt(mnemonic, psbt, 'signet')` → `POST /api/to-sign/:id { signedPsbt }`.
4. The hub calls `finish()` → `txid` → `status: 'signed'`, log with explorer link. Reject → `status: 'rejected'`, and the hub frees the prepared transfer (`failTransfers`).
5. An item not signed within 10 minutes → `expired`, transfer failed, UTXOs freed.

Only one prepared send at a time per hub (rgb-lib locks the inputs): queue new proposals as `proposal` until the previous one is signed or rejected.

### 2.4 `src/signer.js` (host's phone; demo: a small CLI/server on a PC)
- Holds `data/signer/<hub>.seed` (one per hub) + `data/signer/personal/` (the host's own WDK wallet that receives sweeps).
- `node src/signer.js init <hub>` → generates the seed (crypto RNG, never the AI), writes `data/<hub>/hub-keys.json` = `{ accountXpubVanilla, accountXpubColored, masterFingerprint }` (from `rgb-sdk` `deriveKeysFromMnemonic('signet', mnemonic)`) to copy to the hub.
- `node src/signer.js watch <hubUrl>` → polls "To sign", shows the summary, asks y/n (or auto-signs within limits, stretch), posts the signature.
- Known limit (say it honestly): the signer trusts the hub's summary for RGB amounts. It checks the Bitcoin side of the PSBT (fee, outputs). Full RGB decoding of the PSBT is future work.

### 2.5 The payment watcher (exists in `hub.js`, keep it)
Every `POLL_MS` (15 s, never tighter: shared endpoints):
`refresh()` → for each open order, `transfers(assetId)` → match by `recipientId` → map status:
`waiting` → `WaitingCounterparty` → `WaitingConfirmations` → `paid` (Settled and amount ≥ asked) | `underpaid` | `failed` | `expired`.
`paid` → `fulfil()`: device state (open / running / rented with `until`), `earned += amount`, log with explorer link, then `behaviours.onEvent('paid', order)`.

### 2.6 The four flows
**A. Pay per use (washing machine)**: the core flow, every other flow is a variant.
```
GUEST (WDK)                   HUB (watch-only)                       MUTINYNET + PROXY
  "Use" ───────────────────►  POST /api/services/:id/order
                              invoice(HUSD, 200) on the OWNER's UTXO
          ◄─────── invoice ── order { invoice, recipientId }
  sendBegin → signPsbt (WDK) → sendEnd ── consignment ──────────────► proxy
                                       ── Bitcoin tx ───────────────► chain (~30 s/block)
                              refresh(): validates consignment ◄──── consignment + 1 confirmation
                              Settled → fulfil → washing machine "running" 🧺
```
The money is the owner's from the moment it lands: the hub only watched it arrive. The owner does not need to be online to receive.

**B. Stay key (door)**
1. Host: "new stay" → the guest's invoice (from `guest.js /api/receive`, no assetId because the guest has never seen the key).
2. Hub: `issue({ ticker: 'STAYxxxx', amount: 1 })` (no signature) → `prepareSend` → **To sign** → signer signs → key on its way.
3. At the door: `order` for the access service with `stayAssetId` → the guest sends the key back to the door invoice → Settled → the hub checks that the **contract id** is in `stays` and that today is within `from`–`to` → 🔓.
4. Handing the key over is the check-in. After it the hub keeps a session (stay id → valid until `to`). No second transaction for every opening.

**C. Time-based rental (bike)**: flow A + `until = now + hours × HOUR_MS` (demo `HOUR_MS=60000`); the watcher locks the device when time is up; `overdue` behaviour.

**D. Restock (minibar)**: behaviour `stock_below 3` → proposal in the inbox → the host confirms the amount → the supplier creates an invoice → hub `prepareSend(HUSD, amount, supplierInvoice)` → **To sign** → signer signs → real transfer to the supplier.

**E. Sweep**: the host's personal wallet creates an invoice → hub `prepareSend(HUSD, earned)` → To sign → the earnings move from the hub's account to the host's personal wallet.

### 2.7 Assets (RGB)
| Asset | Schema | Issued by | Use |
|---|---|---|---|
| **HUSD** test dollar | NIA, precision 2 | once, by the demo setup | pay-per-use, rentals, restocks, earnings |
| **Stay key** (one per booking) | NIA, quantity 1 | the hub, per stay | access: the guest hands it to the door |

Why our own dollar: WDK/UTEXO uses rgb-lib `signet` (`sb:` ids); the KaleidoSwap faucet USDT lives on `signetcustom` (`sbc:`). The two cannot exchange assets. The organisers confirmed own NIA assets on signet are fine. The README must say that HUSD stands in for USDT.
Always identify assets by **asset id**, never by ticker (tickers can be faked).

### 2.8 What data lives on the hub (privacy)
| Data | On the hub? | Note |
|---|---|---|
| Seed / private key | ❌ never | only on the host signer |
| xpubs + fingerprint | ✅ unavoidable | cannot spend, but reveal the hub wallet's addresses and history → privacy-sensitive |
| RGB stash (consignments, UTXOs, transfers) | ✅ unavoidable | the receiver must validate and keep consignments; it is the hub's earnings history |
| Services, prices, behaviours | ✅ | not sensitive |
| Orders (invoice → service → status) | ✅ short-lived | pseudonymous (invoice/recipient id, no names); delete paid orders after N days |
| Stay sessions (key asset id → valid until) | ✅ until check-out | no guest name (task 24: the name becomes an optional label or goes) |
| Pending PSBTs | ✅ until signed/expired | removed after `finish` |
| Guest identity (name, email, phone) | ❌ never | the RGB key *is* the right; we do not need to know who holds it |
| Guest's keys | ❌ never | in the guest's wallet |
| Detailed usage history ("who used what, when") | ❌ or aggregated only | this is the data that says "the home is empty" |
| AI conversations | ❌ ephemeral | QVAC is local, nothing is stored |

What RGB gives: nothing readable on-chain (a normal Bitcoin tx with a commitment), no global ledger, blinded UTXOs in invoices (the payer does not see the hub's UTXOs), client-side validation, no intermediary.
What it does not give (say it before a judge asks): a consignment carries the asset's history (UTXOs and amounts, no names); the RGB proxy operator (KaleidoSwap) sees consignments in transit, and in production the hub would run its own proxy; witness invoices (`wvout`) show an address; the Bitcoin tx itself is public (time, fee).
**RGB protects money and access; QVAC protects usage data.**

Mitigations on the hub: data dir with owner-only permissions (encrypted disk in the product); encrypted backup of the hub stash to the host (`createBackup`, task 25) because the seed alone does not restore RGB assets.

### 2.9 Setup scripts (`scripts/`, demo only)
1. `signer.js init hub-a` / `hub-b` → seeds on the signer, `hub-keys.json` on the hubs.
2. Fund each hub's address from https://faucet.mutinynet.com.
3. Hub `prepareUtxos(5)` → signer signs (keep ≥ 3 free colorable UTXOs; warn in the log below that).
4. Issue HUSD on hub A; fund the guest (hub prepares, signer signs).
5. Guest and supplier: `guest.js` with their own `WALLET`, `POST /api/utxos`.

---

## 3. Local AI (QVAC) on the hub (Lapo)
### a) Plug-and-play device setup
1. A new device introduces itself with a small descriptor (name, type, commands). In the product it comes from the device (Matter / Home Assistant); in the demo we paste it, or the host **photographs the device label** and the vision model reads it.
2. The AI proposes a service: template (access / use / rent), suggested price, sensible behaviours.
3. The host confirms or edits in plain language; code activates it.

### b) The home's documents (private)
The host uploads house rules, rental contract, appliance manuals. The AI:
1. **contract → rules**: check-out 11:00, 50 deposit, quiet after 22:00 → proposed behaviours;
2. **guest assistant grounded on the documents** (RAG): "how does the boiler work?", "when is check-out?";
3. **reports for the host**: earnings and incidents per device (Private financial intelligence track).
Why local: contracts, documents and usage patterns are private; nothing leaves the hub.

### c) Already done
Text → service, text → behaviour, text → bundle (`src/ai.js`). The AI never generates keys and never moves money: it proposes, code validates and computes, the host signs.

---

## 4. Device functions (behaviours) — `src/behaviours.js` (Alessandro)
Rules of the form *when X, do or propose Y*, created from the device descriptor, from the contract, or in plain language (AI contract in `CLAUDE.md`).

| Device | Function | Action |
|---|---|---|
| 🚪 Door | key valid only during the stay dates | open / refuse |
| 🧺 Washing machine | blocked after 22:00 · every 50 washes, maintenance | lock · **propose purchase** |
| 🚲 Bike | rental overdue · weekend price +20% | **keep deposit** · change price |
| 🍺 Minibar | stock below 3 | **propose restock** to the supplier |

Engine:
- `evaluate(event, state)` is called on `paid`, `tick` (every poll) and `stock` (minibar counter changed).
- Triggers: `stock_below`, `weekday`, `overdue`, `after_hour`. Actions: `propose_purchase`, `change_price`, `notify`, `lock`/`unlock`, `keep_deposit`.
- Prices are computed by `effectivePrice(service, now)`, used by `createOrder`: the AI never computes amounts.
- `propose_purchase` → inbox item → the host confirms → section 2.6 D (To sign). **Approval = signature.**
- Each behaviour stores `lastTriggered` (shown by the device and host pages).

### Device-to-device payments (stretch, after the core)
- Same hub: devices share the hub wallet, so a transfer between them is internal accounting, no transaction.
- **Different hubs** (the useful case, e.g. hub A's bike buys a charge from hub B's station): hub B creates the invoice (receiving needs no signature); hub A **prepares** the payment; **host A's signer signs it**.
- To keep it automatic, the host sets **pre-authorised limits on the signer**, not on the hub: e.g. "the bike may spend up to 5 HUSD a day on charging, only towards hub B". Within the limits the signer signs on its own; outside them it asks the host. Like a prepaid card with a cap.
- A stolen hub can only *request* payments; the signer refuses anything outside the limits. Cost: for automatic payments the signer must be online (host's phone or a small always-on signing device).

---

## 5. Two hubs
Same code, different config: `HUB_NAME="Casa Rossi" PORT=8080 WALLET=hub-a` and `HUB_NAME="Cortile" PORT=8081 WALLET=hub-b`. Each has its own seed on the signer and its own `hub-keys.json`. One guest wallet uses both (network effect). Abandon hub B if it does not work by **Sunday 11:00**.

---

## 6. Hub HTTP API (the contract with `web/`)
Existing routes are listed in `CLAUDE.md` ("Hub API"). New routes for the watch-only hub:

Owner (`X-Hub-Key`):
- `GET /api/to-sign` → `[{ id, kind, summary, assetId, amount, recipient, psbt, status, createdAt, expiresAt }]`
- `POST /api/to-sign/:id` body `{ signedPsbt }` → `{ txid, link }`
- `POST /api/to-sign/:id/reject` → `{ ok }`
- `POST /api/stays` now returns `{ stay, toSign: id }` (the key leaves only after the signature)
- `POST /api/sweep` body `{ invoice, amount? }` → `{ toSign: id }`
- `POST /api/admin/utxos` now returns `{ toSign: id }`
- `GET /api/hub` adds `toSign` (pending count) and `freeUtxos`

Public (guests): unchanged (`/api/services`, `/api/services/:id/order`, `/api/orders/:id`, `/api/ai/bundle`).

---

## 7. Milestones
| When | Goal | Who |
|---|---|---|
| **Sat 15:00** | `WatchWallet` + `signer.js` in the repo; hub A runs watch-only; one key sent through "To sign" | Alessandro |
| **Sat 18:00** | Core real: door (key), washing machine (pay per use), bike (rental + lock when time is up) | Alessandro + Vittorio (pages) |
| **Sat evening** | Behaviours engine + restock → supplier (signed); AI host panel wired | Alessandro + Lapo + Vittorio |
| **Sun 10:00** | Hub B + same guest on both; sweep; plug-and-play from descriptor; one assistant question | all |
| **Sun 11:00** | **Feature freeze.** Full demo rehearsed; drop anything not working | all |
| Sun 12:00 | Final README: how to run, real vs simulated, third-party tools, prior work (WDK feasibility test) | Alessandro |
| **Sun 13:00** | **Last commit on `main`** | — |

## 8. Priorities
1. **Core, by Saturday evening:** watch-only hub + host signer, guest enters with the key, pays the washing machine, rents the bike. All real.
2. **AI, by Sunday morning:** plug-and-play from descriptor, contract → rules, one assistant question.
3. **Stretch:** label photo with vision, host reports, automatic sweeping, device-to-device payments between hubs with signer limits.

## 9. Known traps
- A wallet that never saw an asset must create an invoice **without** assetId (`AssetNotFound`).
- Paying a witness invoice (`wvout`) needs `witnessData: { amountSat: 1000 }`.
- Send = `sendBegin` → `signPsbt` → `sendEnd` (`transfer()` in 2.0.3 does not await `sendBegin`). Refresh both wallets after sending.
- Issuing and receiving on blinded invoices need free colorable UTXOs, and issuing needs ~1 block after creating them.
- Unpaid invoices stay `WaitingCounterparty` (normal): match by `recipientId`.
- rgb-lib is not concurrent: one queue per wallet.
- The native rgb-lib binaries (`@utexo/rgb-lib-linux-x64`, `@utexo/rgb-lib-darwin-arm64`, both `0.3.0-beta.8`, the version `rgb-sdk` 1.0.3 expects) are `optionalDependencies`: `npm install` picks the one for the current OS and skips the other. Verified on macOS arm64 and used on Linux x64.
- Node 22.x only (WDK does not build on Node 24).
