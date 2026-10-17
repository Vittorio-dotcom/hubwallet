// HubWallet guest app logic.
// Talks to the guest's own wallet (same origin: /api/me, /api/receive, /api/pay, /api/refresh, /api/transfers)
// and to the public API of the hubs nearby (/api/services, /api/services/:id/order, /api/orders/:id).
// Hubs come from ?hubs=http://ip:8080,http://ip:8081 (remembered on this device).
// If the wallet or every hub is unreachable, it shows example data so the interface can be tried without a backend.

const $ = (s) => document.querySelector(s)
const money = (cents) => (Number(cents || 0) / 100).toFixed(2)
const qs = new URLSearchParams(location.search)
// Trusted hubs are remembered on this device. Hubs arriving from a link (QR) are only *offered*:
// the guest sees the full address and must confirm before their devices are listed.
const parse = (v) => String(v || '').split(',').map((h) => h.trim().replace(/\/$/, '')).filter((h) => /^https?:\/\/[^/]+$/.test(h))
const stored = (() => { try { return localStorage.getItem('hubs') } catch { return null } })()
let HUBS = parse(stored)
if (!HUBS.length && !qs.get('hubs')) HUBS = ['http://localhost:8080']
let offered = parse(qs.get('hubs')).filter((h) => !HUBS.includes(h))
const saveHubs = () => { try { localStorage.setItem('hubs', HUBS.join(',')) } catch {} }
const DOLLAR = 'HUSD'

// ---------- small DOM helper: builds elements with text only (no HTML injection) ----------
function el (tag, props = {}, ...children) {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn)
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v)
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : String(c))
  return n
}

