// A wallet WITH a seed, for whoever pays on their own: the client (guest) and the service
// provider (its personal wallet, e.g. to receive earnings or to pay a supplier).
// In the product this is the phone wallet app; here a small server the app/page talks to.
//
//   PORT=8090 WALLET=guest-marta npm run guest      client
//   PORT=8091 WALLET=provider    npm run guest      service provider's personal wallet
//
// It can spend, so it listens on 127.0.0.1 only (GUEST_HOST to change it, at your own risk).
//
// The payment flow with a hub (the client never trusts the hub blindly):
//   1. POST /api/check        {hubUrl, paymentId}   → reads the hub's request and decodes the RGB
//                                                    invoice locally: asset, amount, recipient, expiry
//   2. the app shows "pay <amount> of <asset> for <description>?" and the human confirms
//   3. POST /api/pay-request  {hubUrl, paymentId, expect:{assetId, amount}}
//                                                  → checks again, pays (WDK signs), then sends the hub a
//                                                    claim signed with this wallet's per-hub payer key
//   4. GET  /api/proof?hubUrl=&paymentId=          → once settled, the hub's signed proof, verified and kept
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { Wallet, EXPLORER } from './wallet.js'
import { Trace, loadOrCreateKey, publicKeyOf, tagOf, signText, verifyText, payerClaimText, paymentProofText, sha256 } from './trace.js'

const PORT = Number(process.env.PORT || 8090)
const WALLET = process.env.WALLET || 'guest'
const HOST = process.env.GUEST_HOST || '127.0.0.1'

const wallet = await new Wallet(WALLET).open()
// This wallet's own record of what it paid and received (stays on this device).
const trace = new Trace(path.join(wallet.dir, 'trace.jsonl'))
const proofsDir = path.join(wallet.dir, 'proofs')

// ---------- when to refresh ----------
// A rgb-lib refresh syncs with the indexer and is SYNCHRONOUS: while it runs (up to ~30 s on a
// wallet with history) this server answers nothing, not even static files. So no fixed polling:
//   - after this wallet pays → burst: +10 s (read the receiver's ACK, broadcast), +35 s, +70 s, +120 s (the block)
//   - a transfer still in progress (cheap local check) → fallback every 2 min
//   - nothing in progress → no refresh (pages stay instant); POST /api/refresh still works by hand
const FALLBACK_MS = Math.max(30_000, Number(process.env.WALLET_POLL_MS || 120_000))
let refreshing = false
let balanceCache = null // { at, data }: /api/me also syncs, so pages get a copy at most 30 s old
async function refreshNow () {
  if (refreshing) return
  refreshing = true
  try { await wallet.refresh() } finally { refreshing = false; balanceCache = null }
}
function burst (reason) {
  for (const d of [10_000, 35_000, 70_000, 120_000]) setTimeout(() => refreshNow(), d)
  console.log(`[watch] ${reason}: refresh at +10 s, +35 s, +70 s, +120 s`)
}
// listTransfers reads the local database only (no sync), so this check is instant.
async function inProgress () {
  const list = await wallet.transfers().catch(() => [])
  const now = Date.now() / 1000
  return (list || []).some((t) => ['WaitingCounterparty', 'WaitingConfirmations', 0, 1].includes(t.status) && !(t.expiration && t.expiration < now))
}

// One payer key per hub, so two hubs cannot link their customers.
// The file name is a hash of the hub key, not the hub's name.
function payerKeyFor (hubKey) {
  const priv = loadOrCreateKey(path.join(wallet.dir, 'payer-keys', `${tagOf(hubKey)}.pem`))
  return { priv, pub: publicKeyOf(priv), tag: tagOf(publicKeyOf(priv)) }
}

