// RGB wallets for HubWallet. Two kinds, same network, same data layout (data/<name>/):
//
//   Wallet       full wallet WITH a seed, built on Tether WDK (`wdk-wallet-rgb`).
//                Used by whoever may spend on their own: the client (guest) and the
//                service provider's personal wallet. It signs its own payments.
//
//   WatchWallet  watch-only wallet WITHOUT a seed, built on UTEXO `rgb-sdk` with xpubs only.
//                Used by the hub. It can create invoices, receive and validate incoming
//                consignments (the RGB "contracts" + history) and PREPARE transactions,
//                but it cannot sign: every spend becomes an unsigned PSBT that the service
//                provider signs with src/signer.js, and the hub then broadcasts it (finish).
//
// Library only, never started on its own. Under both classes runs rgb-lib (Rust):
// it keeps the RGB stash, talks to the indexer (Esplora) and to the RGB proxy
// (where consignments travel between wallets).
import fs from 'node:fs'
import path from 'node:path'
import WalletManagerRgb from '@utexo/wdk-wallet-rgb'
import { WalletManager } from '@utexo/rgb-sdk'
import * as bip39 from 'bip39'

// Mutinynet, opened as rgb-lib "signet" (the network the UTEXO adapter supports).
export const NETWORK = {
  network: 'signet',
  indexerUrl: process.env.RGB_INDEXER || 'https://esplora.signet.kaleidoswap.com',
  transportEndpoint: process.env.RGB_PROXY || 'rpcs://proxy.kaleidoswap.com/json-rpc'
}
export const EXPLORER = 'https://mutinynet.com/tx/'

// rgb-lib returns bigints; JSON cannot carry them.
export const plain = (x) => JSON.parse(JSON.stringify(x ?? null, (k, v) => typeof v === 'bigint' ? Number(v) : v))

// ---------- helpers shared by every wallet ----------

// rgb-lib may report a transfer status as a name ('Settled') or as the enum number (2).
// We always work with the names.
const STATUS = ['WaitingCounterparty', 'WaitingConfirmations', 'Settled', 'Failed']
export const statusName = (s) => typeof s === 'number' ? STATUS[s] : s

// Same for the transfer kind (rgb-sdk TransferKind enum).
const KIND = ['Issuance', 'ReceiveBlind', 'ReceiveWitness', 'Send', 'Inflation']
export const kindName = (k) => typeof k === 'number' ? KIND[k] : k

// How many units a transfer moved. rgb-lib lists one or more "assignments"
// ({ Fungible: n } for fungible assets such as NIA); older outputs use `amount`.
export function transferAmount (t) {
  if (Array.isArray(t?.assignments) && t.assignments.length) {
    return t.assignments.reduce((sum, a) => sum + Number(a.Fungible || 0), 0)
  }
  return Number(t?.amount || 0)
}

// A witness invoice (`wvout`) asks the payer to create a NEW output for the receiver,
// so the payer must attach sats to it. A blinded invoice points to an existing UTXO.
export const isWitnessInvoice = (invoice) => String(invoice || '').includes('wvout')
const WITNESS_SATS = 1000

export class Wallet {
  constructor (name, root = process.env.DATA_DIR || 'data') {
    this.name = name
    this.dir = path.resolve(root, name)
    this.queue = Promise.resolve()
  }

  async open () {
    const seedFile = path.join(this.dir, 'seed.txt')
    if (!fs.existsSync(seedFile)) {
      fs.mkdirSync(path.join(this.dir, 'wallet'), { recursive: true, mode: 0o700 })
      fs.writeFileSync(seedFile, bip39.generateMnemonic(128) + '\n', { mode: 0o600 })
    }
    const seed = fs.readFileSync(seedFile, 'utf8').trim()
    this.manager = new WalletManagerRgb(seed, { ...NETWORK, dataDir: path.join(this.dir, 'wallet') })
    this.account = await this.manager.getAccount()
    return this
  }

  // rgb-lib is not safe for concurrent calls on one wallet: run them one at a time.
  run (fn) {
    const job = this.queue.then(() => fn(this.account))
    this.queue = job.catch(() => {})
    return job
  }

  address () { return this.run((a) => a.getAddress()) }

  balance () {
    return this.run(async (a) => {
      const r = await a.registerWallet()
      return plain({ address: r.address, btc: r.btcBalance, assets: await a.listAssets() })
    })
  }

  createUtxos (num = 5) { return this.run(async (a) => plain(await a.createUtxos({ upTo: true, num, feeRate: 2 }))) }

  issue ({ ticker, name, amount, precision = 0 }) {
    return this.run(async (a) => plain(await a.issueAssetNia({ ticker, name, precision, amounts: [amount] })))
  }