async function api (url, body) {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`)
  return j
}

// ---------- example data (used only when the backend does not answer) ----------
const EXAMPLE = {
  me: {
    address: 'tb1p…example',
    btc: { vanilla: { spendable: 48210 } },
    assets: { nia: [
      { assetId: 'rgb:example-husd', ticker: DOLLAR, name: 'HubWallet test dollar', balance: { spendable: 10000 } }
    ] }
  },
  transfers: [
    { kind: 'ReceiveBlind', status: 'Settled', assignments: [{ Fungible: 10000 }], createdAt: Date.now() / 1000 - 3600, txid: null }
  ],
  hubs: [
    { url: 'example-a', name: 'Lavanderia', services: [
      { id: 'washer', name: 'Washing machine', icon: '🧺', type: 'use', price: 200, device: { state: 'idle' } },
      { id: 'dryer', name: 'Dryer', icon: '🌀', type: 'use', price: 150, device: { state: 'idle' } }
    ] }
  ]
}

let me = null; let transfers = []; let hubs = []; let demo = false; let busy = false

async function load () {
  let liveWallet = true; let liveHubs = 0
  try { me = await api('/api/me') } catch { liveWallet = false }
  try { transfers = liveWallet ? await api('/api/transfers') : [] } catch { transfers = [] }
  hubs = []
  for (const url of HUBS) {
    try { const h = await api(url + '/api/services'); hubs.push({ url, name: h.name, dollar: h.dollar, services: h.services || [] }); liveHubs++ } catch {}
  }
  demo = !liveWallet || liveHubs === 0
  if (!liveWallet) { me = EXAMPLE.me; transfers = EXAMPLE.transfers }
  if (liveHubs === 0) hubs = EXAMPLE.hubs
  render()
}

const dollar = () => (me?.assets?.nia || []).find((a) => a.ticker === DOLLAR)
const keys = () => (me?.assets?.nia || []).filter((a) => a.ticker.startsWith('STAY') && a.balance.spendable > 0)
// Weak binding by name (until keys carry the issuing hub's identity): the hub must have a name,
// no other connected hub may share it, and the key name must be exactly "<hub name> stay ...".
function keyFor (h) {
  const name = String(h.name || '').trim()
  if (!name) return null
  if (hubs.filter((x) => String(x.name || '').trim().toLowerCase() === name.toLowerCase()).length > 1) return null
  return keys().find((k) => String(k.name || '').startsWith(name + ' stay ')) || null
}
const KIND = { access: 'Access', use: 'Pay per use', rent: 'Rental' }

function stateOf (s) {
  const st = s.device?.state
  if (s.type === 'access') return st === 'open' ? ['Open', 'on'] : ['Locked', 'free']
  if (s.type === 'use') return st === 'running' ? ['Running', 'busy'] : ['Ready', 'free']
  if (st === 'rented') return [`Rented · ${Math.max(0, Math.ceil(((s.device.until || 0) - Date.now()) / 1000))} s`, 'busy']
  return ['Available', 'free']
}
function priceText (s) {
  if (s.type === 'access') return 'With your key'
  return `${money(s.price)} ${DOLLAR} ${s.type === 'rent' ? '/ hour' : '/ use'}`
}

function render () {
  $('#demo-tag').hidden = !demo
  $('#offer').replaceChildren(...offered.map((url) => el('div', { class: 'card' },
    el('span', { class: 'label' }, 'New hub from a link'),
    el('span', { class: 'mono' }, url),
    el('p', { class: 'small muted' }, 'Connect only if you are in front of this hub (for example you scanned its QR code).'),
    el('div', { class: 'row' },
      el('button', { class: 'btn primary', type: 'button', on: { click: () => { HUBS.push(url); offered = offered.filter((x) => x !== url); saveHubs(); load() } } }, 'Connect'),
      el('button', { class: 'btn', type: 'button', on: { click: () => { offered = offered.filter((x) => x !== url); render() } } }, 'Ignore')))))
  $('#amount').textContent = money(dollar()?.balance.spendable || 0)
  $('#unit').textContent = DOLLAR
  const k = keys().length
  $('#balance-hint').textContent = `${k ? k + (k > 1 ? ' keys · ' : ' key · ') : ''}Movements, address and keys ›`

  const tiles = hubs.flatMap((h) => h.services.filter((s) => KIND[s.type]).map((s) => ({ h, s })))
  $('#devices').replaceChildren(...(tiles.length
    ? tiles.map(({ h, s }) => {
        const [label, cls] = stateOf(s)
        return el('button', { class: 'tile', type: 'button', on: { click: () => openDevice(h, s) }, 'aria-label': `${s.name}, ${priceText(s)}` },
          el('span', { class: 'ic', 'aria-hidden': 'true' }, s.icon || '🧩'),
          el('span', { class: 'name' }, s.name),
          el('span', { class: 'price' }, priceText(s)),
          el('span', { class: `pill ${cls}` }, label),
          hubs.length > 1 ? el('span', { class: 'where' }, h.name) : null)
      })
    : [el('div', { class: 'empty', style: 'grid-column:1/-1' }, 'No devices nearby. Scan the QR code on a device.')]))

  // wallet sheet
  $('#address').textContent = me?.address || '–'
  $('#sats').textContent = `${(me?.btc?.vanilla?.spendable ?? 0).toLocaleString('en')} sats`
  $('#moves').replaceChildren(...(transfers.length
    ? [...transfers].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map((t) => {
        const amt = (t.assignments || []).reduce((s, a) => s + Number(a.Fungible || 0), 0) || Number(t.requestedAssignment?.Fungible || 0)
        const incoming = String(t.kind).startsWith('Receive') || t.kind === 'Issuance'
        const when = t.createdAt ? new Date(t.createdAt * 1000).toLocaleString('en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
        return el('div', {},
          el('span', { 'aria-hidden': 'true' }, incoming ? '↓' : '↑'),
          el('div', { class: 'grow' }, el('div', {}, incoming ? 'Received' : 'Sent'), el('div', { class: 'small muted' }, `${when} · ${t.status}`)),
          el('span', { class: 'mono' }, amt === 1 ? '1 unit' : money(amt)),
          t.txid ? el('a', { href: 'https://mutinynet.com/tx/' + t.txid, target: '_blank', rel: 'noopener', class: 'small' }, 'tx') : null)
      })
    : [el('div', { class: 'empty' }, 'No movements yet.')]))
  $('#keys').replaceChildren(...(keys().length
    ? keys().map((a) => el('div', { class: 'key' }, el('span', { class: 'label' }, 'Stay key · RGB asset'), el('strong', {}, a.name), el('span', { class: 'mono' }, a.ticker)))
    : [el('div', { class: 'empty' }, 'No key yet. Create an invoice in "Address" and give it to the host.')]))

  // user sheet
  $('#hub-list').replaceChildren(...hubs.map((h) => el('div', {}, el('span', { class: 'grow' }, h.name), el('span', { class: 'small muted mono' }, demo ? 'example' : h.url.replace(/^https?:\/\//, '')))))
}

// ---------- sheets ----------
function show (id) { document.querySelectorAll('.sheet').forEach((s) => { s.hidden = s.id !== id }); $('#home').hidden = !!id }
document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) show(null) })
$('#open-wallet').onclick = () => show('wallet')
$('#open-user').onclick = () => show('user')
$('#reload').onclick = async () => { if (!demo) await api('/api/refresh', {}).catch(() => {}); load() }
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)))
  for (const t of ['moves', 'address', 'keys']) $('#tab-' + t).hidden = t !== b.dataset.tab
}))
$('#copy-address').onclick = async () => { try { await navigator.clipboard.writeText($('#address').textContent); $('#copy-address').textContent = 'Copied' } catch { getSelection().selectAllChildren($('#address')) } }
$('#make-invoice').onclick = async () => {
  if (demo) { $('#invoice').textContent = 'rgb:example-invoice (connect the wallet to create a real one)'; return }
  try { const r = await api('/api/receive', { amount: 1 }); $('#invoice').textContent = r.invoice } catch (e) { $('#invoice').textContent = e.message }
}

// ---------- device sheet: details → pay → follow ----------
let hours = 1
function openDevice (h, s) {
  hours = 1
  $('#dev-title').textContent = s.name
  $('#track').hidden = true
  renderDevice(h, s)
  show('device')
}
function renderDevice (h, s) {
  const [label, cls] = stateOf(s)
  const amount = s.type === 'rent' ? s.price * hours : s.price
  const canPay = !busy && (s.type !== 'access' || !!keyFor(h)) && !['running', 'rented'].includes(s.device?.state)
  const action = s.type === 'access' ? 'Open with my key' : `Pay ${money(amount)} ${DOLLAR}`
  $('#dev-body').replaceChildren(
    el('div', { class: 'row' }, el('span', { style: 'font-size:40px', 'aria-hidden': 'true' }, s.icon || '🧩'),
      el('div', { class: 'grow' }, el('strong', {}, s.name), el('div', { class: 'small muted' }, `${KIND[s.type]} · ${h.name}`)),
      el('span', { class: `pill ${cls}` }, label)),
    el('p', { class: 'muted small' }, priceText(s)),
    s.type === 'rent' ? el('div', { class: 'hours', role: 'group', 'aria-label': 'Hours' },
      ...Array.from({ length: s.maxHours || 4 }, (_, i) => el('button', { type: 'button', 'aria-pressed': String(hours === i + 1), on: { click: () => { hours = i + 1; renderDevice(h, s) } } }, `${i + 1} h`))) : null,
    s.type !== 'access' ? el('div', { class: 'total' }, el('span', {}, 'Total'), el('span', {}, `${money(amount)} ${DOLLAR}`)) : null,
    s.type === 'access' && !keyFor(h) ? el('p', { class: 'small muted' }, `You need a stay key issued by ${h.name} to open this door.`) : null,
    el('p', { class: 'small muted mono' }, `Hub: ${demo ? 'example' : h.url}`),
    el('button', { class: 'btn primary block', type: 'button', disabled: !canPay, on: { click: () => pay(h, s) } }, action))
}

const STEPS = ['Invoice from the hub', 'Paid from your wallet', 'Waiting for Bitcoin confirmation', 'Done']
function track (step, msg, cls, link) {
  $('#track').hidden = false
  $('#track-steps').replaceChildren(...STEPS.map((t, i) => el('li', { class: i < step ? 'done' : i === step ? 'on' : '' }, t)))
  $('#track-msg').replaceChildren(msg ? el('div', { class: `notice ${cls || ''}` }, msg) : '')
  if (link && /^https:\/\//.test(link)) $('#track-link').replaceChildren(el('a', { href: link, target: '_blank', rel: 'noopener', class: 'small' }, 'See the transaction on the explorer'))
}

async function pay (h, s) {
  busy = true; renderDevice(h, s)
  let done = false
  try {
    if (demo) { // example mode: show the steps without touching any wallet
      for (let i = 0; i <= 3; i++) { track(i, i === 3 ? '' : 'Example data: nothing is really paid.'); await new Promise((r) => setTimeout(r, 900)) }
      track(4, s.type === 'access' ? 'The door is open.' : `${s.name} is yours.`, 'ok')
      done = true
      return done
    }
    // A key goes only to the hub that issued it: the key's name starts with that hub's name.
    const key = s.type === 'access' ? keyFor(h) : null
    if (s.type === 'access' && !key) throw new Error(`None of your keys was issued by ${h.name}. Nothing was sent.`)
    const body = s.type === 'access' ? { stayAssetId: key.assetId } : s.type === 'rent' ? { hours } : {}
    track(0, 'Asking the hub for an invoice…')
    const order = await api(`${h.url}/api/services/${encodeURIComponent(s.id)}/order`, body)
    // Pay only what the screen showed: the right asset and the right amount.
    const expected = s.type === 'access' ? { assetId: body.stayAssetId, amount: 1 } : { assetId: dollar()?.assetId, amount: s.price * (s.type === 'rent' ? hours : 1) }
    if (!expected.assetId || order.assetId !== expected.assetId || order.amount !== expected.amount) throw new Error('The hub asked for a different amount or asset than shown. Nothing was paid.')
    track(1, s.type === 'access' ? 'Handing your key to the door…' : `Paying ${money(order.amount)} ${DOLLAR}…`)
    const paid = await api('/api/pay', { invoice: order.invoice, assetId: order.assetId, amount: order.amount })
    track(2, 'Sent. The hub checks it on Bitcoin: about a minute.', '', paid.link)
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 4000))
      if (i % 3 === 0) api('/api/refresh', {}).catch(() => {})
      const o = await api(`${h.url}/api/orders/${encodeURIComponent(order.id)}`)
      if (o.status === 'paid') { done = true; track(4, s.type === 'access' ? 'The door is open. Welcome!' : s.type === 'rent' ? `${s.name} is yours for ${hours} h.` : `${s.name} started.`, 'ok', paid.link); break }
      if (['failed', 'underpaid', 'expired'].includes(o.status)) { track(2, 'The hub did not accept this payment. Nothing was activated.', 'bad', paid.link); break }
    }
  } catch (e) {
    track(0, e.message, 'bad')
  } finally {
    busy = false
    await load()
    const fresh = hubs.find((x) => x.url === h.url)?.services.find((x) => x.id === s.id)
    if (fresh && !$('#device').hidden) renderDevice(h, fresh)
  }
  return done
}

// ---------- "Ask the laundry": the hub's local AI turns a sentence into a bundle ----------
// POST <hub>/api/ai/bundle { text } → [{ serviceId, hours? }]. The AI only picks services; code computes the total.
async function ask (text) {
  const h = hubs[0]
  if (!h || !text.trim()) return
  $('#ask-out').replaceChildren(el('p', { class: 'small muted' }, 'The laundry is thinking (local AI)…'))
  let items
  try {
    items = demo ? [{ serviceId: 'washer' }, { serviceId: 'dryer' }] : await api(`${h.url}/api/ai/bundle`, { text })
  } catch (e) { $('#ask-out').replaceChildren(el('div', { class: 'notice bad' }, e.message)); return }
  // Keep only known pay-per-use devices with a valid price, each at most once.
  const seen = new Set()
  const lines = (Array.isArray(items) ? items : [])
    .map((it) => h.services.find((s) => s.id === it.serviceId && s.type === 'use' && Number.isInteger(s.price) && s.price > 0))
    .filter((s) => s && !seen.has(s.id) && seen.add(s.id))
  if (!lines.length) { $('#ask-out').replaceChildren(el('p', { class: 'small muted' }, 'No matching device. Try "a wash and then the dryer".')); return }
  const total = lines.reduce((sum, s) => sum + s.price, 0)
  $('#ask-out').replaceChildren(el('div', { class: 'card' },
    el('span', { class: 'label' }, 'Proposed by the laundry'),
    el('div', { class: 'list' }, ...lines.map((s) => el('div', {}, el('span', { 'aria-hidden': 'true' }, s.icon), el('span', { class: 'grow' }, s.name), el('span', { class: 'mono' }, `${money(s.price)} ${DOLLAR}`)))),
    el('div', { class: 'total' }, el('span', {}, 'Total'), el('span', {}, `${money(total)} ${DOLLAR}`)),
    el('button', { class: 'btn primary block', type: 'button', on: { click: () => payBundle(h, lines, total) } }, `Pay ${money(total)} ${DOLLAR}`)))
}
// One device after the other: the second payment starts when the first is confirmed
// (the guest's dollars sit on one UTXO, which is busy until the first transfer settles).
// Never pays more than the total the guest approved: each payment is checked against what is left.
async function payBundle (h, list, approved) {
  let left = approved
  for (const s of list) {
    if (s.price > left) break
    openDevice(h, s)
    const ok = await pay(h, s)
    if (!ok) break
    left -= s.price
  }
}
$('#ask-form').addEventListener('submit', (e) => { e.preventDefault(); ask($('#ask-text').value) })

load()
setInterval(() => { if (!busy && $('#device').hidden) load() }, 6000)
