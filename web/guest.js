// HubWallet guest app logic.
// - Wallets: a list of WDK wallet services (src/guest.js: /api/me, /api/receive, /api/check, /api/pay-request, /api/refresh,
//   /api/transfers, /api/proof), kept on this device. Swiping the wallet pass changes the active wallet; payments use it.
// - Hubs: public API (/api/services, /api/services/:id/order, /api/payments/:id). A hub is added only after the guest
//   confirms it (search field or QR link), and can be used from a distance.
// - Example devices only with the example wallet ("Try with an example wallet"), marked "Example data".
//   Otherwise no hub = an empty list that says so, and a hub that does not answer is named.
import { el, fill, money, DOLLAR, icon, porthole, statusOf, clock, themeButton, lens } from './ui.js'
import { liquid, morphTopbar, droplet, tabbar, morphOpen, morphClose } from './liquid.js'

const $ = (s) => document.querySelector(s)
const EXAMPLE_WALLET = 'example:wallet'

// ---------- storage (per device, best effort) ----------
const load_ = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const save_ = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }

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
    { id: 'washer', name: 'Washing machine', icon: 'washer', type: 'use', price: 300, unit: 'wash', state: { status: 'idle' } },
    { id: 'dryer', name: 'Dryer', icon: 'dryer', type: 'use', price: 200, unit: 'cycle', state: { status: 'running', until: Date.now() + 42000 } }
  ] }]
}
const PROVIDERS = [
  { name: 'Iris Wallet', note: 'Android, by the RGB-Tools team', url: 'https://iriswallet.com' },
  { name: 'BitMask', note: 'Browser extension and web', url: 'https://bitmask.app' },
  { name: 'KaleidoSwap', note: 'Desktop, mobile and browser extension', url: 'https://kaleidoswap.com' }
]

// ---------- state ----------
let wallets = load_('wallets', []) // [{ url, label }]
let active = Math.min(load_('activeWallet', 0), Math.max(0, wallets.length - 1))
let hubUrls = load_('hubUrls', [])
let offered = (new URLSearchParams(location.search).get('hubs') || '').split(',').map(normUrl).filter((u) => u && !hubUrls.includes(u))
const walletData = {} // url → { me, transfers, ok }
let hubs = []; let demoHubs = false; let busy = false; let query = ''
let silentHubs = [] // connected hubs that did not answer the last refresh
// Payments sent and still followed (or just finished, until the guest has seen the result):
// [{ hubUrl, serviceId, name, paymentId, amount, link, at, step, msg, cls, done }]
let pending = load_('pending', []).filter((p) => Date.now() - p.at < 30 * 60_000)
const pendingFor = (h, s) => pending.find((p) => p.hubUrl === h.url && p.serviceId === s.id)
const savePending = () => save_('pending', pending)

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
  silentHubs = hubUrls.filter((u) => !found.some((h) => h.url === u))
  demoHubs = found.length === 0 && current()?.url === EXAMPLE_WALLET // fake machines only for the fake wallet
  hubs = demoHubs ? EXAMPLE.hubs : found
}
async function refresh () {
  await Promise.all([...wallets.map(loadWallet), loadHubs()])
  render()
}

// ---------- words ----------
const KIND = { access: 'Access', use: 'Pay per use', rent: 'Rental' }
const per = (s) => s.type === 'rent' ? 'hour' : (s.unit || 'use')
const priceText = (s) => s.type === 'access' ? 'Opens with your key'
  : s.options?.length ? `From ${money(Math.min(...s.options.map((o) => o.price)))} ${DOLLAR} · ${s.options.map((o) => o.name).join(', ')}`
    : `${money(s.price)} ${DOLLAR} per ${per(s)}`