// GET/POST to a hub's public API.
async function hubApi (hubUrl, route, body) {
  const base = String(hubUrl || '').replace(/\/+$/, '')
  if (!/^https?:\/\/[^\s/]+/.test(base)) throw new Error('hubUrl must be http(s)://host:port')
  const res = await fetch(base + '/api' + route, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Hub answered HTTP ${res.status}`)
  return data
}

// Reads a hub payment request and checks the invoice against it, locally.
// Returns what will be paid, or throws with the reason not to pay.
async function check (hubUrl, paymentId, expect) {
  const [info, p] = await Promise.all([hubApi(hubUrl, '/hub/info'), hubApi(hubUrl, `/payments/${encodeURIComponent(paymentId)}`)])
  if (p.hubKey !== info.hubKey) throw new Error('The payment was not issued by this hub.')
  if (p.status !== 'waiting') throw new Error(`This payment is ${p.status}.`)
  const inv = await wallet.decodeInvoice(p.invoice)
  if (inv.recipientId !== p.recipientId) throw new Error('Invoice and request disagree on the recipient.')
  if (inv.assetId && inv.assetId !== p.assetId) throw new Error('The invoice asks for a different asset than the request.')
  const asked = Number(inv.assignment?.Fungible ?? inv.assignment?.fungible ?? 0)
  if (asked !== p.amount) throw new Error(`The invoice asks for ${asked}, the request says ${p.amount}.`)
  if (inv.expirationTimestamp && inv.expirationTimestamp * 1000 < Date.now()) throw new Error('The invoice has expired.')
  // The app must pass what it showed the human: if the hub changed anything since, stop.
  if (expect && (expect.assetId !== p.assetId || Number(expect.amount) !== p.amount)) {
    throw new Error('The request no longer matches what you confirmed.')
  }
  return { hub: info.name, hubKey: info.hubKey, paymentId: p.id, description: p.description, assetId: p.assetId, amount: p.amount, invoice: p.invoice, recipientId: p.recipientId, expiresAt: p.expiresAt }
}

const app = express()
app.use(express.json())
// The guest app may hold several wallets (one guest.js per port), so a page on another port calls us
// cross-origin. This API spends: allow only pages served from this machine, never '*'.
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
app.use((req, res, next) => {
  const origin = req.get('Origin')
  if (origin && LOCAL_ORIGIN.test(origin)) {
    res.set('Access-Control-Allow-Origin', origin)
    res.set('Access-Control-Allow-Headers', 'Content-Type')
    res.set('Vary', 'Origin')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(origin && LOCAL_ORIGIN.test(origin) ? 204 : 403)
  next()
})
if (fs.existsSync(path.resolve('web'))) app.use(express.static(path.resolve('web')))
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).then((x) => res.json(x)).catch((e) => res.status(400).json({ error: String(e.message || e) }))

app.get('/api/me', wrap(async (req) => {
  if (req.query.fresh !== '1' && balanceCache && Date.now() - balanceCache.at < 30_000) return balanceCache.data
  const data = { ...(await wallet.balance()), readAt: Date.now() }
  balanceCache = { at: Date.now(), data }
  return data
}))

// An invoice to RECEIVE (e.g. an access token, or earnings swept from a hub).
// Without assetId it accepts any asset, so an asset this wallet has never seen can arrive.
app.post('/api/receive', wrap(async (req) => {
  const { amount = 1, assetId, witness = false, seconds = 86_400, description = '' } = req.body || {}
  const r = await wallet.invoice({ assetId, amount: Number(amount), witness: !!witness, seconds: Number(seconds) })
  trace.append('receive.requested', r.recipientId, { assetId, amount: Number(amount), witness: !!witness, description: String(description).slice(0, 200) })
  return r
}))

// Step 1: what would I pay? (nothing is signed)
app.post('/api/check', wrap((req) => check(req.body?.hubUrl, req.body?.paymentId)))

// Step 3: pay a hub's payment request, then claim it with the per-hub payer key.
// anonymous: true skips the claim (the hub then only knows "someone paid").
app.post('/api/pay-request', wrap(async (req) => {
  const { hubUrl, paymentId, expect, anonymous = false } = req.body || {}
  if (!expect) throw new Error('expect { assetId, amount } is required: pass what the user confirmed.')
  const c = await check(hubUrl, paymentId, expect)
  const sent = await wallet.send({ assetId: c.assetId, amount: c.amount, invoice: c.invoice }) // WDK signs here
  balanceCache = null // the wallet changed: next /api/me reads it again
  let payerTag = null
  let claimError
  if (!anonymous) {
    const me = payerKeyFor(c.hubKey)
    const signature = signText(me.priv, payerClaimText({ hubKey: c.hubKey, paymentId: c.paymentId, recipientId: c.recipientId, txid: sent.txid }))
    try {
      payerTag = (await hubApi(hubUrl, `/payments/${c.paymentId}/claim`, { payerKey: me.pub, txid: sent.txid, signature })).payerTag
    } catch (e) { claimError = String(e.message || e) } // the payment is made anyway; the claim can be retried
  }
  trace.append('pay.sent', c.paymentId, {
    hub: c.hub, hubTag: tagOf(c.hubKey), description: c.description, assetId: c.assetId, amount: c.amount, txid: sent.txid, payerTag
  })
  burst(`paid ${c.paymentId}`)
  return { ...sent, link: sent.txid ? EXPLORER + sent.txid : undefined, payerTag, claimError }
}))

// Step 4: fetch the hub's signed proof, verify it with the hub's key and keep it.
app.get('/api/proof', wrap(async (req) => {
  const { hubUrl, paymentId } = req.query
  const info = await hubApi(hubUrl, '/hub/info')
  const { proof, signature } = await hubApi(hubUrl, `/payments/${encodeURIComponent(paymentId)}/proof`)
  const valid = proof.hubKey === info.hubKey && verifyText(info.hubKey, paymentProofText(proof), signature)
  if (!valid) throw new Error('The hub proof does not verify.')
  fs.mkdirSync(proofsDir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(proofsDir, `${sha256(paymentId).slice(0, 16)}.json`), JSON.stringify({ proof, signature }, null, 1), { mode: 0o600 })
  trace.append('pay.proof', paymentId, { txid: proof.txid, settledAt: proof.settledAt })
  return { valid, proof, signature }
}))

// Pay a raw RGB invoice (not from a hub request): e.g. the provider paying a supplier.
app.post('/api/pay', wrap(async (req) => {
  const { invoice, assetId, amount, description = '' } = req.body || {}
  if (!String(invoice || '').startsWith('rgb:')) throw new Error('invoice must be an RGB invoice (rgb:...).')
  const inv = await wallet.decodeInvoice(invoice)
  if (inv.assetId && inv.assetId !== assetId) throw new Error('The invoice asks for a different asset.')
  const r = await wallet.send({ invoice, assetId, amount: Number(amount) })
  balanceCache = null
  trace.append('pay.sent', inv.recipientId, { assetId, amount: Number(amount), txid: r.txid, description: String(description).slice(0, 200) })
  burst(`paid ${inv.recipientId}`)
  return { ...r, link: r.txid ? EXPLORER + r.txid : undefined }
}))

app.post('/api/refresh', wrap(async () => { await refreshNow(); return { ok: true } })) // manual: always refreshes
app.post('/api/utxos', wrap(async (req) => { const created = await wallet.createUtxos(Number(req.body?.num || 5)); balanceCache = null; return { created } }))
app.get('/api/transfers', wrap((req) => wallet.transfers(req.query.assetId)))
app.get('/api/trace', wrap(() => trace.list()))
app.get('/api/trace/verify', wrap(() => trace.verify()))

setInterval(async () => { if (await inProgress()) refreshNow() }, FALLBACK_MS) // only while a transfer is in progress
app.listen(PORT, HOST, () => console.log(`Wallet ${WALLET} on http://${HOST}:${PORT}`))
