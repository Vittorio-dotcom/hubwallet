// The guest's own wallet (in a real product: a phone wallet app).
// It only talks to hubs to ask for invoices; money moves wallet to wallet over RGB.
//
//   PORT=8090 WALLET=guest-marta node src/guest.js
import path from 'node:path'
import express from 'express'
import { Wallet, EXPLORER } from './wallet.js'

const PORT = Number(process.env.PORT || 8090)
const WALLET = process.env.WALLET || 'guest'
const wallet = await new Wallet(WALLET).open()

const app = express()
app.use(express.json())
app.use(express.static(path.resolve('web')))
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(400).json({ error: String(e.message || e) }))

app.get('/api/me', wrap(async (req, res) => res.json(await wallet.balance())))

// An invoice to receive (e.g. the key from the host). Any asset, so a key we have never seen can arrive.
app.post('/api/receive', wrap(async (req, res) => {
  res.json(await wallet.invoice({ amount: Number(req.body?.amount || 1), witness: !!req.body?.witness, seconds: 86400 }))
}))

// Pay a hub's invoice.
app.post('/api/pay', wrap(async (req, res) => {
  const { invoice, assetId, amount } = req.body || {}
  const r = await wallet.send({ invoice, assetId, amount: Number(amount) })
  res.json({ ...r, link: r.txid ? EXPLORER + r.txid : undefined })
}))

app.post('/api/refresh', wrap(async (req, res) => { await wallet.refresh(); res.json({ ok: true }) }))
app.post('/api/utxos', wrap(async (req, res) => res.json({ created: await wallet.createUtxos(Number(req.body?.num || 5)) })))
app.get('/api/transfers', wrap(async (req, res) => res.json(await wallet.transfers())))

setInterval(() => wallet.refresh(), 20_000)
// The wallet API can spend: listen on this machine only unless told otherwise.
const HOST = process.env.GUEST_HOST || '127.0.0.1'
app.listen(PORT, HOST, () => console.log(`Guest wallet on http://${HOST}:${PORT} (wallet ${WALLET})`))