// the option picked on a machine with options (espresso / cappuccino); the first one until the guest picks
let choice = null
const optionOf = (s) => s.options?.length ? (s.options.find((o) => o.id === choice) || s.options[0]) : null
const stateText = (s) => {
  const st = statusOf(s)
  if (s.type === 'access') return st.key === 'busy' ? 'Open' : 'Locked'
  if (st.key === 'busy') return st.until ? `In use · ${clock(st.until)}` : 'In use'
  if (st.key === 'locked') return 'Locked now'
  return 'Available'
}
const badge = (s, h) => {
  const p = h && pendingFor(h, s)
  if (p && !p.done) return el('span', { class: 'badge busy' }, 'Your payment · confirming')
  if (p?.done) return el('span', { class: `badge ${p.cls === 'ok' ? 'free' : 'locked'}` }, p.cls === 'ok' ? 'Paid · tap to see' : 'Payment problem · tap')
  return el('span', { class: `badge ${statusOf(s).key}` }, stateText(s))
}
const canOrder = (s) => s.type !== 'access' && statusOf(s).key === 'free'

// ---------- rendering ----------
function walletPass (w, i) {
  const d = walletData[w.url]
  if (!d?.ok) {
    return el('div', { class: 'pass off', role: 'group', 'aria-label': `${w.label || 'Wallet'}, not reachable` },
      el('div', { class: 'pass-top' }, icon('alert', { size: 18 }), w.label || 'Wallet'),
      el('div', { class: 'stack', style: 'gap:4px' }, el('strong', {}, 'Not reachable'), el('span', { class: 'footnote mono' }, w.url)),
      el('div', { class: 'row' }, el('button', { class: 'btn small', type: 'button', on: { click: refresh } }, 'Try again'),
        el('button', { class: 'btn small danger', type: 'button', on: { click: () => removeWallet(i) } }, 'Remove')))
  }
  return el('button', { class: 'pass', type: 'button', 'aria-label': `${w.label}, ${money(dollar(d)?.balance.spendable || 0)} ${DOLLAR}. Open activity`, on: { click: () => { if (i === active) show('wallet') } } },
    el('div', { class: 'pass-top' }, icon('wallet', { size: 18 }), el('span', { class: 'grow' }, w.label || 'Wallet'), w.url === EXAMPLE_WALLET ? 'Example' : 'WDK'),
    el('div', { class: 'amount' }, money(dollar(d)?.balance.spendable || 0), el('small', {}, DOLLAR)),
    el('div', { class: 'pass-foot' }, el('span', {}, `${(d.me.btc?.vanilla?.spendable ?? 0).toLocaleString('en')} sats for network fees`), el('span', {}, 'Activity')))
}

