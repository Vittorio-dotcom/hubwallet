// Traceability without identity: who, how and when for every payment, with no names.
//
// Library used by the hub (src/hub-core.js) and by the client/provider wallet (src/guest.js).
//
// 1. Trace log (class Trace): an append-only file, one JSON line per event.
//    Each line carries the hash of the previous one (a hash chain), so removing or
//    editing an old event breaks every hash after it: verify() finds it.
//    It answers "how" (asset, amount, invoice kind, txid on Mutinynet) and "when"
//    (timestamps of every status change).
//
// 2. Identity keys (Ed25519, node:crypto). NOT money keys: they cannot spend anything.
//    - the hub has one identity key: it signs payment proofs ("hub X received N of asset Y
//      for request Z in tx T"), so the client keeps a proof it can show later;
//    - the payer has ONE KEY PER HUB (payer tag): it signs "I am the payer of request Z
//      with tx T". The same client is recognisable at the same hub (traceability: "who"),
//      but its tags at two different hubs cannot be linked (privacy). The hub never learns
//      a name, an e-mail or the client's wallet keys.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

// JSON with sorted keys: the same object always gives the same bytes, so the same hash.
export function canonical (x) {
  if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']'
  if (x && typeof x === 'object') {
    return '{' + Object.keys(x).filter((k) => x[k] !== undefined).sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}'
  }
  return JSON.stringify(x ?? null)
}
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

export class Trace {
  constructor (file) {
    this.file = file
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    // Resume the chain from the last line already on disk.
    const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : []
    const last = lines.length ? JSON.parse(lines[lines.length - 1]) : null
    this.seq = last ? last.seq : 0
    this.prev = last ? last.hash : '0'.repeat(64)
  }

  // Adds one event. `ref` links events of the same payment/transfer (its id).
  // Never put personal data in `data`: only ids, amounts, tags, txids.
  append (event, ref, data = {}) {
    const entry = { seq: this.seq + 1, at: new Date().toISOString(), event, ref, data, prev: this.prev }
    entry.hash = sha256(canonical(entry))
    fs.appendFileSync(this.file, JSON.stringify(entry) + '\n', { mode: 0o600 })
    this.seq = entry.seq
    this.prev = entry.hash
    return entry
  }

  // Last `limit` events, newest first; only those of `ref` if given.
  list ({ ref, limit = 200 } = {}) {
    if (!fs.existsSync(this.file)) return []
    let all = fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    if (ref) all = all.filter((e) => e.ref === ref)
    return all.slice(-limit).reverse()
  }

  // Recomputes the whole chain. { ok: true, count } or { ok: false, brokenAt: seq }.
  verify () {
    let prev = '0'.repeat(64)
    let count = 0
    for (const line of (fs.existsSync(this.file) ? fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean) : [])) {
      const { hash, ...rest } = JSON.parse(line)
      if (rest.prev !== prev || sha256(canonical(rest)) !== hash) return { ok: false, brokenAt: rest.seq }
      prev = hash
      count++
    }
    return { ok: true, count }
  }
}

// ---------- Ed25519 identity keys ----------

// Loads the private key from `file`, creating it on first use (owner-only permissions).
export function loadOrCreateKey (file) {
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    const { privateKey } = crypto.generateKeyPairSync('ed25519')
    fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  }
  return crypto.createPrivateKey(fs.readFileSync(file, 'utf8'))
}

// Public key as base64 (DER/SPKI): this is what we publish and compare.
export const publicKeyOf = (privateKey) =>
  crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64')

// Short, stable fingerprint of a public key: the "payer tag" shown in logs.
export const tagOf = (publicKeyB64) => sha256(publicKeyB64).slice(0, 16)

export const signText = (privateKey, text) => crypto.sign(null, Buffer.from(text), privateKey).toString('base64')

export function verifyText (publicKeyB64, text, signatureB64) {
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' })
    return crypto.verify(null, Buffer.from(text), key, Buffer.from(signatureB64, 'base64'))
  } catch { return false }
}

// ---------- the two signed messages of a payment ----------

// What the PAYER signs after paying. It names the hub (its identity key), so a claim
// made to one hub cannot be replayed to another.
export const payerClaimText = ({ hubKey, paymentId, recipientId, txid }) =>
  ['hubwallet-payer-claim:v1', hubKey, paymentId, recipientId, txid].join('\n')

// What the HUB signs once the payment is settled: the proof the payer keeps.
export const paymentProofText = (proof) => 'hubwallet-payment-proof:v1\n' + canonical(proof)
