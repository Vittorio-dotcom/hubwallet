// A self-custodial RGB wallet, one per hub (or guest), built on Tether WDK
// with UTEXO's RGB module. Keys and the RGB stash live in data/<name>/.
import fs from 'node:fs'
import path from 'node:path'
import WalletManagerRgb from '@utexo/wdk-wallet-rgb'
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
}
