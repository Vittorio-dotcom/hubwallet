// The service provider's signer: in the product, the host's phone; in the demo, a terminal.
// It holds the hubs' seeds. The hubs hold only the public keys. It signs what a hub
// prepared, after the human has read what it is and said yes.
//
//   node src/signer.js init <hub>                  new seed for a hub → data/signer/<hub>.seed
//                                                  + data/<hub>/hub-keys.json (public keys, copy it to the hub)
//   node src/signer.js import <hub> <seedFile>     same, from an existing seed (e.g. a hub that used to hold one)
//   node src/signer.js keys <hub>                  print the public keys of a hub
//   HUB_KEY=... node src/signer.js watch <hub> <hubUrl>
//                                                  polls the hub's "To sign" queue, shows each request,
//                                                  asks y/n, signs, sends the signature back
//
// Keys: bip39 mnemonic from the crypto RNG (never from the AI). The hub's public keys are derived with
// rgb-sdk deriveKeysFromMnemonic: verified to give the same xpubs and fingerprint as WDK, so a hub
// created by WDK can move its seed here without losing anything.
// Signing: rgb-sdk signPsbt(mnemonic, psbt, 'signet'). It does not open an RGB stash: a second
// stash on the hub's UTXOs would conflict with the hub's own ("one wallet, one device").
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import * as bip39 from 'bip39'
import { deriveKeysFromMnemonic, signPsbt } from '@utexo/rgb-sdk'
import { NETWORK } from './wallet.js'

const ROOT = process.env.DATA_DIR || 'data'
const SIGNER_DIR = path.resolve(ROOT, 'signer')
const POLL_MS = Math.max(2_000, Number(process.env.SIGNER_POLL_MS || 5_000))

const seedFile = (hub) => path.join(SIGNER_DIR, `${hub}.seed`)
const keysFile = (hub) => path.resolve(ROOT, hub, 'hub-keys.json')

function readSeed (hub) {
  if (!fs.existsSync(seedFile(hub))) throw new Error(`No seed for ${hub} in ${SIGNER_DIR}. Run: node src/signer.js init ${hub}`)
  return fs.readFileSync(seedFile(hub), 'utf8').trim()
}

// Only public keys leave the signer.
async function publicKeys (mnemonic) {
  const k = await deriveKeysFromMnemonic(NETWORK.network, mnemonic)
  return { accountXpubVanilla: k.accountXpubVanilla, accountXpubColored: k.accountXpubColored, masterFingerprint: k.masterFingerprint }
}

// Stores the seed (owner-only file) and writes the hub's public keys.
async function store (hub, mnemonic) {
  if (!bip39.validateMnemonic(mnemonic)) throw new Error('Not a valid BIP-39 mnemonic.')
  if (fs.existsSync(seedFile(hub))) throw new Error(`${seedFile(hub)} already exists: refusing to overwrite a seed.`)
  if (fs.existsSync(keysFile(hub))) throw new Error(`${keysFile(hub)} already exists: refusing to overwrite.`)
  fs.mkdirSync(SIGNER_DIR, { recursive: true, mode: 0o700 })
  fs.writeFileSync(seedFile(hub), mnemonic + '\n', { mode: 0o600 })
  const keys = await publicKeys(mnemonic)
  fs.mkdirSync(path.dirname(keysFile(hub)), { recursive: true, mode: 0o700 })
  fs.writeFileSync(keysFile(hub), JSON.stringify({ ...keys, network: NETWORK.network }, null, 1) + '\n')
  console.log(`Seed stored in ${seedFile(hub)} (keep it on the signer only, back it up offline).`)
  console.log(`Public keys written to ${keysFile(hub)} (this file goes to the hub).`)
  console.log(keys)
}

async function hubFetch (hubUrl, route, body) {
  const res = await fetch(hubUrl.replace(/\/+$/, '') + '/api' + route, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Key': process.env.HUB_KEY || '' },
    body: body ? JSON.stringify(body) : undefined
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

// The loop the host lives in: show → ask → sign → send.
async function watch (hub, hubUrl) {
  if (!process.env.HUB_KEY) throw new Error('Set HUB_KEY (the hub owner key).')
  const mnemonic = readSeed(hub)
  const mine = await publicKeys(mnemonic)

  // Before signing anything, check that this hub really is the one whose seed we hold.
  const w = await hubFetch(hubUrl, '/wallet')
  if (w.keys?.masterFingerprint !== mine.masterFingerprint || w.keys?.accountXpubColored !== mine.accountXpubColored) {
    throw new Error(`The hub at ${hubUrl} does not use the keys of ${hub} (fingerprint ${w.keys?.masterFingerprint} ≠ ${mine.masterFingerprint}).`)
  }
  console.log(`Signer for ${hub} (fingerprint ${mine.masterFingerprint}) watching ${hubUrl} every ${POLL_MS / 1000}s. Ctrl+C to stop.`)

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const seen = new Set()
  for (;;) {
    try {
      for (const item of await hubFetch(hubUrl, '/to-sign?status=pending')) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        // What the hub SAYS it is doing. Known limit: the signer does not decode the RGB part of
        // the PSBT, so it trusts the hub for asset and amount (the Bitcoin side is signed as built).
        console.log('\n──────── To sign ────────')
        console.log(`id:          ${item.id}`)
        console.log(`what:        ${item.kind === 'send' ? 'send an RGB asset' : 'create colorable UTXOs'}`)
        console.log(`description: ${item.description}`)
        if (item.kind === 'send') {
          console.log(`asset:       ${item.assetId}`)
          console.log(`amount:      ${item.amount} (smallest units)`)
          console.log(`to:          ${item.recipientId}`)
        }
        console.log(`expires:     ${new Date(item.expiresAt).toLocaleTimeString()}`)
        const answer = (await rl.question('Sign? [y/N] ')).trim().toLowerCase()
        if (answer !== 'y' && answer !== 'yes') {
          await hubFetch(hubUrl, `/to-sign/${item.id}/reject`, {})
          console.log('Rejected.')
          continue
        }
        const signedPsbt = await signPsbt(mnemonic, item.psbt, NETWORK.network)
        const done = await hubFetch(hubUrl, `/to-sign/${item.id}`, { signedPsbt })
        console.log(`Signed and broadcast${done.txid ? ': ' + done.link : '.'}`)
      }
    } catch (e) {
      console.error('signer:', e.message || e)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

const [cmd, hub, arg] = process.argv.slice(2)
try {
  if (cmd === 'init' && hub) await store(hub, bip39.generateMnemonic(128))
  else if (cmd === 'import' && hub && arg) {
    await store(hub, fs.readFileSync(arg, 'utf8').trim())
    console.log(`Now remove ${arg} from the hub's machine yourself: a watch-only hub must not keep a seed.`)
  } else if (cmd === 'keys' && hub) console.log(await publicKeys(readSeed(hub)))
  else if (cmd === 'watch' && hub && arg) await watch(hub, arg)
  else {
    console.log('Usage: node src/signer.js init <hub> | import <hub> <seedFile> | keys <hub> | watch <hub> <hubUrl>')
    process.exitCode = 1
  }
} catch (e) {
  console.error(e.message || e)
  process.exitCode = 1
}
