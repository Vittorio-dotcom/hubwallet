// The hub's payment infrastructure: generic, it knows nothing about services or devices.
//
// Library, used by src/hub.js (the HTTP server) and by any layer built on top of it
// (services, devices, AI-generated endpoints). That layer decides WHAT a payment is for;
// this file only moves RGB assets safely:
//
//   requestPayment()   → an RGB invoice + a payment record with its description
//   watcher (poll)     → downloads and validates consignments, follows the status,
//                        checks asset and amount, emits 'paid'
//   claim / proof      → pseudonymous traceability: who paid (payer tag), how, when
//   prepareTransfer()  → spending: unsigned PSBT into the "To sign" queue; the service
//   prepareUtxos()       provider's signer signs it; submitSignature() broadcasts it
//   issueAsset()       → genesis of a new NIA asset on the hub (no signature needed)
//
// The hub holds NO seed (WatchWallet). Everything that spends waits for the signer.
// Money never travels over HTTP: HTTP carries invoices, PSBTs and statuses.
//
// Files in data/<wallet>/:
//   hub-keys.json      public keys (from the signer)        wallet/        rgb-lib stash
//   hub-state.json     payments + "To sign" queue           trace.jsonl    hash-chained log
//   identity.pem       Ed25519 identity (signs proofs, cannot spend)
//   owner-key.txt      secret for owner routes (header X-Hub-Key)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import express from 'express'
import { WatchWallet, EXPLORER, statusName, transferAmount } from './wallet.js'
import { Trace, loadOrCreateKey, publicKeyOf, tagOf, signText, verifyText, payerClaimText, paymentProofText } from './trace.js'

// A payment request is "open" while the watcher still has to look at it.
const OPEN = ['waiting', 'WaitingCounterparty', 'WaitingConfirmations']
const newId = () => crypto.randomBytes(8).toString('hex') // 64 bits: not guessable

// Input checks. Amounts are integers in the asset's smallest unit
// (e.g. cents for an asset with precision 2): no floats ever touch money.
function checkAmount (amount) {
  const n = Number(amount)
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error('amount must be a positive integer (smallest unit of the asset).')
  return n
}
function checkAssetId (assetId) {
  if (!/^rgb:\S+$/.test(String(assetId || ''))) throw new Error('assetId must be an RGB asset id (rgb:...). Never use a ticker: tickers can be faked.')
  return String(assetId)
}
const checkText = (text, max = 200) => String(text ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max)

export class Hub extends EventEmitter {
  // name: shown to payers · walletName: folder in data/ · signTimeoutMs: an unsigned
  // PSBT older than this expires and its inputs are released.
  // pollMs: FALLBACK interval, used only while something is open (default 2 min).
  //
  // rgb-lib is SYNCHRONOUS: while it works this process answers nothing. A refresh costs
  // ~0.5–1 s (rgb-lib logs); the expensive part was the balance reads, which re-synced with the
  // indexer every time (10–25 s) and now read the local database (docs/PERF.md). So:
  //   - nothing open                 → no refresh at all
  //   - a payer claim arrives        → burst: refresh every 5 s until the payment settles (max 3 min),
  //                                    so "paid" shows ~5 s after the block instead of up to +50 s
  //   - the signer signed a spend    → burst for the full 3 min (receiver's ACK → broadcast → block)
  //   - end of a burst, start-up, manual refresh → one indexer sync (bitcoin balance, UTXOs)
  //   - open payment without a claim → fallback every pollMs (an anonymous payer still gets seen)
  constructor ({ name, walletName, root = process.env.DATA_DIR || 'data', pollMs = 120_000, signTimeoutMs = 10 * 60_000 }) {
    super()
    this.name = name
    this.wallet = new WatchWallet(walletName, root)
    this.pollMs = pollMs
    this.signTimeoutMs = signTimeoutMs
    this.polling = false
    this.followUntil = 0 // a burst is running until this time
    this.followSpend = 0 // a signed spend is followed until this time (nothing in payments tells us it settled)
    this.burstTimer = null
    this.walletCache = null // { at, data }: GET /api/wallet also syncs, so cache it
  }

