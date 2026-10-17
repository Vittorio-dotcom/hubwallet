// The hub server: the HTTP face of src/hub-core.js. Runs on the hub box (the physical device),
// reachable on the local network. Holds NO seed: it receives, validates and prepares;
// the service provider's signer (src/signer.js) signs every spend.
//
//   node src/signer.js init hub-a                 (once, on the provider side: writes data/hub-a/hub-keys.json)
//   HUB_NAME="Casa Rossi" PORT=8080 WALLET=hub-a npm run hub
//
// Layers built on top (services, devices, AI endpoints) can either call this HTTP API with
// the owner key, or import the core in-process:
//   import { createHub } from './hub-core.js'
import { createDeviceLayer } from './devices.js' // devices, services, orders + the host's AI (docs/HOST-APP.md)
//   const hub = await createHub({ name, walletName })
//   const p = await hub.requestPayment({ assetId, amount: 200, description: 'Washing machine, 1 run' })
//   hub.on('paid', (p) => { /* start the device */ })
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { createHub } from './hub-core.js'

const NAME = process.env.HUB_NAME || 'Hub'
const PORT = Number(process.env.PORT || 8080)
const WALLET = process.env.WALLET || 'hub-a'
const POLL_MS = Math.max(30_000, Number(process.env.POLL_MS || 120_000)) // fallback only: see Hub constructor in hub-core.js
const HOST = process.env.HUB_HOST || '0.0.0.0' // the hub is meant to be reached on the LAN

const hub = await createHub({ name: NAME, walletName: WALLET, pollMs: POLL_MS })
const devices = createDeviceLayer(hub) // env: DOLLAR_ASSET, USE_MS, HOUR_MS, DEMO_DEVICES, QVAC_URL, QVAC_API_KEY

// Everything that changes is printed: the operator sees the money path live.
hub.on('status', (p) => console.log(`[payment ${p.id}] ${p.status}${p.txid ? ' tx ' + p.txid : ''} — ${p.description}`))
hub.on('to-sign', (i) => console.log(`[to-sign ${i.id}] ${i.status} — ${i.description}${i.txid ? ' tx ' + i.txid : ''}`))

const app = express()
app.use(express.json({ limit: '1mb' })) // PSBTs are a few KB
app.use((req, res, next) => { // pages may be served by another machine (client app, device pages)
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-Hub-Key')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})
if (fs.existsSync(path.resolve('web'))) app.use(express.static(path.resolve('web')))
app.use('/api', devices.router()) // /api/devices*, /api/services*, /api/orders/:id
app.use('/api', hub.router())

app.listen(PORT, HOST, () => {
  console.log(`${NAME} hub on http://${HOST}:${PORT} (watch-only wallet ${WALLET})`)
  console.log(`Owner key in ${hub.ownerKeyFile} (header X-Hub-Key). Hub identity: ${hub.hubKey.slice(-16)}`)
})
hub.start()
