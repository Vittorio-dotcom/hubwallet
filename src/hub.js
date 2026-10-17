// A HubWallet hub: one owner, one RGB wallet, many devices.
// It sells or rents services, issues access tokens, checks incoming RGB
// payments and drives the devices. It never holds anyone else's money.
//
//   HUB_NAME="Casa Rossi" PORT=8080 WALLET=hub-a node src/hub.js
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import express from 'express'
import { Wallet, EXPLORER } from './wallet.js'

const NAME = process.env.HUB_NAME || 'Casa Rossi'
const PORT = Number(process.env.PORT || 8080)
const WALLET = process.env.WALLET || 'hub-a'
const DOLLAR = process.env.DOLLAR_TICKER || 'HUSD' // our test dollar, precision 2
const HOUR_MS = Number(process.env.HOUR_MS || 60_000) // demo: one rental hour lasts one minute
const POLL_MS = Number(process.env.POLL_MS || 15_000)

const wallet = await new Wallet(WALLET).open()
const STATE_FILE = path.join(wallet.dir, 'hub-state.json')
const id = () => crypto.randomBytes(4).toString('hex')

// ---------- state (a small JSON file next to the wallet) ----------
const state = fs.existsSync(STATE_FILE)
  ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  : { services: [], orders: [], stays: [], inbox: [], log: [] }
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1))
function log (kind, text, extra = {}) {
  state.log.unshift({ at: new Date().toISOString(), kind, text, ...extra })
  state.log = state.log.slice(0, 200)
  save()
  console.log(`[${kind}] ${text}`)
}

let dollarId = process.env.DOLLAR_ASSET || state.dollarId || null
async function dollarAsset () {
  if (dollarId) return dollarId
  const { assets } = await wallet.balance()
  const nia = assets?.nia || []
  dollarId = nia.find((a) => a.ticker === DOLLAR)?.assetId || null
  if (dollarId) { state.dollarId = dollarId; save() }
  return dollarId
}

// ---------- services ----------
// type: access (an RGB token handed to the device) | use (pay per use) | rent (time-based)
// price is in dollar cents; for rent it is per hour.
function addService (s) {
  const svc = {
    id: s.id || id(),
    name: String(s.name || 'Service').slice(0, 40),
    icon: s.icon || '🧩',
    type: ['access', 'use', 'rent'].includes(s.type) ? s.type : 'use',
    price: Math.max(0, Math.round(Number(s.price || 0))),
    unit: s.unit || (s.type === 'rent' ? 'hour' : 'use'),
    maxHours: s.maxHours ? Number(s.maxHours) : undefined,
    behaviours: Array.isArray(s.behaviours) ? s.behaviours : [],
    earned: 0,
    device: { state: s.type === 'access' ? 'locked' : 'idle', until: 0 }
  }
  state.services.push(svc)
  log('hub', `Service created: ${svc.name} (${svc.type})`)
  return svc
}
const findService = (sid) => state.services.find((s) => s.id === sid)

// ---------- orders: an RGB invoice the guest must pay ----------
async function createOrder (svc, { hours = 1, stayAssetId } = {}) {
  let assetId, amount
  if (svc.type === 'access') {
    const stay = state.stays.find((s) => s.assetId === stayAssetId)
    if (!stay) throw new Error('This key does not belong to this home.')
    assetId = stay.assetId; amount = 1
  } else {
    assetId = await dollarAsset()
    if (!assetId) throw new Error(`The hub has no ${DOLLAR} asset yet.`)
    hours = svc.type === 'rent' ? Math.min(Math.max(1, Math.round(hours)), svc.maxHours || 24) : 1
    amount = svc.price * hours
  }
  const inv = await wallet.invoice({ assetId, amount, seconds: 3600 })
  const order = {
    id: id(), serviceId: svc.id, assetId, amount, hours,
    invoice: inv.invoice, recipientId: inv.recipientId,
    status: 'waiting', createdAt: Date.now()
  }
  state.orders.unshift(order); save()
  log('rgb', `Invoice created for ${svc.name}: ${svc.type === 'access' ? 'the key' : fmt(amount) + ' ' + DOLLAR}`, { orderId: order.id })
  return order
}
const fmt = (cents) => (cents / 100).toFixed(2)

function fulfil (order, transfer) {
  const svc = findService(order.serviceId)
  order.status = 'paid'; order.txid = transfer.txid; order.paidAt = Date.now()
  if (svc.type !== 'access') svc.earned += order.amount
  if (svc.type === 'access') svc.device = { state: 'open', until: Date.now() + 30_000 }
  if (svc.type === 'use') svc.device = { state: 'running', until: Date.now() + Number(process.env.USE_MS || 45_000) }
  if (svc.type === 'rent') svc.device = { state: 'rented', until: Date.now() + order.hours * HOUR_MS }
  log('rgb', `Payment received for ${svc.name}${transfer.txid ? '' : ''}`, { orderId: order.id, txid: transfer.txid, link: transfer.txid ? EXPLORER + transfer.txid : undefined })
  log('device', `${svc.name}: ${svc.device.state}`)
  save()
}