function render () {
  $('#demo-tag').hidden = !demoHubs && current()?.url !== EXAMPLE_WALLET
  const names = [...new Set(hubs.map((h) => h.name))]
  $('#greeting').textContent = names.length === 1 ? names[0] : 'Nearby'

  // offered hubs (from a QR link): connect only after confirmation
  $('#offer').hidden = !offered.length
  fill($('#offer'), offered.map((url) => el('div', { class: 'confirm' },
    el('div', { class: 'row' }, el('span', { class: 'cell-icon' }, icon('hub', { size: 16 })), el('div', { class: 'grow' }, el('h3', {}, 'Connect this hub?'), el('div', { class: 'footnote mono' }, url))),
    el('p', { class: 'footnote' }, 'You scanned its code. Connect only if you are at this place and trust it.'),
    el('div', { class: 'form-row' },
      el('button', { class: 'btn primary grow', type: 'button', on: { click: () => addHub(url) } }, 'Connect'),
      el('button', { class: 'btn grow', type: 'button', on: { click: () => { offered = offered.filter((x) => x !== url); render() } } }, 'Not now')))))

  // wallet passes
  const cards = wallets.map(walletPass)
  cards.push(el('button', { class: 'pass add', type: 'button', on: { click: () => show('connect') } },
    el('span', { class: 'plus' }, icon('plus', { size: 24 })),
    el('h3', {}, wallets.length ? 'Add another wallet' : 'Add your wallet'),
    el('span', { class: 'footnote' }, 'HubWallet or another RGB wallet')))
  const car = $('#wallets'); const keep = car.scrollLeft
  fill(car, cards)
  car.scrollLeft = keep
  fill($('#dots'), cards.map((_, i) => el('span', { class: i === active ? 'on' : '' })))
  lens([...car.querySelectorAll('.pass:not(.add)')])

  // machines of the connected hubs, filtered by the search text
  const q = query.toLowerCase()
  const items = hubs.flatMap((h) => h.services.filter((s) => KIND[s.type]).map((s) => ({ h, s })))
    .filter(({ h, s }) => !q || h.name.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
  const many = names.length > 1
  fill($('#devices'), items.length
    ? el('div', { class: 'group arts' }, items.map(({ h, s }) => el('button', { class: 'cell', type: 'button', on: { click: (e) => openDevice(h, s, e.currentTarget) }, 'aria-label': `${s.name}, ${priceText(s)}, ${stateText(s)}` },
        porthole(s, { size: 48 }),
        el('div', { class: 'grow stack', style: 'gap:4px' }, el('div', { class: 'title' }, s.name), el('div', { class: 'sub' }, many ? `${priceText(s)} · ${h.name}` : priceText(s)), el('div', {}, badge(s, h))),
        el('span', { class: 'chev' }, icon('chevronRight', { size: 18 })))))
    : el('div', { class: 'group' }, el('div', { class: 'empty' }, icon(silentHubs.length && !q ? 'alert' : 'search', { size: 32 }),
        el('h3', {}, q ? 'No machine matches' : silentHubs.length ? 'The hub does not answer' : 'No hub connected'),
        el('p', { class: 'footnote' }, q ? 'Try another name.'
          : silentHubs.length ? `No answer from ${silentHubs.join(', ')}. It may be off, or busy for a few seconds. Try again.`
            : 'Scan the code on a machine, or connect a hub below.'),
        silentHubs.length && !q ? el('button', { class: 'btn small', type: 'button', on: { click: refresh } }, 'Try again') : null)))

  // wallet sheet (active wallet)
  const d = data()
  $('#wallet-title').textContent = current()?.label || 'Wallet'
  $('#address').textContent = d?.me?.address || '–'
  const tr = d?.transfers || []
  fill($('#moves'), tr.length
    ? [...tr].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map((t) => {
        const amt = (t.assignments || []).reduce((s, a) => s + Number(a.Fungible || 0), 0) || Number(t.requestedAssignment?.Fungible || 0)
        const kind = typeof t.kind === 'number' ? ['Issuance', 'ReceiveBlind', 'ReceiveWitness', 'Send', 'Inflation'][t.kind] : t.kind
        const status = typeof t.status === 'number' ? ['WaitingCounterparty', 'WaitingConfirmations', 'Settled', 'Failed'][t.status] : t.status
        const incoming = String(kind).startsWith('Receive') || kind === 'Issuance'
        const when = t.createdAt ? new Date(t.createdAt * 1000).toLocaleString('en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
        const pending = status !== 'Settled'
        return el('div', { class: 'cell' },
          el('span', { class: `cell-icon ${incoming ? 'green' : 'gray'}` }, icon(incoming ? 'arrowDown' : 'arrowUp', { size: 16 })),
          el('div', { class: 'grow' }, el('div', { class: 'title' }, incoming ? 'Received' : 'Paid'), el('div', { class: 'sub' }, pending ? `${when} · confirming` : when)),
          el('span', { class: 'value num' }, `${incoming ? '+' : '−'}${money(amt)}`),
          t.txid ? el('a', { href: 'https://mutinynet.com/tx/' + t.txid, target: '_blank', rel: 'noopener', 'aria-label': 'See on the explorer' }, icon('external', { size: 16 })) : null)
      })
    : el('div', { class: 'empty' }, icon('clock', { size: 28 }), el('p', {}, 'No activity yet.')))
  fill($('#tab-keys'), keys().length
    ? el('div', { class: 'group' }, keys().map((a) => el('div', { class: 'cell' }, el('span', { class: 'cell-icon orange' }, icon('key', { size: 16 })),
        el('div', { class: 'grow' }, el('div', { class: 'title' }, a.name), el('div', { class: 'sub mono' }, a.ticker)))))
    : el('div', { class: 'group' }, el('div', { class: 'empty' }, icon('key', { size: 28 }), el('p', {}, 'No access keys in this wallet.'))))

  // profile + connect sheets
  fill($('#wallet-list'), wallets.length
    ? wallets.map((w, i) => el('div', { class: 'cell' }, el('span', { class: 'cell-icon' }, icon('wallet', { size: 16 })),
        el('div', { class: 'grow' }, el('div', { class: 'title' }, w.label), el('div', { class: 'sub mono' }, w.url === EXAMPLE_WALLET ? 'example' : w.url)),
        el('button', { class: 'btn small danger', type: 'button', on: { click: () => removeWallet(i) } }, 'Remove')))
    : el('div', { class: 'cell' }, el('span', { class: 'muted' }, 'No wallet yet.')))
  fill($('#hub-list'), hubUrls.length
    ? hubUrls.map((u) => el('div', { class: 'cell' }, el('span', { class: 'cell-icon gray' }, icon('hub', { size: 16 })), el('span', { class: 'grow mono' }, u),
        el('button', { class: 'btn small danger', type: 'button', on: { click: () => { hubUrls = hubUrls.filter((x) => x !== u); save_('hubUrls', hubUrls); refresh() } } }, 'Remove')))
    : el('div', { class: 'cell' }, el('span', { class: 'muted' }, 'No hub connected.')))
  fill($('#providers'), PROVIDERS.map((p) => el('a', { class: 'cell', href: p.url, target: '_blank', rel: 'noopener' },
    el('div', { class: 'grow' }, el('div', { class: 'title' }, p.name), el('div', { class: 'sub' }, `${p.note} · not in the demo`)),
    el('span', { class: 'chev' }, icon('external', { size: 16 })))))
}

// ---------- carousel: the visible pass is the active wallet ----------
$('#wallets').addEventListener('scroll', () => {
  const car = $('#wallets')
  const i = Math.round(car.scrollLeft / car.clientWidth)
  if (i !== active && i < wallets.length) { active = i; save_('activeWallet', active); render() }
}, { passive: true })

// ---------- wallets ----------
async function addWallet (url, label) {
  if (wallets.some((w) => w.url === url)) { fill($('#connect-msg'), notice('bad', 'This wallet is already connected.')); return }
  const w = { url, label: label || `Wallet ${wallets.length + 1}` }
  await loadWallet(w)
  if (!walletData[url].ok) { fill($('#connect-msg'), notice('bad', `No wallet answers at ${url}. Check that the wallet service is running.`)); return }
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
  if (!url) { fill($('#connect-msg'), notice('bad', 'Enter an address like http://127.0.0.1:8090.')); return }
  addWallet(url, 'HubWallet')
})
$('#example-wallet').onclick = () => addWallet(EXAMPLE_WALLET, 'Example wallet')

// ---------- hubs: search by name, or connect by address ----------
function addHub (url) {
  if (!hubUrls.includes(url)) hubUrls.push(url)
  offered = offered.filter((x) => x !== url)
  save_('hubUrls', hubUrls); fill($('#search-out')); refresh()
}
$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const text = $('#search').value.trim()
  const url = /[.:]/.test(text) ? normUrl(text) : null
  if (!url) { query = text; render(); return } // a name: filter the connected hubs and their machines
  query = ''
  fill($('#search-out'), el('p', { class: 'footnote' }, `Looking for a hub at ${url}…`))
  try {
    const info = await api(url + '/api/hub/info') // public: { name, network, hubKey }
    const h = await api(url + '/api/services').catch(() => ({ services: [] }))
    fill($('#search-out'), el('div', { class: 'group' }, el('div', { class: 'cell' },
      el('span', { class: 'cell-icon' }, icon('hub', { size: 16 })),
      el('div', { class: 'grow' }, el('div', { class: 'title' }, info.name || 'Unnamed hub'), el('div', { class: 'sub' }, `${(h.services || []).length} machines · ${url.replace(/^https?:\/\//, '')}`)),
      hubUrls.includes(url) ? el('span', { class: 'value' }, 'Connected')
        : el('button', { class: 'btn small primary', type: 'button', on: { click: () => addHub(url) } }, 'Connect'))))
  } catch { fill($('#search-out'), notice('bad', `No hub answers at ${url}.`)) }
})
$('#search').addEventListener('input', (e) => { if (!/[.:]/.test(e.target.value)) { query = e.target.value.trim(); render() } })