  // Returns { invoice, recipientId }. Without assetId the invoice accepts any asset
  // (needed when this wallet has never seen the asset before).
  invoice ({ assetId, amount, witness = false, seconds = 3600 }) {
    return this.run(async (a) => plain(await a.receiveAsset({
      assetId, amount, witness, minConfirmations: 1, durationSeconds: seconds
    })))
  }

  // Three explicit steps: wdk-wallet-rgb 2.0.3 `transfer` does not await sendBegin.
  // A witness invoice (recipient without UTXOs) needs sats for the new output.
  send ({ assetId, amount, invoice }) {
    return this.run(async (a) => {
      const psbt = await a.sendBegin({
        invoice, assetId, amount, feeRate: 2, minConfirmations: 1,
        witnessData: invoice.includes('wvout') ? { amountSat: 1000 } : undefined
      })
      const signedPsbt = await a.signPsbt(psbt)
      return plain(await a.sendEnd({ signedPsbt }))
    })
  }

  sendBtc ({ to, sats }) { return this.run(async (a) => plain(await a.sendTransaction({ to, value: sats, feeRate: 2 }))) }

  // Downloads incoming consignments, sends ACKs, updates confirmations.
  refresh () { return this.run(async (a) => { try { await a.refreshWallet() } catch (e) { return String(e.message || e) } }) }

  transfers (assetId) { return this.run(async (a) => plain(await a.listTransfers(assetId))) }

  // Reads an RGB invoice WITHOUT paying it: { recipientId, assetId?, assignment, network,
  // expirationTimestamp, transportEndpoints }. The payer uses it to check that the invoice
  // really asks for the asset and the amount it was shown, before signing anything.
  decodeInvoice (invoice) { return this.run((a) => plain(a.getRgbWallet().decodeRGBInvoice({ invoice }))) }
}

// The hub's wallet: public keys + RGB stash, NO seed.
//
// data/<name>/hub-keys.json  { accountXpubVanilla, accountXpubColored, masterFingerprint }
//   written by `node src/signer.js init <name>` on the service provider's side.
//   These keys can derive addresses and watch them, never sign.
// data/<name>/wallet/        the rgb-lib stash (consignments, UTXOs, transfers).
//   RGB assets live here, not on-chain: losing this folder loses the assets even with the seed.
export class WatchWallet {
  constructor (name, root = process.env.DATA_DIR || 'data') {
    this.name = name
    this.dir = path.resolve(root, name)
    this.queue = Promise.resolve()
  }

  async open () {
    const keysFile = path.join(this.dir, 'hub-keys.json')
    if (!fs.existsSync(keysFile)) {
      throw new Error(`${keysFile} not found. Create it on the service provider side: node src/signer.js init ${this.name}`)
    }
    // A watch-only hub must not hold a seed. We only warn: deleting or moving it is the human's call.
    if (fs.existsSync(path.join(this.dir, 'seed.txt'))) {
      console.warn(`⚠️  ${path.join(this.dir, 'seed.txt')} exists: this hub is NOT watch-only. Move the seed to the signer (node src/signer.js import ${this.name} <file>) and remove it from here.`)
    }
    this.keys = JSON.parse(fs.readFileSync(keysFile, 'utf8'))
    fs.mkdirSync(path.join(this.dir, 'wallet'), { recursive: true, mode: 0o700 })
    // rgb-sdk WalletManager without `mnemonic`/`seed` = watch-only. Same keys as the WDK
    // wallet that the seed would open, so the same stash folder works for both.
    this.rgb = new WalletManager({
      xpubVan: this.keys.accountXpubVanilla,
      xpubCol: this.keys.accountXpubColored,
      masterFingerprint: this.keys.masterFingerprint,
      network: NETWORK.network,
      indexerUrl: NETWORK.indexerUrl,
      transportEndpoint: NETWORK.transportEndpoint,
      dataDir: path.join(this.dir, 'wallet')
    })
    return this
  }

  // One rgb-lib call at a time (the stash is a single SQLite database).
  run (fn) {
    const job = this.queue.then(() => fn(this.rgb))
    this.queue = job.catch(() => {})
    return job
  }

  // Public identity of this wallet: what the signer compares before signing for it.
  publicKeys () {
    const { accountXpubVanilla, accountXpubColored, masterFingerprint } = this.keys
    return { accountXpubVanilla, accountXpubColored, masterFingerprint }
  }

  address () { return this.run((w) => w.getAddress()) }

  balance () {
    return this.run((w) => {
      const r = w.registerWallet()
      return plain({ address: r.address, btc: r.btcBalance, assets: w.listAssets() })
    })
  }

  // UTXOs; "free colorable" = can hold a new RGB allocation (needed to issue assets
  // and as change when sending). Creating them needs a signature: see prepareUtxos.
  unspents () { return this.run((w) => plain(w.listUnspents())) }

