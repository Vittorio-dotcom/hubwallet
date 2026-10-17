// HubWallet guest app logic.
// - Wallets: a list of WDK wallet services (src/guest.js: /api/me, /api/receive, /api/pay, /api/refresh, /api/transfers),
//   kept on this device. Swiping the wallet card changes the active wallet; payments use the active one.
// - Hubs: public API (/api/services, /api/services/:id/order, /api/orders/:id). A hub is added only after the guest
//   confirms it (search bar or QR link), and can be used from a distance.
// - If no hub answers, example devices are shown, marked "Example data".

const $ = (s) => document.querySelector(s)
const money = (cents) => (Number(cents || 0) / 100).toFixed(2)
const DOLLAR = 'HUSD'
const EXAMPLE_WALLET = 'example:wallet'

// ---------- storage (per device, best effort) ----------
const load_ = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const save_ = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }

// ---------- DOM helper: elements with text only (no HTML injection) ----------
// Fills a node, skipping null/false parts (native replaceChildren would print them as the text "null").
const fill = (node, ...parts) => node.replaceChildren(...parts.flat().filter((x) => x !== null && x !== undefined && x !== false))
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
const normUrl = (v) => {
  let u = String(v || '').trim().replace(/\/$/, '')
  if (u && !/^https?:\/\//.test(u)) u = 'http://' + u
  return /^https?:\/\/[^/\s]+$/.test(u) ? u : null
}

// ---------- example data (only for trying the page without a backend) ----------
const EXAMPLE = {
  me: { address: 'tb1p…example', btc: { vanilla: { spendable: 48210 } },
    assets: { nia: [{ assetId: 'rgb:example-husd', ticker: DOLLAR, name: 'HubWallet test dollar', balance: { spendable: 10000 } }] } },
  transfers: [{ kind: 'ReceiveBlind', status: 'Settled', assignments: [{ Fungible: 10000 }], createdAt: Date.now() / 1000 - 3600 }],
  hubs: [{ url: 'example', name: 'Lavanderia', services: [
    { id: 'washer', name: 'Washing machine', icon: '🧺', type: 'use', price: 200, device: { state: 'idle' } },
    { id: 'dryer', name: 'Dryer', icon: '🌀', type: 'use', price: 150, device: { state: 'idle' } }
  ] }]
}
const PROVIDERS = [
  { name: 'Iris Wallet', note: 'Android, by the RGB-Tools team', url: 'https://iriswallet.com' },
  { name: 'BitMask', note: 'browser extension and web', url: 'https://bitmask.app' },
  { name: 'KaleidoSwap', note: 'desktop, mobile (Rate) and browser extension', url: 'https://kaleidoswap.com' }
]

// ---------- state ----------
let wallets = load_('wallets', []) // [{ url, label }]
let active = Math.min(load_('activeWallet', 0), Math.max(0, wallets.length - 1))
let hubUrls = load_('hubUrls', [])
let offered = (new URLSearchParams(location.search).get('hubs') || '').split(',').map(normUrl).filter((u) => u && !hubUrls.includes(u))
const walletData = {} // url → { me, transfers, ok }
let hubs = []; let demoHubs = false; let busy = false; let query = ''

const current = () => wallets[active]
const data = () => walletData[current()?.url] || null
const dollar = (d = data()) => (d?.me?.assets?.nia || []).find((a) => a.ticker === DOLLAR)
const keys = () => (data()?.me?.assets?.nia || []).filter((a) => a.ticker.startsWith('STAY') && a.balance.spendable > 0)
const walletApi = (path, body) => current().url === EXAMPLE_WALLET ? Promise.reject(new Error('Example wallet: nothing is really paid.')) : api(current().url + path, body)

async function loadWallet (w) {
  if (w.url === EXAMPLE_WALLET) { walletData[w.url] = { me: EXAMPLE.me, transfers: EXAMPLE.transfers, ok: true }; return }
  try {
    const me = await api(w.url + '/api/me')
    const transfers = await api(w.url + '/api/transfers').catch(() => [])
    walletData[w.url] = { me, transfers, ok: true }
  } catch { walletData[w.url] = { ok: false } }
}
async function loadHubs () {
  const found = []
  for (const url of hubUrls) { try { const h = await api(url + '/api/services'); found.push({ url, name: h.name, services: h.services || [] }) } catch {} }
  demoHubs = found.length === 0
  hubs = demoHubs ? EXAMPLE.hubs : found
}
async function refresh () {
  await Promise.all([...wallets.map(loadWallet), loadHubs()])
  render()
}

// ---------- rendering ----------
const KIND = { access: 'Access', use: 'Pay per use', rent: 'Rental' }
function stateOf (s) {
  const st = s.device?.state
  if (s.type === 'access') return st === 'open' ? ['Open', 'on'] : ['Locked', 'free']
  if (s.type === 'use') return st === 'running' ? ['Running', 'busy'] : ['Ready', 'free']
  if (st === 'rented') return [`Rented · ${Math.max(0, Math.ceil(((s.device.until || 0) - Date.now()) / 1000))} s`, 'busy']
  return ['Available', 'free']
}
const priceText = (s) => s.type === 'access' ? 'With your key' : `${money(s.price)} ${DOLLAR} ${s.type === 'rent' ? '/ hour' : '/ use'}`

function walletCard (w, i) {
  const d = walletData[w.url]
  if (!d?.ok) {
    return el('div', { class: 'wcard off', role: 'group', 'aria-label': `Wallet ${i + 1}` },
      el('span', { class: 'label' }, w.label || 'Wallet'),
      el('strong', {}, 'Not reachable'),
      el('span', { class: 'small' }, w.url),
      el('div', { class: 'row' }, el('button', { class: 'btn', type: 'button', on: { click: refresh } }, 'Retry'),
        el('button', { class: 'btn', type: 'button', on: { click: () => removeWallet(i) } }, 'Remove')))
  }
  return el('button', { class: 'wcard', type: 'button', 'aria-label': `${w.label}: open movements, address and keys`, on: { click: () => { if (i === active) show('wallet') } } },
    el('span', { class: 'label' }, w.label || 'Wallet'),
    el('span', {}, el('span', { class: 'amount' }, money(dollar(d)?.balance.spendable || 0)), ' ', el('span', { class: 'unit' }, DOLLAR)),
    el('span', { class: 'hint' }, `${(d.me.btc?.vanilla?.spendable ?? 0).toLocaleString('en')} sats for fees · details ›`))
}

function render () {
  $('#demo-tag').hidden = !demoHubs && current()?.url !== EXAMPLE_WALLET

  // offered hubs (from a QR link): connect only after confirmation
  fill($('#offer'), ...offered.map((url) => el('div', { class: 'card' },
    el('span', { class: 'label' }, 'Hub from a link'), el('span', { class: 'mono' }, url),
    el('p', { class: 'small muted' }, 'Connect only if you trust this hub (for example you scanned its QR code).'),
    el('div', { class: 'row' },
      el('button', { class: 'btn primary', type: 'button', on: { click: () => addHub(url) } }, 'Connect'),
      el('button', { class: 'btn', type: 'button', on: { click: () => { offered = offered.filter((x) => x !== url); render() } } }, 'Ignore')))))

  // wallet carousel
  const cards = wallets.map(walletCard)
  cards.push(el('button', { class: 'wcard add', type: 'button', on: { click: () => show('connect') } },
    el('span', { class: 'label' }, wallets.length ? 'Add a wallet' : 'No wallet yet'),
    el('strong', { style: 'font-size:22px' }, wallets.length ? '+ Add wallet' : 'Connect a wallet'),
    el('span', { class: 'hint' }, 'HubWallet (WDK) or another RGB wallet ›')))
  const car = $('#wallets'); const keep = car.scrollLeft
  fill(car, ...cards)
  car.scrollLeft = keep
  fill($('#dots'), ...cards.map((_, i) => el('span', { class: i === active ? 'on' : '' })))

  // devices of the connected hubs, filtered by the search text
  const q = query.toLowerCase()
  const tiles = hubs.flatMap((h) => h.services.filter((s) => KIND[s.type]).map((s) => ({ h, s })))
    .filter(({ h, s }) => !q || h.name.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
  fill($('#devices'), ...(tiles.length
    ? tiles.map(({ h, s }) => {
        const [label, cls] = stateOf(s)
        return el('button', { class: 'tile', type: 'button', on: { click: () => openDevice(h, s) }, 'aria-label': `${s.name}, ${priceText(s)}` },
          el('span', { class: 'ic', 'aria-hidden': 'true' }, s.icon || '🧩'), el('span', { class: 'name' }, s.name),
          el('span', { class: 'price' }, priceText(s)), el('span', { class: `pill ${cls}` }, label), el('span', { class: 'where' }, h.name))
      })
    : [el('div', { class: 'empty', style: 'grid-column:1/-1' }, q ? 'No device matches your search.' : 'No hub connected. Search a hub above or scan its QR code.')]))

  // wallet sheet (active wallet)
  const d = data()
  $('#wallet-title').textContent = current()?.label || 'Wallet'
  $('#address').textContent = d?.me?.address || '–'
  const tr = d?.transfers || []
  fill($('#moves'), ...(tr.length
    ? [...tr].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map((t) => {
        const amt = (t.assignments || []).reduce((s, a) => s + Number(a.Fungible || 0), 0) || Number(t.requestedAssignment?.Fungible || 0)
        const kind = typeof t.kind === 'number' ? ['Issuance', 'ReceiveBlind', 'ReceiveWitness', 'Send', 'Inflation'][t.kind] : t.kind
        const status = typeof t.status === 'number' ? ['WaitingCounterparty', 'WaitingConfirmations', 'Settled', 'Failed'][t.status] : t.status
        const incoming = String(kind).startsWith('Receive') || kind === 'Issuance'
        const when = t.createdAt ? new Date(t.createdAt * 1000).toLocaleString('en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
        return el('div', {}, el('span', { 'aria-hidden': 'true' }, incoming ? '↓' : '↑'),
          el('div', { class: 'grow' }, el('div', {}, incoming ? 'Received' : 'Sent'), el('div', { class: 'small muted' }, `${when} · ${status}`)),
          el('span', { class: 'mono' }, money(amt)),
          t.txid ? el('a', { href: 'https://mutinynet.com/tx/' + t.txid, target: '_blank', rel: 'noopener', class: 'small' }, 'tx') : null)
      })
    : [el('div', { class: 'empty' }, 'No movements yet.')]))
  fill($('#tab-keys'), ...(keys().length
    ? keys().map((a) => el('div', { class: 'key' }, el('span', { class: 'label' }, 'Key · RGB asset'), el('strong', {}, a.name), el('span', { class: 'mono' }, a.ticker)))
    : [el('div', { class: 'empty' }, 'No access keys in this wallet.')]))

  // user + connect sheets
  fill($('#wallet-list'), ...(wallets.length ? wallets.map((w, i) => el('div', {}, el('span', { class: 'grow' }, w.label), el('span', { class: 'small muted mono' }, w.url === EXAMPLE_WALLET ? 'example' : w.url),
    el('button', { class: 'btn', type: 'button', on: { click: () => removeWallet(i) } }, 'Remove'))) : [el('div', { class: 'small muted' }, 'No wallet connected.')]))
  fill($('#hub-list'), ...(hubUrls.length ? hubUrls.map((u) => el('div', {}, el('span', { class: 'grow mono small' }, u),
    el('button', { class: 'btn', type: 'button', on: { click: () => { hubUrls = hubUrls.filter((x) => x !== u); save_('hubUrls', hubUrls); refresh() } } }, 'Remove'))) : [el('div', { class: 'small muted' }, 'No hub connected.')]))
  fill($('#providers'), ...PROVIDERS.map((p) => el('div', {}, el('div', { class: 'grow' }, el('div', {}, p.name), el('div', { class: 'small muted' }, `${p.note} · not supported in the demo`)),
    el('a', { href: p.url, target: '_blank', rel: 'noopener', class: 'small' }, 'Website'))))
}

// ---------- carousel: the visible card is the active wallet ----------
$('#wallets').addEventListener('scroll', () => {
  const car = $('#wallets')
  const i = Math.round(car.scrollLeft / car.clientWidth)
  if (i !== active && i < wallets.length) { active = i; save_('activeWallet', active); render() }
}, { passive: true })

// ---------- wallets ----------
async function addWallet (url, label) {
  if (wallets.some((w) => w.url === url)) { fill($('#connect-msg'), el('div', { class: 'notice bad' }, 'This wallet is already connected.')); return }
  const w = { url, label: label || `Wallet ${wallets.length + 1}` }
  await loadWallet(w)
  if (!walletData[url].ok) { fill($('#connect-msg'), el('div', { class: 'notice bad' }, `No wallet answers at ${url}.`)); return }
  wallets.push(w); active = wallets.length - 1
  save_('wallets', wallets); save_('activeWallet', active)
  show(null); render()
  $('#wallets').scrollLeft = active * $('#wallets').clientWidth
}
function removeWallet (i) {
  wallets.splice(i, 1); active = Math.max(0, Math.min(active, wallets.length - 1))
  save_('wallets', wallets); save_('activeWallet', active); render()
}
$('#connect-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const url = normUrl($('#wallet-url').value)
  if (!url) { fill($('#connect-msg'), el('div', { class: 'notice bad' }, 'Enter an address like http://127.0.0.1:8090.')); return }
  addWallet(url, 'HubWallet')
})
$('#example-wallet').onclick = () => addWallet(EXAMPLE_WALLET, 'Example wallet')

// ---------- hubs: search by name, or connect by address ----------
function addHub (url) {
  if (!hubUrls.includes(url)) hubUrls.push(url)
  offered = offered.filter((x) => x !== url)
  save_('hubUrls', hubUrls); fill($('#search-out'), ); refresh()
}
$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const text = $('#search').value.trim()
  const url = /[.:]/.test(text) ? normUrl(text) : null
  if (!url) { query = text; render(); return } // a name: filter the connected hubs and their devices
  query = ''
  fill($('#search-out'), el('p', { class: 'small muted' }, `Looking for a hub at ${url}…`))
  try {
    const info = await api(url + '/api/hub/info') // public: { name, network, hubKey }
    const h = await api(url + '/api/services').catch(() => ({ services: [] }))
    fill($('#search-out'), el('div', { class: 'card' },
      el('span', { class: 'label' }, 'Hub found'), el('strong', {}, info.name || 'Unnamed hub'), el('span', { class: 'mono small' }, url),
      el('span', { class: 'small muted' }, `${(h.services || []).length} devices · network ${info.network || '?'}`),
      hubUrls.includes(url) ? el('span', { class: 'small' }, 'Already connected.')
        : el('button', { class: 'btn primary', type: 'button', on: { click: () => addHub(url) } }, 'Connect to this hub')))
  } catch { fill($('#search-out'), el('div', { class: 'notice bad' }, `No hub answers at ${url}.`)) }
})
$('#search').addEventListener('input', (e) => { if (!/[.:]/.test(e.target.value)) { query = e.target.value.trim(); render() } })