// ---------- sheets and tabs ----------
// Sheets grow out of the element that opened them and sink back when closed (web/liquid.js).
async function show (id, from) {
  const open = [...document.querySelectorAll('.sheet')].find((s) => !s.hidden)
  if (open && open.id !== id) { await morphClose(open); open.hidden = true }
  if (id) {
    const sheet = document.getElementById(id); sheet.hidden = false
    const panel = sheet.querySelector('.sheet-panel'); panel.focus({ preventScroll: true }); morphOpen(panel, from)
    if (id === 'wallet') syncSeg()
  }
  document.body.style.overflow = id ? 'hidden' : ''
  setTab(id === 'wallet' || id === 'user' ? id : 'home')
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]') || e.target.classList?.contains('sheet')) { show(null); openDev = null }
})
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !busy) { show(null); openDev = null } })
$('#open-user').onclick = (e) => show('user', e.currentTarget)
$('#reload').onclick = async () => { if (current() && current().url !== EXAMPLE_WALLET) await walletApi('/api/refresh', {}).catch(() => {}); refresh() }
const syncSeg = droplet($('#wallet .seg'), '[data-tab]', (b) => b.getAttribute('aria-selected') === 'true')
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)))
  for (const t of ['moves', 'address', 'keys']) $('#tab-' + t).hidden = t !== b.dataset.tab
  syncSeg()
}))

