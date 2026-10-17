# API usage — the RGB payment layer (wallet, hub core, signer, payer wallet)

How to use the money path that Alessandro owns. Build services, devices, pages and AI endpoints **on top of it**;
do not touch wallets directly.

| You are | You use |
|---|---|
| a server-side layer on the hub (services, devices, AI routes) | `src/hub-core.js` in-process: `createHub()`, `requestPayment()`, `hub.on('paid')` (§2) |
| a page on the hub (host app, device pages) | the hub HTTP API under `/api` (§3) |
| the guest app (`web/guest.js`) or the provider's page | the payer wallet HTTP API, `src/guest.js` on 127.0.0.1 (§4) |
| the host approving spending | `src/signer.js watch` (§6) |

Rules that never change:
- **Amounts are integers in the asset's smallest unit.** HUSD has precision 2, so `200` = 2.00 HUSD. Never floats.
- **Assets are identified by asset id (`rgb:...`), never by ticker.** Tickers can be faked; the API rejects them.
- **Money never travels over HTTP.** HTTP carries invoices, PSBTs and statuses. Assets move wallet to wallet over RGB
  (consignment via the RGB proxy + a Bitcoin tx on Mutinynet).
- **The hub has no seed.** Receiving needs no signature. Every spend from the hub waits in "To sign" until the signer
  approves it; every signature in the system goes through WDK.
- **The AI never calls spending routes.** It proposes; code validates and computes; a human confirms.

---

## 1. Start the processes

```bash
node src/signer.js init hub-a                                   # once, provider side: seed → data/signer/, public keys → data/hub-a/hub-keys.json
HUB_NAME="Lavanderia" PORT=8080 WALLET=hub-a npm run hub        # owner key in data/hub-a/owner-key.txt (share on Telegram, never in git)
HUB_KEY=$(cat data/hub-a/owner-key.txt) node src/signer.js watch hub-a http://localhost:8080   # the host's "phone"
PORT=8090 WALLET=guest-marta npm run guest                      # a payer wallet (client); PORT=8091 WALLET=provider for the host's own wallet
```
Env: `POLL_MS` (watcher **fallback** interval, default 120000, minimum 30000: the hub refreshes in short bursts when a payer claim arrives or a spend is signed, and not at all when nothing is open; rgb-lib refreshes block the process), `WALLET_POLL_MS` (same fallback for `guest.js`), `HUB_HOST` (default `0.0.0.0`), `GUEST_HOST`
(default `127.0.0.1`), `DATA_DIR` (default `data`), `HUB_KEY` (override the owner key).

---

## 2. In-process: building on the hub (`src/hub-core.js`)

```js
import { createHub } from './hub-core.js'

const hub = await createHub({ name: 'Lavanderia', walletName: 'hub-a' })   // opens data/hub-a (watch-only)
app.use('/api', hub.router())   // mount the generic routes of §3 in your Express app
hub.start()                     // starts the payment watcher

// A "button": ask the guest to pay 2.00 HUSD for one wash.
const payment = await hub.requestPayment({
  assetId: HUSD_ID,                 // rgb:... (required)
  amount: 200,                      // smallest units (required, positive integer)
  description: 'Washing machine, 1 run',  // shown to the payer and kept in the trace (max 200 chars)
  expiresIn: 3600,                  // seconds, 60..86400 (optional)
  meta: { serviceId: 'washer' }     // free data for YOUR layer; never shown to the payer (optional)
})
// payment = { id, hub, hubKey, description, assetId, amount, invoice, recipientId, status: 'waiting', createdAt, expiresAt }
// Give payment.id (and the hub URL) to the guest app: QR, link, Bluetooth...

hub.on('paid', (p) => {           // fires once, when the asset id is right and received >= amount
  startDevice(p.meta.serviceId)   // p = full record: { id, meta, amount, received, txid, settledAt, claim?, payerVerified?, history }
})
hub.on('status', (p) => {})       // every status change of a payment
hub.on('to-sign', (item) => {})   // every change in the "To sign" queue
```

| Method | Returns | Notes |
|---|---|---|
| `requestPayment({ assetId, amount, description, expiresIn?, meta? })` | public view of the payment | witness invoice: no signature, no UTXO used |
| `getPayment(id)` / `listPayments({ status?, limit? })` | full records | throws `Unknown payment.` |
| `publicPayment(record)` | what a payer may see | no meta, no payer key |
| `proof(id)` | `{ proof, signature }` | only once `paid` |
| `prepareTransfer({ assetId, amount, invoice, description })` | "To sign" item | hub sends an asset; waits for the signer |
| `prepareUtxos({ num })` | "To sign" item | colorable UTXOs (needed to issue and to send) |
| `issueAsset({ ticker, name, amount, precision, description })` | asset | NIA, no signature, needs 1 free colorable UTXO |
| `walletView()` | `{ address, btc, assets, freeColorableUtxos, keys, hubKey }` | |
| `poll()` | — | one watcher round now |
| `trace.list({ ref?, limit? })` / `trace.verify()` | events / `{ ok, count }` | hash-chained log |