  // ---------- receiving: no signature needed ----------

  // Creates an invoice the payer will pay. Returns { invoice, recipientId, anyAsset }.
  // witness = true (default for the hub): the payer creates a new output for us, so the
  //   hub does not consume its own colorable UTXOs and never needs the signer to receive.
  // If this wallet has never seen `assetId`, rgb-lib refuses an invoice bound to it:
  //   we then create an "any asset" invoice and the caller MUST check the asset on arrival
  //   (`anyAsset: true` tells it to).
  invoice ({ assetId, amount, witness = true, seconds = 3600 }) {
    return this.run((w) => {
      const params = { assetId, amount, minConfirmations: 1, durationSeconds: seconds }
      const receive = (p) => plain(witness ? w.witnessReceive(p) : w.blindReceive(p))
      try {
        return { ...receive(params), anyAsset: !assetId }
      } catch (e) {
        if (!assetId) throw e
        return { ...receive({ ...params, assetId: undefined }), anyAsset: true }
      }
    })
  }

  // Issues a new NIA asset (genesis) on one of our free colorable UTXOs.
  // No signature: issuing does not spend bitcoin, it only commits the genesis to a UTXO we own.
  issue ({ ticker, name, amount, precision = 0 }) {
    return this.run((w) => plain(w.issueAssetNia({ ticker, name, precision, amounts: [amount] })))
  }

  // Downloads incoming consignments from the proxy, validates them (client-side
  // validation: rgb-lib checks the asset history back to genesis), sends ACKs,
  // updates confirmations. Returns an error string instead of throwing: a failed refresh
  // (proxy or indexer down) must not stop the payment watcher.
  refresh () { return this.run((w) => { try { w.refreshWallet() } catch (e) { return String(e.message || e) } }) }

  transfers (assetId) { return this.run((w) => plain(w.listTransfers(assetId))) }

  assets () { return this.run((w) => plain(w.listAssets())) }

  decodeInvoice (invoice) { return this.run((w) => plain(w.decodeRGBInvoice({ invoice }))) }

  // ---------- spending: prepare here, sign on the signer, finish here ----------

  // Step 1 of a send: builds the UNSIGNED PSBT that moves `amount` of `assetId` to `invoice`
  // and locks the inputs it uses. Returns { psbt, batchTransferIdx }.
  // batchTransferIdx identifies the pending transfer so that cancel() can release it.
  prepareSend ({ assetId, amount, invoice }) {
    return this.run((w) => {
      const psbt = w.sendBegin({
        invoice, assetId, amount, feeRate: 2, minConfirmations: 1,
        witnessData: isWitnessInvoice(invoice) ? { amountSat: WITNESS_SATS } : undefined
      })
      // Find the pending outgoing transfer just created for this recipient.
      // (To verify on a real wallet: if rgb-lib only records it at sendEnd, this stays
      // undefined and cancel() has nothing to release, which is also fine.)
      const { recipientId } = w.decodeRGBInvoice({ invoice })
      const pending = plain(w.listTransfers(assetId))
        .filter((t) => kindName(t.kind) === 'Send' && statusName(t.status) === 'WaitingCounterparty' && t.recipientId === recipientId)
        .sort((a, b) => b.batchTransferIdx - a.batchTransferIdx)[0]
      return { psbt, batchTransferIdx: pending?.batchTransferIdx }
    })
  }

  // Step 1 of UTXO creation: an UNSIGNED PSBT that splits our bitcoin into `num`
  // colorable UTXOs (upTo: only as many as missing).
  prepareUtxos ({ num = 5, size } = {}) {
    return this.run((w) => ({ psbt: w.createUtxosBegin({ upTo: true, num, size, feeRate: 2 }) }))
  }

  // Step 3: the signer returned the signed PSBT. rgb-lib checks it matches the prepared
  // one, broadcasts the Bitcoin tx and (for a send) posts the consignment to the proxy.
  //   kind 'send'  → { txid, batchTransferIdx }
  //   kind 'utxos' → { created }
  finish (kind, signedPsbt) {
    return this.run((w) => {
      if (kind === 'send') return plain(w.sendEnd({ signedPsbt }))
      if (kind === 'utxos') return { created: plain(w.createUtxosEnd({ signedPsbt })) }
      throw new Error(`Unknown kind: ${kind}`)
    })
  }

  // The prepared send was rejected or expired: mark it Failed so its inputs are free again.
  cancel (batchTransferIdx) {
    if (batchTransferIdx === undefined || batchTransferIdx === null) return Promise.resolve(false)
    return this.run((w) => plain(w.failTransfers({ batchTransferIdx })))
  }

  // Encrypted backup of the stash (the seed alone does not restore RGB assets).
  backup ({ dir, password }) { return this.run((w) => plain(w.createBackup({ backupPath: dir, password }))) }
}