// floating tab bar: machines (this page), wallet and profile sheets; the droplet follows the current one
const syncTab = droplet($('#tabbar'), '.tab', (b) => b.getAttribute('aria-current') === 'page', 'tab-thumb')
function setTab (go) {
  document.querySelectorAll('.tab').forEach((t) => { if (t.dataset.go === go) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current') })
  syncTab()
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  if (t.dataset.go === 'home') { show(null); scrollTo({ top: 0, behavior: 'smooth' }) } else show(t.dataset.go, t)
}))
$('#copy-address').onclick = async () => { try { await navigator.clipboard.writeText($('#address').textContent); $('#copy-address').textContent = 'Copied' } catch { getSelection().selectAllChildren($('#address')) } }
$('#make-invoice').onclick = async () => {
  try { const r = await walletApi('/api/receive', { amount: 1 }); $('#invoice').textContent = r.invoice } catch (e) { $('#invoice').textContent = e.message }
}
const notice = (kind, text, ...extra) => el('div', { class: `notice ${kind}` }, icon(kind === 'ok' ? 'checkCircle' : kind === 'bad' ? 'alert' : 'info', { size: 18 }), el('div', { class: 'stack', style: 'gap:8px' }, text, ...extra))

// ---------- a machine: details → pay with the active wallet → follow ----------
let hours = 1
let openDev = null
function openDevice (h, s, from) {
  openDev = { h, s }; hours = 1; $('#dev-title').textContent = s.name; $('#track').hidden = true; $('#dev-body').hidden = false; fill($('#track-msg'))
  renderDevice(h, s)
  const p = pendingFor(h, s)
  if (p) {
    track(p.step, p.msg, p.cls, p.link)
    if (p.done) { pending = pending.filter((x) => x !== p); savePending(); render() } // result seen: forget it
  }
  show('device', from)
}
function renderDevice (h, s) {
  const st = statusOf(s)
  const opt = optionOf(s)
  const amount = opt ? opt.price : s.type === 'rent' ? s.price * hours : s.price
  const w = current()
  const canPay = !busy && !!w && canOrder(s) && !pendingFor(h, s)
  fill($('#dev-body'),
    el('div', { class: 'device-hero' }, porthole(s, { size: 132 }),
      el('div', { class: 'stack', style: 'align-items:center;gap:6px' }, badge(s), el('span', { class: 'footnote' }, `${KIND[s.type]} at ${h.name}`))),
    s.type === 'access' ? null : el('div', { class: 'stack', style: 'align-items:center;gap:4px' },
      el('div', { class: 'price-big' }, money(amount), el('small', {}, DOLLAR)),
      el('span', { class: 'footnote' }, opt ? opt.name : s.type === 'rent' ? `${money(s.price)} per hour` : `for one ${per(s)}`)),
    opt ? el('div', { class: 'seg', role: 'group', 'aria-label': 'Choose' },
      s.options.map((o) => el('button', { type: 'button', 'aria-pressed': String(o.id === opt.id), on: { click: () => { choice = o.id; renderDevice(h, s) } } }, `${o.name} · ${money(o.price)}`))) : null,
    s.type === 'rent' ? el('div', { class: 'seg', role: 'group', 'aria-label': 'Hours' },
      Array.from({ length: s.maxHours || 4 }, (_, i) => el('button', { type: 'button', 'aria-pressed': String(hours === i + 1), on: { click: () => { hours = i + 1; renderDevice(h, s) } } }, `${i + 1} h`))) : null,
    st.key === 'busy' ? notice('info', `In use right now. Free in ${clock(st.until)}.`) : null,
    st.key === 'locked' ? notice('warn', 'Locked right now by the owner, for example during quiet hours.') : null,
    s.type === 'access' ? notice('info', 'This opens with your key, nothing to pay.') : null,
    w ? el('button', { class: 'btn pay block', type: 'button', disabled: !canPay, on: { click: () => pay(h, s) } }, icon('wallet', { size: 20 }), `Pay ${money(amount)} ${DOLLAR}`)
      : el('button', { class: 'btn primary block', type: 'button', on: { click: () => show('connect') } }, 'Add a wallet to pay'),
    w ? el('p', { class: 'footnote', style: 'text-align:center' }, `From ${w.label}. Your wallet checks the price before anything is sent.`) : null)
}