Payment statuses: `waiting` → `WaitingCounterparty` → `WaitingConfirmations` → `paid`.
Final alternatives: `underpaid`, `failed`, `expired`, `wrong_asset`. One block on Mutinynet is ~30 s; count ~1 minute for `paid`.

All methods throw `Error` with a message you can show the user.

---

## 3. Hub HTTP API (`src/hub.js`, everything under `/api`)

Owner routes need the header `X-Hub-Key: <owner key>`. Errors: HTTP 400/401 with `{ error }`.

### Public (payers)
| Method | Route | Body → Response |
|---|---|---|
| GET | `/hub/info` | → `{ name, network, hubKey }` |
| GET | `/payments/:id` | → `{ id, hub, hubKey, description, assetId, amount, invoice, recipientId, status, createdAt, expiresAt, txid?, link?, settledAt?, payerTag? }` |
| POST | `/payments/:id/claim` | `{ payerKey, txid, signature }` → `{ payerTag }` (sent by `guest.js`, you do not build it) |
| GET | `/payments/:id/proof` | → `{ proof, signature }` once `paid` |

### Owner
| Method | Route | Body → Response |
|---|---|---|
| POST | `/payments` | `{ assetId, amount, description, expiresIn?, meta? }` → public view (same as `requestPayment`) |
| GET | `/payments` | `?status=paid` → full records |
| GET | `/wallet` | → `{ address, btc, assets, freeColorableUtxos, keys, hubKey }` |
| POST | `/assets` | `{ ticker, name, amount, precision, description }` → asset (`assetId`) |
| POST | `/transfers` | `{ assetId, amount, invoice, description }` → To sign item `{ id, kind:'send', status:'pending', expiresAt, ... }` |
| POST | `/utxos` | `{ num }` → To sign item `{ kind:'utxos' }` |
| GET | `/to-sign` | `?status=pending` → items (with `psbt` only while pending) |
| POST | `/to-sign/:id` | `{ signedPsbt }` → item `signed` with `txid`, `link` (the signer calls this) |
| POST | `/to-sign/:id/reject` | → item `rejected` |
| GET | `/trace` | `?ref=<paymentId>&limit=` → events, newest first |
| GET | `/trace/verify` | → `{ ok: true, count }` or `{ ok: false, brokenAt }` |
| POST | `/refresh` | → `{ ok: true }` after one watcher round |

To sign statuses: `pending` → `signed` | `rejected` | `expired` (10 min) | `failed`. **One pending item per hub at a time**:
a second one gets `Another operation is waiting for the signature (...)`.

---

## 4. Payer wallet HTTP API (`src/guest.js`, 127.0.0.1 only)

CORS allows only pages from `http://localhost:*` and `http://127.0.0.1:*`. The wallet has a seed and signs through WDK.

### Paying a hub request (the demo flow)
```js
// 1. Show the guest what they would pay. Nothing is signed.
const c = await post(WALLET + '/api/check', { hubUrl, paymentId })
// c = { hub, hubKey, paymentId, description, assetId, amount, invoice, recipientId, expiresAt }
// The wallet decoded the RGB invoice itself: asset, amount, recipient and expiry match the hub's request.

// 2. The guest confirms "pay 2.00 HUSD to Lavanderia for Washing machine, 1 run?"

// 3. Pay. `expect` = exactly what the guest confirmed: if the hub changed anything, the wallet refuses.
const r = await post(WALLET + '/api/pay-request', { hubUrl, paymentId, expect: { assetId: c.assetId, amount: c.amount } })
// r = { txid, link, payerTag, claimError? }   (anonymous: true skips the payer claim)

// 4. Follow the status on the hub (public route), every ~5–10 s, until 'paid'.
const p = await get(hubUrl + '/api/payments/' + paymentId)

// 5. Once paid, fetch and keep the hub's signed proof.
const proof = await get(WALLET + `/api/proof?hubUrl=${encodeURIComponent(hubUrl)}&paymentId=${paymentId}`)   // { valid, proof, signature }
```