// ---------- sheets and tabs ----------
function show (id) { document.querySelectorAll('.sheet').forEach((s) => { s.hidden = s.id !== id }); $('#home').hidden = !!id }
document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) show(null) })
$('#open-user').onclick = () => show('user')
$('#reload').onclick = async () => { if (current() && current().url !== EXAMPLE_WALLET) await walletApi('/api/refresh', {}).catch(() => {}); refresh() }
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)))
  for (const t of ['moves', 'address', 'keys']) $('#tab-' + t).hidden = t !== b.dataset.tab
}))
$('#copy-address').onclick = async () => { try { await navigator.clipboard.writeText($('#address').textContent); $('#copy-address').textContent = 'Copied' } catch { getSelection().selectAllChildren($('#address')) } }
$('#make-invoice').onclick = async () => {
  try { const r = await walletApi('/api/receive', { amount: 1 }); $('#invoice').textContent = r.invoice } catch (e) { $('#invoice').textContent = e.message }
}

// ---------- device: details → pay with the active wallet → follow ----------
let hours = 1
function openDevice (h, s) { hours = 1; $('#dev-title').textContent = s.name; $('#track').hidden = true; renderDevice(h, s); show('device') }
function renderDevice (h, s) {
  const [label, cls] = stateOf(s)
  const amount = s.type === 'rent' ? s.price * hours : s.price
  const w = current()
  const canPay = !busy && !!w && !['running', 'rented'].includes(s.device?.state) && s.type !== 'access'
  fill($('#dev-body'), 
    el('div', { class: 'row' }, el('span', { style: 'font-size:40px', 'aria-hidden': 'true' }, s.icon || '🧩'),
      el('div', { class: 'grow' }, el('strong', {}, s.name), el('div', { class: 'small muted' }, `${KIND[s.type]} · ${h.name}`)),
      el('span', { class: `pill ${cls}` }, label)),
    el('p', { class: 'muted small' }, priceText(s)),
    s.type === 'rent' ? el('div', { class: 'hours', role: 'group', 'aria-label': 'Hours' },
      ...Array.from({ length: s.maxHours || 4 }, (_, i) => el('button', { type: 'button', 'aria-pressed': String(hours === i + 1), on: { click: () => { hours = i + 1; renderDevice(h, s) } } }, `${i + 1} h`))) : null,
    el('div', { class: 'total' }, el('span', {}, 'Total'), el('span', {}, `${money(amount)} ${DOLLAR}`)),
    el('p', { class: 'small muted' }, w ? `Paid from: ${w.label}` : 'Connect a wallet to pay.'),
    el('p', { class: 'small muted mono' }, `Hub: ${demoHubs ? 'example' : h.url}`),
    w ? el('button', { class: 'btn primary block', type: 'button', disabled: !canPay, on: { click: () => pay(h, s) } }, `Pay ${money(amount)} ${DOLLAR}`)
      : el('button', { class: 'btn primary block', type: 'button', on: { click: () => show('connect') } }, 'Connect a wallet'))
}
const STEPS = ['Invoice from the hub', 'Paid from your wallet', 'Waiting for Bitcoin confirmation', 'Done']
function track (step, msg, cls, link) {
  $('#track').hidden = false
  fill($('#track-steps'), ...STEPS.map((t, i) => el('li', { class: i < step ? 'done' : i === step ? 'on' : '' }, t)))
  fill($('#track-msg'), msg ? el('div', { class: `notice ${cls || ''}` }, msg) : '')
  fill($('#track-link'), link && /^https:\/\//.test(link) ? el('a', { href: link, target: '_blank', rel: 'noopener', class: 'small' }, 'See the transaction on the explorer') : '')
}
// Payment flow of API_usage.md §4 (payer wallet = src/guest.js):
//   1. the hub creates the payment request (service layer: POST /api/services/:id/order → id = payment id)
//   2. /api/check: the WALLET decodes the hub's RGB invoice itself and returns what would be paid. Nothing is signed.
//   3. the guest confirms exactly that (description, amount, hub)
//   4. /api/pay-request with `expect`: if the hub changed anything, the wallet refuses
//   5. follow the public GET <hub>/api/payments/:id until 'paid', then keep the hub's signed receipt (/api/proof)
const FINAL_BAD = { underpaid: 'The hub received less than asked.', failed: 'The transfer failed.', expired: 'The payment request expired.', wrong_asset: 'The hub received a different asset.' }
async function pay (h, s) {
  busy = true; renderDevice(h, s)
  try {
    if (demoHubs || current().url === EXAMPLE_WALLET) { // example mode: show the steps, move nothing
      for (let i = 0; i <= 3; i++) { track(i, 'Example data: nothing is really paid.'); await new Promise((r) => setTimeout(r, 900)) }
      track(4, `${s.name} started.`, 'ok'); return
    }
    track(0, 'Asking the hub for a payment request…')
    const order = await api(`${h.url}/api/services/${encodeURIComponent(s.id)}/order`, s.type === 'rent' ? { hours } : {})
    const paymentId = order.id
    // 2. what the wallet itself reads in the hub's invoice
    const c = await walletApi('/api/check', { hubUrl: h.url, paymentId })
    const shown = s.price * (s.type === 'rent' ? hours : 1)
    if (c.amount !== shown || c.assetId !== dollar()?.assetId) throw new Error(`The hub asks for ${money(c.amount)} instead of ${money(shown)} ${DOLLAR}, or for another asset. Nothing was paid.`)
    // 3. explicit confirmation of what the wallet checked
    const ok = await confirmPay(c, h)
    if (!ok) { track(0, 'Payment cancelled. Nothing was paid.'); return }
    track(1, `Paying ${money(c.amount)} ${DOLLAR}…`)
    // 4. pay exactly what was confirmed
    const paid = await walletApi('/api/pay-request', { hubUrl: h.url, paymentId, expect: { assetId: c.assetId, amount: c.amount } })
    track(2, 'Sent. The hub checks it on Bitcoin: about a minute.', '', paid.link)
    // 5. follow the hub's public payment record
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000))
      if (i % 2 === 0) walletApi('/api/refresh', {}).catch(() => {})
      const p = await api(`${h.url}/api/payments/${encodeURIComponent(paymentId)}`)
      if (p.status === 'paid') {
        let receipt = ''
        try { const pr = await walletApi(`/api/proof?hubUrl=${encodeURIComponent(h.url)}&paymentId=${encodeURIComponent(paymentId)}`); receipt = pr.valid ? ' Receipt signed by the hub and saved in your wallet.' : '' } catch {}
        track(4, `${s.name} started.${receipt}`, 'ok', p.link || paid.link)
        break
      }
      if (FINAL_BAD[p.status]) { track(2, FINAL_BAD[p.status] + ' Nothing was started.', 'bad', p.link || paid.link); break }
    }
  } catch (e) { track(0, e.message, 'bad') } finally {
    busy = false
    await refresh()
    const fresh = hubs.find((x) => x.url === h.url)?.services.find((x) => x.id === s.id)
    if (fresh && !$('#device').hidden) renderDevice(h, fresh)
  }
}

// In-page confirmation (browser confirm() dialogs are not used): resolves true/false.
function confirmPay (c, h) {
  return new Promise((resolve) => {
    $('#track').hidden = false
    fill($('#track-msg'), el('div', { class: 'card' },
      el('span', { class: 'label' }, 'Checked by your wallet'),
      el('strong', {}, `Pay ${money(c.amount)} ${DOLLAR} to ${c.hub || h.name}`),
      el('span', { class: 'small' }, c.description || ''),
      el('span', { class: 'small muted mono' }, `Asset ${c.assetId}`),
      el('div', { class: 'row' },
        el('button', { class: 'btn primary', type: 'button', on: { click: () => resolve(true) } }, 'Confirm and pay'),
        el('button', { class: 'btn', type: 'button', on: { click: () => resolve(false) } }, 'Cancel'))))
  })
}

// served by a wallet service? use it as the first wallet
if (!wallets.length) {
  api('/api/me').then(() => { wallets = [{ url: location.origin, label: 'HubWallet' }]; save_('wallets', wallets); refresh() }).catch(() => {})
}
refresh()
setInterval(() => { if (!busy && $('#device').hidden) refresh() }, 20000) // the hub blocks while rgb-lib syncs: poll gently