// ---------- the payment watcher ----------
let polling = false
async function poll () {
  if (polling) return
  polling = true
  try {
    await wallet.refresh()
    const waiting = state.orders.filter((o) => o.status !== 'paid' && o.status !== 'expired')
    if (waiting.length) {
      const transfers = await wallet.transfers()
      for (const o of waiting) {
        const t = transfers.find((x) => x.recipientId === o.recipientId)
        if (!t) continue
        if (t.status === 'Settled') fulfil(o, t)
        else if (t.status === 'Failed') { o.status = 'failed'; save() }
        else if (o.status !== t.status) { o.status = t.status; save() } // WaitingCounterparty / WaitingConfirmations
      }
    }
    // devices return to rest when their time is over
    for (const s of state.services) {
      if (s.device.until && Date.now() > s.device.until && s.device.state !== 'locked' && s.device.state !== 'idle') {
        s.device = { state: s.type === 'access' ? 'locked' : 'idle', until: 0 }
        log('device', `${s.name}: ${s.device.state}`)
      }
    }
  } catch (e) {
    console.error('poll:', e.message || e)
  } finally { polling = false }
}
setInterval(poll, POLL_MS)

// ---------- HTTP API ----------
const app = express()
app.use(express.json())
app.use((req, res, next) => { // the guest app runs on another machine
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})
app.use(express.static(path.resolve('web')))
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(400).json({ error: String(e.message || e) }))

app.get('/api/hub', wrap(async (req, res) => {
  const bal = await wallet.balance()
  res.json({
    name: NAME, dollar: DOLLAR, dollarId: await dollarAsset(), hourMs: HOUR_MS,
    address: bal.address, btc: bal.btc, assets: bal.assets,
    services: state.services, stays: state.stays,
    orders: state.orders.slice(0, 30), inbox: state.inbox, log: state.log.slice(0, 50)
  })
}))

// public view for guests: no balances, no log
app.get('/api/services', (req, res) => res.json({ name: NAME, dollar: DOLLAR, services: state.services.map(({ earned, ...s }) => s) }))

app.post('/api/services', wrap(async (req, res) => res.json(addService(req.body))))

app.post('/api/services/:id/order', wrap(async (req, res) => {
  const svc = findService(req.params.id)
  if (!svc) throw new Error('Unknown service.')
  res.json(await createOrder(svc, req.body || {}))
}))

app.get('/api/orders/:id', wrap(async (req, res) => {
  const o = state.orders.find((x) => x.id === req.params.id)
  if (!o) throw new Error('Unknown order.')
  res.json({ ...o, service: findService(o.serviceId) })
}))

// The host gives a guest the key of a stay: a new RGB asset, quantity 1.
app.post('/api/stays', wrap(async (req, res) => {
  const { guest = 'Guest', from, to, invoice } = req.body || {}
  if (!String(invoice || '').startsWith('rgb:')) throw new Error('Paste the guest\'s RGB invoice.')
  const ticker = 'STAY' + crypto.randomBytes(2).toString('hex').toUpperCase()
  const asset = await wallet.issue({ ticker, name: `${NAME} stay ${from || ''}-${to || ''}`.trim(), amount: 1 })
  const sent = await wallet.send({ assetId: asset.assetId, amount: 1, invoice })
  const stay = { guest, from, to, assetId: asset.assetId, ticker, txid: sent.txid }
  state.stays.unshift(stay)
  log('rgb', `Key ${ticker} issued and sent to ${guest}`, { txid: sent.txid, link: EXPLORER + sent.txid })
  res.json(stay)
}))

// Admin helpers for the demo setup.
app.post('/api/admin/utxos', wrap(async (req, res) => res.json({ created: await wallet.createUtxos(Number(req.body?.num || 5)) })))
app.post('/api/admin/issue-dollar', wrap(async (req, res) => {
  const a = await wallet.issue({ ticker: DOLLAR, name: 'HubWallet test dollar', amount: Number(req.body?.amount || 1_000_000), precision: 2 })
  dollarId = a.assetId; state.dollarId = dollarId; save()
  res.json(a)
}))
app.post('/api/admin/send', wrap(async (req, res) => res.json(await wallet.send(req.body))))
app.post('/api/admin/send-btc', wrap(async (req, res) => res.json(await wallet.sendBtc(req.body))))
app.post('/api/admin/poll', wrap(async (req, res) => { await poll(); res.json({ ok: true }) }))

app.listen(PORT, '0.0.0.0', () => console.log(`${NAME} hub on http://0.0.0.0:${PORT} (wallet ${WALLET})`))
poll()