| Method | Route | Body → Response |
|---|---|---|
| GET | `/api/me` | → `{ address, btc, assets }` (`assets.nia[]`: `{ assetId, ticker, precision, balance: { settled, future, spendable } }`) |
| POST | `/api/receive` | `{ amount, assetId?, witness?, seconds?, description? }` → `{ invoice, recipientId, ... }` (no `assetId` for an asset never seen) |
| POST | `/api/check` | `{ hubUrl, paymentId }` → what would be paid |
| POST | `/api/pay-request` | `{ hubUrl, paymentId, expect: { assetId, amount }, anonymous? }` → `{ txid, link, payerTag, claimError? }` |
| GET | `/api/proof` | `?hubUrl=&paymentId=` → `{ valid, proof, signature }` (saved in `data/<wallet>/proofs/`) |
| POST | `/api/pay` | `{ invoice, assetId, amount, description }` → `{ txid, link }` (any RGB invoice, e.g. a supplier) |
| POST | `/api/refresh` | → `{ ok: true }` |
| POST | `/api/utxos` | `{ num }` → `{ created }` (the wallet needs colorable UTXOs to hold and pay assets) |
| GET | `/api/transfers` | `?assetId=` → rgb-lib transfers |
| GET | `/api/trace` · `/api/trace/verify` | this wallet's own payment log |

A wallet that pays needs BTC (fees + 1000 sat for the hub's witness output) and free colorable UTXOs (`/api/utxos`).
Its HUSD sit on one UTXO, busy until the previous transfer settles (~1 min): pay a bundle as **one** request for the total.

---

## 5. Example: a service layer for `web/guest.js`

`web/guest.js` calls `GET /api/services`, `POST /api/services/:id/order` and `GET /api/orders/:id`. Those belong to the
service layer, not to the payment layer. A minimal version on top of `hub-core`:
```js
const services = [{ id: 'washer', name: 'Washing machine', icon: '🧺', type: 'use', price: 200, unit: 'use' }]

app.get('/api/services', (req, res) => res.json({ name: hub.name, dollar: 'HUSD', services }))

app.post('/api/services/:id/order', async (req, res) => {
  const s = services.find((x) => x.id === req.params.id)
  if (!s) return res.status(400).json({ error: 'Unknown service.' })
  const p = await hub.requestPayment({ assetId: HUSD_ID, amount: s.price, description: `${s.name}, 1 run`, meta: { serviceId: s.id } })
  res.json({ id: p.id, serviceId: s.id, assetId: p.assetId, amount: p.amount, invoice: p.invoice, recipientId: p.recipientId, status: p.status })
})

app.get('/api/orders/:id', (req, res) => {
  const p = hub.getPayment(req.params.id)
  res.json({ ...hub.publicPayment(p), serviceId: p.meta?.serviceId, service: services.find((s) => s.id === p.meta?.serviceId) })
})

hub.on('paid', (p) => { /* set the device of p.meta.serviceId to 'running' */ })
```
The order `id` **is** the payment id, so the page can then pay with `/api/check` + `/api/pay-request` (recommended: the
wallet checks the invoice and sends the payer claim), or with the older `/api/pay { invoice, assetId, amount }`.

---

## 6. Signer (`src/signer.js`)

```
node src/signer.js init <hub>                 new seed for a hub (refuses to overwrite)
node src/signer.js import <hub> <seedFile>    from an existing seed; then remove the seed from the hub machine yourself
node src/signer.js keys <hub>                 print the hub's public keys
HUB_KEY=<owner key> node src/signer.js watch <hub> <hubUrl>
```
`watch` checks that the hub really uses this seed's keys (fingerprint + colored xpub). It then shows each pending item
(what, description, asset, amount, recipient, expiry), asks `Sign? [y/N]`, signs through WDK and posts the signature back.
Known limit: the signer trusts the hub's summary for the RGB part (asset and amount).

---

## 7. Traceability (who, how, when, without identities)

- **Who:** a *payer tag*, the hash of an Ed25519 key that the payer wallet creates **per hub**. Same payer at the same hub
  → same tag; two hubs cannot link their customers. No names, e-mails, IPs or wallet keys on the hub.
- **How:** asset id, amount asked and received, witness invoice, recipient id, Mutinynet txid, consignment validated by rgb-lib.
- **When:** `createdAt`, every status change with its timestamp (`history`), `settledAt`.
- **Proofs:** the payer signs a claim (`payerVerified: true` when its txid matches the one the hub validated); the hub signs a
  payment proof the payer keeps; the hub's `trace.jsonl` is hash-chained (`/api/trace/verify`).

Verification helpers (`src/trace.js`): `verifyText(publicKey, text, signature)`, `payerClaimText(...)`, `paymentProofText(proof)`, `tagOf(publicKey)`.