const STEPS = ['Price requested from the machine', 'Payment sent from your wallet', 'Confirming on Bitcoin, about a minute', 'Machine started']
function track (step, msg, cls, link) {
  $('#track').hidden = false
  if (step >= 4 && cls === 'ok') { // success: one clear moment, the only thing on screen
    $('#dev-body').hidden = true
    fill($('#track-msg'), el('div', { class: 'success' }, el('span', { class: 'tick' }, icon('check', { size: 38 })), el('h2', {}, msg || 'Machine started'),
      el('p', { class: 'footnote' }, 'Paid in dollars on Bitcoin. The receipt is signed by the hub and kept in your wallet.')))
    fill($('#track-steps'))
  } else {
    fill($('#track-steps'), STEPS.map((t, i) => el('li', { class: i < step ? 'done' : i === step ? 'on' : '' },
      el('span', { class: 'dot' }, i < step ? icon('check', { size: 14 }) : null), t)))
    fill($('#track-msg'), msg ? notice(cls || 'info', msg) : null)
  }
  fill($('#track-link'), link && /^https:\/\//.test(link) ? el('a', { href: link, target: '_blank', rel: 'noopener', class: 'row', style: 'justify-content:center;gap:6px;min-height:44px' }, 'See the Bitcoin transaction', icon('external', { size: 16 })) : null)
}
// Payment flow of API_usage.md §4 (payer wallet = src/guest.js):
//   1. the hub creates the payment request (service layer: POST /api/services/:id/order → id = payment id)
//   2. /api/check: the WALLET decodes the hub's RGB invoice itself and returns what would be paid. Nothing is signed.
//   3. the guest confirms exactly that (description, amount, hub)
//   4. /api/pay-request with `expect`: if the hub changed anything, the wallet refuses
//   5. follow the public GET <hub>/api/payments/:id until 'paid', then keep the hub's signed receipt (/api/proof)
const FINAL_BAD = { underpaid: 'The hub received less than asked.', failed: 'The transfer failed.', expired: 'The payment request expired.', wrong_asset: 'The hub received a different asset.' }
// rgb-lib errors in words the guest understands, with what to do.
function friendly (msg) {
  const m = String(msg || '')
  if (/InsufficientAssignments/.test(m)) return { text: 'Your dollars are still settling from your last payment. Try again in about a minute.' }
  if (/InsufficientAllocationSlots|AllocationsAlreadyAvailable/.test(m)) return { text: 'Your wallet needs to prepare room for dollars first (a small Bitcoin transaction, about a minute).', prepare: true }
  if (/InsufficientBitcoins/.test(m)) return { text: 'Your wallet has too little bitcoin for the network fee. Add some sats to your address (Wallet, Receive).' }
  return { text: m }
}
async function prepareWallet () {
  try { await walletApi('/api/utxos', { num: 8 }); track(0, 'Preparing your wallet. Try paying again in about a minute.', 'ok') } catch (e) { track(0, friendly(e.message).text, 'bad') }
}
async function pay (h, s) {
  busy = true; renderDevice(h, s)
  let entry = null // stored as soon as the wallet starts paying, so closing the screen loses nothing
  try {
    if (demoHubs || current().url === EXAMPLE_WALLET) { // example mode: show the steps, move nothing
      for (let i = 0; i <= 3; i++) { track(i, 'Example data: nothing is really paid.'); await new Promise((r) => setTimeout(r, 900)) }
      track(3, `Example only: nothing was paid and the ${s.name.toLowerCase()} did not start. Swipe to your real wallet (not "Example") to pay.`, 'warn'); return
    }
    track(0, 'Asking the machine for its price…')
    const opt = optionOf(s)
    const order = await api(`${h.url}/api/services/${encodeURIComponent(s.id)}/order`, { ...(s.type === 'rent' ? { hours } : {}), ...(opt ? { option: opt.id } : {}) })
    const paymentId = order.id
    // 2. what the wallet itself reads in the hub's invoice
    const c = await walletApi('/api/check', { hubUrl: h.url, paymentId })
    const shown = opt ? opt.price : s.price * (s.type === 'rent' ? hours : 1)
    if (c.amount !== shown || c.assetId !== dollar()?.assetId) throw new Error(`The hub asks for ${money(c.amount)} instead of ${money(shown)} ${DOLLAR}, or for another asset. Nothing was paid.`)
    // 3. explicit confirmation of what the wallet checked
    const ok = await confirmPay(c, h)
    if (!ok) { track(0, 'Payment cancelled. Nothing was paid.'); return }
    track(1, `Paying ${money(c.amount)} ${DOLLAR}…`)
    entry = { hubUrl: h.url, serviceId: s.id, name: s.name, paymentId, amount: c.amount, wallet: current().url, at: Date.now(), step: 1, msg: `Your wallet is paying ${money(c.amount)} ${DOLLAR}…`, cls: 'info' }
    pending = pending.filter((x) => !(x.hubUrl === h.url && x.serviceId === s.id)).concat(entry)
    savePending(); render() // the list already says "Your payment" if the guest closes this screen now
    // 4. pay exactly what was confirmed (can take a minute when the wallet has to sync first)
    const paid = await walletApi('/api/pay-request', { hubUrl: h.url, paymentId, expect: { assetId: c.assetId, amount: c.amount } })
    // 5. follow the hub's public payment record, also if the guest closes this screen
    entry.link = paid.link
    follow(entry, 2, 'Sent. The machine starts as soon as Bitcoin confirms it.', 'info')
  } catch (e) {
    if (entry && e instanceof TypeError) { // the page lost the wallet mid-payment: it may have paid anyway, ask the hub
      follow(entry, 1, 'Your wallet did not answer in time. Checking with the hub whether your payment arrived…', 'warn')
      return
    }
    const f = friendly(e.message)
    const here = !$('#device').hidden && openDev?.h.url === h.url && openDev?.s.id === s.id
    if (here) {
      track(0, f.text, 'bad')
      if (f.prepare) $('#track-msg').append(el('button', { class: 'btn', type: 'button', on: { click: prepareWallet } }, 'Prepare my wallet'))
    }
    if (entry) { // keep the failure until the guest has seen it ("Payment problem · tap")
      Object.assign(entry, { done: true, step: 1, msg: f.text + ' Nothing was paid.', cls: 'bad' })
      if (here) pending = pending.filter((x) => x !== entry)
      savePending()
    }
  } finally {
    busy = false
    await walletApi('/api/me?fresh=1').catch(() => {}) // the wallet caches balances for 30 s: force a fresh one after paying
    await refresh()
    const fresh = hubs.find((x) => x.url === h.url)?.services.find((x) => x.id === s.id)
    if (fresh && !$('#device').hidden) { openDev = { h, s: fresh }; renderDevice(h, fresh) }
  }
}

// Follows one payment until the hub says paid (or a final failure). Updates the stored entry,
// the machine list and, if this machine's screen is open, the steps on it.
async function follow (entry, step, msg, cls) {
  const update = (st, m, c, link) => {
    Object.assign(entry, { step: st, msg: m, cls: c, link: link || entry.link })
    savePending()
    if (!$('#device').hidden && openDev?.h.url === entry.hubUrl && openDev?.s.id === entry.serviceId) {
      track(st, m, c, entry.link)
      if (entry.done) { pending = pending.filter((x) => x !== entry); savePending() } // seen on screen
    } else render()
  }
  update(step, msg, cls)
  const wallet = wallets.find((w) => w.url === entry.wallet)
  const walletCall = (path, body) => wallet ? api(wallet.url + path, body) : Promise.reject(new Error('wallet removed'))
  for (let i = 0; i < 120 && !entry.done; i++) { // ~10 min
    await new Promise((r) => setTimeout(r, 5000))
    let p
    try { p = await api(`${entry.hubUrl}/api/payments/${encodeURIComponent(entry.paymentId)}`) } catch { continue } // hub busy or offline: try again
    if (p.status === 'paid') {
      try { await walletCall(`/api/proof?hubUrl=${encodeURIComponent(entry.hubUrl)}&paymentId=${encodeURIComponent(entry.paymentId)}`) } catch {}
      entry.done = true
      update(4, `${entry.name} started`, 'ok', p.link)
    } else if (FINAL_BAD[p.status]) {
      entry.done = true
      update(2, FINAL_BAD[p.status] + ' Nothing was started.', 'bad', p.link)
    }
  }
  if (!entry.done) { entry.done = true; update(2, 'Still not confirmed after 10 minutes. Check the transaction link, or ask the host.', 'warn') }
  walletCall('/api/me?fresh=1').catch(() => {})
  refresh()
}

// In-page confirmation (browser confirm() dialogs are not used): resolves true/false.
function confirmPay (c, h) {
  return new Promise((resolve) => {
    $('#track').hidden = false
    fill($('#track-steps'))
    fill($('#track-msg'), el('div', { class: 'confirm' },
      el('div', { class: 'row' }, el('span', { class: 'cell-icon green' }, icon('checkCircle', { size: 16 })), el('h3', {}, 'Checked by your wallet')),
      el('div', { class: 'stack', style: 'gap:8px' },
        el('div', { class: 'kv' }, el('span', {}, 'To'), el('span', {}, c.hub || h.name)),
        el('div', { class: 'kv' }, el('span', {}, 'For'), el('span', {}, c.description || '')),
        el('div', { class: 'kv' }, el('span', {}, 'Amount'), el('strong', { class: 'num' }, `${money(c.amount)} ${DOLLAR}`))),
      el('button', { class: 'btn pay block', type: 'button', on: { click: () => resolve(true) } }, `Confirm and pay ${money(c.amount)} ${DOLLAR}`),
      el('button', { class: 'btn block', type: 'button', on: { click: () => resolve(false) } }, 'Cancel')))
  })
}

// static icons in the markup
fill($('#brand-mark'), icon('hub', { size: 16 }))
fill($('#open-user'), icon('user', { size: 20 }))
$('#open-user').before(themeButton())
document.querySelectorAll('[data-ico]').forEach((n) => fill(n, icon(n.dataset.ico, { size: 22 })))
liquid(); morphTopbar($('.topbar'), $('#greeting')); tabbar($('#tabbar'))
lens($('.topbar'), $('#tabbar'))
fill($('#search-ico'), icon('search', { size: 18 }))
fill($('#privacy-ico'), icon('info', { size: 18 }))
document.querySelectorAll('[data-close]').forEach((b) => fill(b, icon('close', { size: 18 })))

// served by a wallet service? use it as the first wallet
if (!wallets.length) {
  api('/api/me').then(() => { wallets = [{ url: location.origin, label: 'HubWallet' }]; save_('wallets', wallets); refresh() }).catch(() => {})
}
refresh()
for (const p of pending.filter((x) => !x.done)) follow(p, p.step ?? 2, p.msg, p.cls) // resume after a reload
setInterval(() => { if (!busy && $('#device').hidden) refresh() }, 20000)
setInterval(() => { // countdowns tick locally between refreshes
  if ($('#device').hidden) { if (hubs.some((h) => h.services.some((s) => statusOf(s).until > Date.now()))) render() }
  else if (openDev && !busy && $('#track').hidden) renderDevice(openDev.h, openDev.s)
}, 1000) // the hub blocks while rgb-lib syncs: poll gently