  async open () {
    await this.wallet.open()
    const dir = this.wallet.dir
    this.stateFile = path.join(dir, 'hub-state.json')
    this.state = fs.existsSync(this.stateFile)
      ? JSON.parse(fs.readFileSync(this.stateFile, 'utf8'))
      : { payments: [], toSign: [] }
    this.trace = new Trace(path.join(dir, 'trace.jsonl'))
    this.identity = loadOrCreateKey(path.join(dir, 'identity.pem'))
    this.hubKey = publicKeyOf(this.identity)

    // Owner secret, generated once with the crypto RNG. Shared by hand (Telegram), never in git.
    this.ownerKeyFile = path.join(dir, 'owner-key.txt')
    if (!process.env.HUB_KEY && !fs.existsSync(this.ownerKeyFile)) {
      fs.writeFileSync(this.ownerKeyFile, crypto.randomBytes(16).toString('hex') + '\n', { mode: 0o600 })
    }
    this.ownerKey = Buffer.from(process.env.HUB_KEY || fs.readFileSync(this.ownerKeyFile, 'utf8').trim())
    return this
  }

  save () { fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 1), { mode: 0o600 }) }

  // One refresh and one sync at start-up (to catch up), then only bursts and the fallback.
  start () {
    this.timer = setInterval(() => { if (this.busy()) this.poll() }, this.pollMs)
    this.poll().then(() => this.syncWallet())
    return this
  }
  stop () { clearInterval(this.timer); clearTimeout(this.burstTimer); this.burstTimer = null; this.followUntil = 0 }

  // Indexer sync: bitcoin balance and UTXOs. Blocking (10–25 s), so only at quiet moments.
  async syncWallet () {
    const err = await this.wallet.sync()
    if (err) console.error('sync:', err)
    this.walletCache = null
  }

  // Is there anything the watcher must look at?
  busy () {
    return Date.now() < this.followUntil || this.state.payments.some((p) => OPEN.includes(p.status))
  }

  // Refresh every 5 s after an event we know about (claim received, spend signed), until
  // nothing is open any more (or 3 min), then one sync for the bitcoin balance.
  burst (reason, { spend = false } = {}) {
    const until = Date.now() + 180_000
    this.followUntil = Math.max(this.followUntil, until)
    if (spend) this.followSpend = Math.max(this.followSpend, until)
    console.log(`[watch] ${reason}: refresh every 5 s until settled (max 3 min)`)
    if (this.burstTimer) return // already running: it now goes on until the new deadline
    const tick = async () => {
      await this.poll()
      const now = Date.now()
      const open = this.state.payments.some((p) => OPEN.includes(p.status) && p.claim)
      if (now < this.followUntil && (open || now < this.followSpend)) {
        this.burstTimer = setTimeout(tick, 5_000)
      } else {
        this.burstTimer = null
        this.followUntil = 0
        await this.syncWallet()
      }
    }
    this.burstTimer = setTimeout(tick, 0)
  }

  info () { return { name: this.name, network: 'signet (Mutinynet)', hubKey: this.hubKey } }

  // =====================================================================
  // RECEIVING: payment requests (no signature needed)
  // =====================================================================

  // Asks for `amount` of `assetId`. `description` says what it is for (it lives here,
  // off-chain: an RGB invoice has no memo field). `meta` is free data for the layer above
  // (e.g. { serviceId }) and is NOT shown to the payer.
  // Returns the public view of the payment: the payer needs { invoice, assetId, amount }.
  async requestPayment ({ assetId, amount, description, expiresIn = 3600, meta } = {}) {
    assetId = checkAssetId(assetId)
    amount = checkAmount(amount)
    description = checkText(description)
    const seconds = Math.min(Math.max(60, Number(expiresIn) || 3600), 86_400)
    // Witness invoice: the payer creates a new output for the hub, so receiving never
    // consumes the hub's colorable UTXOs and never needs the signer.
    const inv = await this.wallet.invoice({ assetId, amount, witness: true, seconds })
    const now = Date.now()
    const p = {
      id: newId(), description, assetId, amount, meta,
      invoice: inv.invoice, recipientId: inv.recipientId, invoiceKind: 'witness', anyAsset: inv.anyAsset,
      batchTransferIdx: inv.batchTransferIdx, // to fail exactly this invoice if it expires unpaid
      status: 'waiting', createdAt: now, expiresAt: now + seconds * 1000,
      history: [{ status: 'waiting', at: now }]
    }
    this.state.payments.unshift(p)
    this.save()
    this.trace.append('payment.requested', p.id, {
      assetId, amount, description, recipientId: p.recipientId, invoiceKind: 'witness', anyAsset: p.anyAsset, expiresAt: p.expiresAt
    })
    this.emit('payment', p)
    return this.publicPayment(p)
  }

  // What anyone holding the payment id may see. No payer key, no signatures, no meta.
  publicPayment (p) {
    return {
      id: p.id, hub: this.name, hubKey: this.hubKey, description: p.description,
      assetId: p.assetId, amount: p.amount, invoice: p.invoice, recipientId: p.recipientId,
      status: p.status, createdAt: p.createdAt, expiresAt: p.expiresAt,
      txid: p.txid, link: p.txid ? EXPLORER + p.txid : undefined, settledAt: p.settledAt,
      payerTag: p.claim?.payerTag
    }
  }

  getPayment (id) {
    const p = this.state.payments.find((x) => x.id === id)
    if (!p) throw new Error('Unknown payment.')
    return p
  }

  listPayments ({ status, limit = 100 } = {}) {
    return this.state.payments.filter((p) => !status || p.status === status).slice(0, limit)
  }

  // One place where a payment changes status: history + trace + event.
  setStatus (p, status, extra = {}) {
    if (p.status === status) return
    Object.assign(p, extra)
    p.status = status
    p.history.push({ status, at: Date.now() })
    this.save()
    this.trace.append('payment.status', p.id, { status, txid: p.txid, received: p.received })
    this.emit('status', p)
    if (status === 'paid') this.emit('paid', p)
  }

  // =====================================================================
  // THE WATCHER: runs at start-up, in bursts and as a fallback (see the constructor)
  // =====================================================================
  async poll () {
    if (this.polling) return
    this.polling = true
    this.walletCache = null
    try {
      // 1. Download consignments, validate them, update confirmations.
      const err = await this.wallet.refresh()
      if (err) console.error('refresh:', err)

      // 2. Match every open payment with the transfer rgb-lib has for its recipientId.
      const open = this.state.payments.filter((p) => OPEN.includes(p.status))
      const cache = {}
      const transfersOf = async (assetId) => (cache[assetId] ||= await this.wallet.transfers(assetId))
      let allIds = null // asset ids known to the wallet, only loaded if an "any asset" invoice needs them
      for (const p of open) {
        let found = null
        let foundAsset = null
        let ids = [p.assetId]
        if (p.anyAsset) {
          // The invoice accepted any asset: look everywhere, then check it is the right one.
          allIds ||= Object.values(await this.wallet.assets() || {}).flat().map((a) => a.assetId).filter(Boolean)
          ids = [p.assetId, ...allIds.filter((x) => x !== p.assetId)]
        }
        for (const id of ids) {
          let list = []
          try { list = await transfersOf(id) } catch { continue } // asset not in the stash (yet)
          found = list.find((t) => t.recipientId === p.recipientId)
          if (found) { foundAsset = id; break }
        }

        if (!found) {
          if (p.status === 'waiting' && Date.now() > p.expiresAt) this.setStatus(p, 'expired')
          continue
        }
        const st = statusName(found.status)
        if (foundAsset !== p.assetId) {
          // Someone paid an "any asset" invoice with another asset: never accept it as payment.
          this.setStatus(p, 'wrong_asset', { txid: found.txid, receivedAsset: foundAsset })
        } else if (st === 'Settled') {
          // Settled = consignment validated by rgb-lib AND the Bitcoin tx confirmed.
          const received = transferAmount(found)
          if (received >= p.amount) {
            // payerVerified: the payer's signed claim names the same txid the hub validated.
            const payerVerified = p.claim ? p.claim.txid === found.txid : undefined
            this.setStatus(p, 'paid', { txid: found.txid, received, settledAt: Date.now(), payerVerified })
          } else {
            this.setStatus(p, 'underpaid', { txid: found.txid, received })
          }
        } else if (st === 'Failed') {
          this.setStatus(p, 'failed', { txid: found.txid })
        } else if (st === 'WaitingCounterparty' && Date.now() > p.expiresAt) {
          // Expired and nothing arrived: fail THIS invoice only, so later refreshes skip it
          // (failTransfers without an index would fail every open invoice).
          await this.wallet.cancel(p.batchTransferIdx).catch(() => {})
          this.setStatus(p, 'expired')
        } else {
          this.setStatus(p, st, { txid: found.txid || p.txid }) // WaitingCounterparty / WaitingConfirmations
        }
      }

      // 3. Unsigned PSBTs past their deadline: release the inputs.
      for (const item of this.state.toSign.filter((i) => i.status === 'pending' && Date.now() > i.expiresAt)) {
        await this.wallet.cancel(item.batchTransferIdx).catch(() => {})
        this.setSignStatus(item, 'expired')
      }
    } catch (e) {
      console.error('poll:', e.message || e)
    } finally {
      this.polling = false
    }
  }

  // =====================================================================
  // TRACEABILITY: payer claim (who) and hub proof
  // =====================================================================

  // The payer says "I paid this request with tx T", signed with its per-hub key.
  // Only the first valid claim is kept. When the payment settles the hub checks that the
  // txid matches the one it validated (payerVerified).
  submitClaim (id, { payerKey, txid, signature } = {}) {
    const p = this.getPayment(id)
    if (p.claim) throw new Error('This payment already has a payer claim.')
    if (!payerKey || !txid || !signature) throw new Error('payerKey, txid and signature are required.')
    const text = payerClaimText({ hubKey: this.hubKey, paymentId: p.id, recipientId: p.recipientId, txid })
    if (!verifyText(payerKey, text, signature)) throw new Error('Invalid payer signature.')
    if (p.txid && p.txid !== txid) throw new Error('The txid does not match the payment the hub received.')
    p.claim = { payerTag: tagOf(payerKey), payerKey, txid, signature, at: Date.now() }
    if (p.status === 'paid') p.payerVerified = p.txid === txid
    this.save()
    this.trace.append('payment.claim', p.id, { payerTag: p.claim.payerTag, txid })
    // The payer has just put the consignment on the proxy: this is the moment to look.
    if (OPEN.includes(p.status)) this.burst(`payment ${p.id} claimed`)
    return { payerTag: p.claim.payerTag }
  }

  // A proof signed by the hub's identity key, available once paid. The payer stores it:
  // with the hub's public key anyone can check it (verifyText + paymentProofText).
  proof (id) {
    const p = this.getPayment(id)
    if (p.status !== 'paid') throw new Error(`Payment is ${p.status}, not paid yet.`)
    const proof = {
      v: 1, hub: this.name, hubKey: this.hubKey, paymentId: p.id, description: p.description,
      assetId: p.assetId, amount: p.amount, received: p.received, txid: p.txid,
      requestedAt: p.createdAt, settledAt: p.settledAt, payerTag: p.claim?.payerTag ?? null
    }
    return { proof, signature: signText(this.identity, paymentProofText(proof)) }
  }

  // =====================================================================
  // SPENDING: the "To sign" queue (hub prepares → signer signs → hub finishes)
  // =====================================================================

  setSignStatus (item, status, extra = {}) {
    Object.assign(item, extra)
    item.status = status
    item.history.push({ status, at: Date.now() })
    delete item.psbt // a PSBT is only kept while it waits for the signature
    this.save()
    this.trace.append(`transfer.${status}`, item.id, { kind: item.kind, txid: item.txid, error: item.error })
    this.emit('to-sign', item)
  }

  // rgb-lib locks the inputs of a prepared send: only one may wait at a time.
  pendingItem () { return this.state.toSign.find((i) => i.status === 'pending') }

  addToSign (fields) {
    const now = Date.now()
    const item = { id: newId(), status: 'pending', createdAt: now, expiresAt: now + this.signTimeoutMs, history: [{ status: 'pending', at: now }], ...fields }
    this.state.toSign.unshift(item)
    this.save()
    this.trace.append('transfer.prepared', item.id, {
      kind: item.kind, description: item.description, assetId: item.assetId, amount: item.amount, recipientId: item.recipientId
    })
    this.emit('to-sign', item)
    return this.signView(item)
  }

  // Sends `amount` of `assetId` to someone else's `invoice`. Nothing leaves until signed.
  async prepareTransfer ({ assetId, amount, invoice, description } = {}) {
    assetId = checkAssetId(assetId)
    amount = checkAmount(amount)
    description = checkText(description) || 'Transfer'
    if (!String(invoice || '').startsWith('rgb:')) throw new Error('invoice must be an RGB invoice (rgb:...).')
    const busy = this.pendingItem()
    if (busy) throw new Error(`Another operation is waiting for the signature (${busy.id}: ${busy.description}). Sign or reject it first.`)

    // Check the invoice against what we are asked to send: same asset (if the invoice names
    // one), same amount (if it names one), not expired.
    const inv = await this.wallet.decodeInvoice(invoice)
    if (inv.assetId && inv.assetId !== assetId) throw new Error('The invoice asks for a different asset.')
    const asked = Number(inv.assignment?.Fungible ?? inv.assignment?.fungible ?? 0)
    if (asked && asked !== amount) throw new Error(`The invoice asks for ${asked}, not ${amount}.`)
    if (inv.expirationTimestamp && inv.expirationTimestamp * 1000 < Date.now()) throw new Error('The invoice has expired.')

    const { psbt, batchTransferIdx } = await this.wallet.prepareSend({ assetId, amount, invoice })
    return this.addToSign({ kind: 'send', description, assetId, amount, invoice, recipientId: inv.recipientId, psbt, batchTransferIdx })
  }

  // Creates `num` colorable UTXOs (needed to issue assets and to receive change).
  async prepareUtxos ({ num = 5 } = {}) {
    const busy = this.pendingItem()
    if (busy) throw new Error(`Another operation is waiting for the signature (${busy.id}). Sign or reject it first.`)
    num = Math.min(Math.max(1, Math.round(Number(num) || 5)), 20)
    const { psbt } = await this.wallet.prepareUtxos({ num })
    return this.addToSign({ kind: 'utxos', description: `Create up to ${num} colorable UTXOs`, psbt })
  }

  // What the signer sees: description and the facts it checks, plus the PSBT while pending.
  signView (i) {
    const { history, batchTransferIdx, ...rest } = i
    return { ...rest, link: i.txid ? EXPLORER + i.txid : undefined }
  }

  listToSign ({ status } = {}) {
    return this.state.toSign.filter((i) => !status || i.status === status).slice(0, 100).map((i) => this.signView(i))
  }

  getToSign (id) {
    const item = this.state.toSign.find((i) => i.id === id)
    if (!item) throw new Error('Unknown operation.')
    if (item.status !== 'pending') throw new Error(`Operation is ${item.status}, not pending.`)
    return item
  }

  // The signer sends back the signed PSBT: broadcast it.
  async submitSignature (id, signedPsbt) {
    const item = this.getToSign(id)
    if (!signedPsbt) throw new Error('signedPsbt is required.')
    try {
      const r = await this.wallet.finish(item.kind, signedPsbt)
      this.walletCache = null
      this.setSignStatus(item, 'signed', { txid: r.txid, created: r.created, signedAt: Date.now() })
      // A send waits for the receiver's ACK before rgb-lib broadcasts it, then for the block.
      this.burst(`${item.kind} ${item.id} signed`, { spend: true })
      return this.signView(item)
    } catch (e) {
      // Wrong or tampered PSBT, or broadcast failure: release the inputs.
      await this.wallet.cancel(item.batchTransferIdx).catch(() => {})
      this.setSignStatus(item, 'failed', { error: String(e.message || e) })
      throw e
    }
  }

  async reject (id) {
    const item = this.getToSign(id)
    await this.wallet.cancel(item.batchTransferIdx).catch(() => {})
    this.setSignStatus(item, 'rejected')
    return this.signView(item)
  }

  // =====================================================================
  // ASSETS AND WALLET
  // =====================================================================

  // NIA = Non-Inflatable Asset: fixed supply decided at genesis, fungible.
  // amount = total supply in smallest units; precision = decimals (2 for a dollar).
  async issueAsset ({ ticker, name, amount, precision = 0, description } = {}) {
    ticker = String(ticker || '').toUpperCase()
    if (!/^[A-Z0-9]{1,8}$/.test(ticker)) throw new Error('ticker: 1-8 letters or digits.')
    name = checkText(name, 40) || ticker
    amount = checkAmount(amount)
    precision = Math.min(Math.max(0, Math.round(Number(precision) || 0)), 8)
    const a = await this.wallet.issue({ ticker, name, amount, precision })
    this.walletCache = null // the wallet changed: next GET /api/wallet reads it again
    this.trace.append('asset.issued', a.assetId, { ticker, name, amount, precision, description: checkText(description) })
    return a
  }

  // Balance and UTXOs come from the local database (ms); the indexer sync happens in
  // syncWallet(). The 30 s copy only saves work for pages polling this route; `fresh` re-reads.
  async walletView ({ fresh = false } = {}) {
    if (!fresh && this.walletCache && Date.now() - this.walletCache.at < 30_000) return this.walletCache.data
    const [bal, utxos] = await Promise.all([this.wallet.balance(), this.wallet.unspents()])
    const free = (utxos || []).filter((u) => u.utxo?.colorable && !(u.rgbAllocations || []).length).length
    const data = { ...bal, freeColorableUtxos: free, keys: this.wallet.publicKeys(), hubKey: this.hubKey, readAt: Date.now() }
    this.walletCache = { at: Date.now(), data }
    return data
  }

  // =====================================================================
  // HTTP: a router to mount with app.use('/api', hub.router())
  // =====================================================================
  isOwner (req) {
    const k = Buffer.from(String(req.get('X-Hub-Key') || ''))
    return k.length === this.ownerKey.length && crypto.timingSafeEqual(k, this.ownerKey)
  }

  router () {
    const r = express.Router()
    const owner = (req, res, next) => this.isOwner(req) ? next() : res.status(401).json({ error: 'Owner key required (X-Hub-Key).' })
    const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).then((x) => res.json(x)).catch((e) => res.status(400).json({ error: String(e.message || e) }))

    // ---- public: what a payer needs ----
    r.get('/hub/info', wrap(() => this.info()))
    r.get('/payments/:id', wrap((req) => this.publicPayment(this.getPayment(req.params.id))))
    r.post('/payments/:id/claim', wrap((req) => this.submitClaim(req.params.id, req.body)))
    r.get('/payments/:id/proof', wrap((req) => this.proof(req.params.id)))

    // ---- owner (service provider, its signer, the layers above) ----
    r.post('/payments', owner, wrap((req) => this.requestPayment(req.body)))
    r.get('/payments', owner, wrap((req) => this.listPayments(req.query)))
    r.get('/wallet', owner, wrap((req) => this.walletView({ fresh: req.query.fresh === '1' })))
    r.post('/assets', owner, wrap((req) => this.issueAsset(req.body)))
    r.post('/transfers', owner, wrap((req) => this.prepareTransfer(req.body)))
    r.post('/utxos', owner, wrap((req) => this.prepareUtxos(req.body)))
    r.get('/to-sign', owner, wrap((req) => this.listToSign(req.query)))
    r.post('/to-sign/:id', owner, wrap((req) => this.submitSignature(req.params.id, req.body?.signedPsbt)))
    r.post('/to-sign/:id/reject', owner, wrap((req) => this.reject(req.params.id)))
    r.get('/trace', owner, wrap((req) => this.trace.list({ ref: req.query.ref, limit: Number(req.query.limit) || 200 })))
    r.get('/trace/verify', owner, wrap(() => this.trace.verify()))
    r.post('/refresh', owner, wrap(async () => { await this.poll(); await this.syncWallet(); return { ok: true } })) // manual: refresh + sync
    return r
  }
}

// Shortcut: const hub = await createHub({ name, walletName })
export const createHub = (opts) => new Hub(opts).open()
