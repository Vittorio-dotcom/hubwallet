// HubWallet host app logic — example data for now (docs/HOST-APP.md).
// When the device layer exists on the hub, the EXAMPLE parts are replaced by calls to:
//   hub (owner key):  GET /api/wallet, GET /api/to-sign, POST /api/transfers (sweep),
//                     GET /api/devices, POST /api/devices, POST /api/devices/:id/edit, POST /api/devices/:id/apply
//   host wallet:      GET /api/me (src/guest.js with WALLET=provider)
// The AI never saves anything: it proposes a JSON, the code validates it, the host applies it.

const $ = (s) => document.querySelector(s)
const money = (cents) => (Number(cents || 0) / 100).toFixed(2)
const DOLLAR = 'HUSD'

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

// ---------- example data, in the format of docs/HOST-APP.md ----------
const state = {
  wallets: [{ label: 'My wallet', husd: 4250, sats: 61200, address: 'tb1p…host' }],
  hubs: [
    { url: 'example-a', name: 'Lavanderia', earned: 1150, sats: 8800, freeUtxos: 4,
      toSign: [],
      devices: [
        { id: 'washer', name: 'Washing machine', icon: '🧺', type: 'use', price: 200, unit: 'wash', commands: ['start', 'stop'], rules: [], version: 1, state: { status: 'idle' }, earned: 800 },
        { id: 'dryer', name: 'Dryer', icon: '🌀', type: 'use', price: 150, unit: 'cycle', commands: ['start', 'stop'],
          rules: [{ when: { kind: 'after_hour', value: 22 }, do: { kind: 'lock' } }], version: 2, state: { status: 'running', until: Date.now() + 40 * 60000 }, earned: 350 }
      ] }
  ]
}
let hubIndex = 0; let walletIndex = 0
const hub = () => state.hubs[hubIndex]

// ---------- rules shown in words ----------
const WHEN = { after_hour: (v) => `after ${v}:00`, weekday: (v) => `on ${v}`, stock_below: (v) => `when stock is below ${v}`, counter_at: (v) => `every ${v} uses`, overdue: () => 'when overdue' }
const DO = { lock: () => 'lock it', unlock: () => 'unlock it', set_price: (d) => `set the price to ${money(d.price)} ${DOLLAR}`, notify: () => 'notify me', propose_purchase: (d) => `propose a purchase${d.reason ? ' (' + d.reason + ')' : ''}`, keep_deposit: () => 'keep the deposit' }
const ruleText = (r) => `${(WHEN[r.when?.kind] || (() => r.when?.kind))(r.when?.value)}: ${(DO[r.do?.kind] || (() => r.do?.kind))(r.do || {})}`

// ---------- validation by code (the AI's proposal is never trusted as is) ----------
const RULE_WHEN = Object.keys(WHEN); const RULE_DO = Object.keys(DO)
function validate (cfg, current) {
  const errors = []
  if (current && cfg.id !== current.id) errors.push('The device id cannot change.')
  if (!['use', 'rent', 'access'].includes(cfg.type)) errors.push('Unknown device type.')
  if (!Number.isInteger(cfg.price) || cfg.price < 0) errors.push('The price must be a whole number of cents.')
  for (const r of cfg.rules || []) {
    if (!RULE_WHEN.includes(r.when?.kind)) errors.push(`Unknown rule condition: ${r.when?.kind}`)
    if (!RULE_DO.includes(r.do?.kind)) errors.push(`Unknown rule action: ${r.do?.kind}`)
  }
  return errors
}
function diff (a, b) {
  const out = []
  for (const k of ['name', 'icon', 'type', 'price', 'unit']) if (a[k] !== b[k]) out.push({ field: k, from: a[k], to: b[k] })
  const ra = (a.rules || []).map(ruleText); const rb = (b.rules || []).map(ruleText)
  for (const r of rb) if (!ra.includes(r)) out.push({ field: 'rule', to: r })
  for (const r of ra) if (!rb.includes(r)) out.push({ field: 'rule', from: r })
  return out
}

// ---------- example AI (stands in for the hub's QVAC model) ----------
// Understands a few phrasings so the flow can be tried; the real one is the hub's /api/devices/:id/edit.
function exampleEdit (text, cur) {
  const t = text.toLowerCase(); const next = structuredClone(cur); delete next.state; delete next.earned
  const p = t.match(/(\d+(?:[.,]\d{1,2})?)/)
  if (p && /(price|prezzo|cost|raise|lower|alza|abbassa|€|husd|\d[.,]\d)/.test(t)) next.price = Math.round(parseFloat(p[1].replace(',', '.')) * 100)
  const h = t.match(/after\s*(\d{1,2})|dopo le\s*(\d{1,2})/)
  if (h && /(lock|blocc)/.test(t)) next.rules = [...(next.rules || []).filter((r) => r.when.kind !== 'after_hour'), { when: { kind: 'after_hour', value: Number(h[1] || h[2]) }, do: { kind: 'lock' } }]
  const c = t.match(/every\s*(\d+)|ogni\s*(\d+)/)
  if (c && /(maint|manut)/.test(t)) next.rules = [...(next.rules || []), { when: { kind: 'counter_at', value: Number(c[1] || c[2]) }, do: { kind: 'propose_purchase', reason: 'maintenance' } }]
  if (/(remove|togli|elimina).*(rule|regol)/.test(t)) next.rules = []
  return next
}
function exampleDevice (descriptorText) {
  let d = {}; try { d = JSON.parse(descriptorText) } catch { d = { name: descriptorText.slice(0, 30) } }
  const name = String(d.name || 'New device').slice(0, 40)
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'device'
  const icon = /dry|asciug/i.test(name + (d.type || '')) ? '🌀' : /wash|lavat/i.test(name + (d.type || '')) ? '🧺' : '🧩'
  return { id, name, icon, type: 'use', price: 150, unit: 'cycle', commands: Array.isArray(d.commands) ? d.commands : ['start', 'stop'], rules: [], version: 1 }
}

// ---------- rendering ----------
function render () {
  // wallets
  const cards = state.wallets.map((w) => el('div', { class: 'wcard', role: 'group', 'aria-label': w.label },
    el('span', { class: 'label' }, w.label),
    el('span', {}, el('span', { class: 'amount' }, money(w.husd)), ' ', el('span', { class: 'unit' }, DOLLAR)),
    el('span', { class: 'hint' }, `${w.sats.toLocaleString('en')} sats · receives your hubs' earnings`)))
  cards.push(el('button', { class: 'wcard add', type: 'button', on: { click: () => alertIn('#hub-card', 'Adding a host wallet connects a src/guest.js wallet (WALLET=provider). Coming with the real API.') } },
    el('strong', { style: 'font-size:22px' }, '+ Add wallet'), el('span', { class: 'hint' }, 'Your personal WDK wallet')))
  $('#wallets').replaceChildren(...cards)
  $('#dots').replaceChildren(...cards.map((_, i) => el('span', { class: i === walletIndex ? 'on' : '' })))

  // hubs
  $('#hub-chips').replaceChildren(...state.hubs.map((h, i) => el('button', { class: 'chip', type: 'button', role: 'tab', 'aria-selected': String(i === hubIndex), on: { click: () => { hubIndex = i; render() } } }, h.name)),
    el('button', { class: 'chip', type: 'button', on: { click: () => show('add-hub') } }, '+ Add hub'))
  const h = hub()
  $('#hub-card').replaceChildren(el('div', { class: 'card' },
    el('div', { class: 'row' }, el('div', { class: 'grow' }, el('span', { class: 'label' }, 'Earnings on this hub'),
      el('div', {}, el('span', { style: 'font-size:28px;font-weight:700' }, money(h.earned)), ' ', DOLLAR)),
      el('button', { class: 'btn', type: 'button', disabled: h.earned <= 0 || h.toSign.length > 0, on: { click: sweep } }, 'Sweep to my wallet')),
    el('p', { class: 'small muted' }, `${h.sats.toLocaleString('en')} sats for fees · ${h.freeUtxos} free UTXOs · the hub can receive but never spend`)))

  // to sign
  $('#to-sign').replaceChildren(...h.toSign.map((it) => el('div', { class: 'card warn-card' },
    el('span', { class: 'label' }, 'Waiting for your signature'),
    el('strong', {}, it.summary),
    el('p', { class: 'small muted' }, 'Approve it on your signer (the host phone). From here you can only reject it.'),
    el('div', { class: 'row' }, el('button', { class: 'btn', type: 'button', on: { click: () => { h.toSign = h.toSign.filter((x) => x !== it); render() } } }, 'Reject'),
      el('button', { class: 'btn primary', type: 'button', on: { click: () => signExample(it) } }, 'Simulate signer approval')))))

  // devices
  $('#devices').replaceChildren(...(h.devices.length ? h.devices.map((d) => {
    const running = d.state?.status === 'running'
    return el('button', { class: 'tile', type: 'button', on: { click: () => openDevice(d) }, 'aria-label': d.name },
      el('span', { class: 'ic', 'aria-hidden': 'true' }, d.icon), el('span', { class: 'name' }, d.name),
      el('span', { class: 'price' }, `${money(d.price)} ${DOLLAR} / ${d.unit}`),
      el('span', { class: `pill ${running ? 'busy' : 'free'}` }, running ? 'Running' : d.state?.status === 'locked' ? 'Locked' : 'Ready'),
      el('span', { class: 'where' }, `${d.rules.length} rule${d.rules.length === 1 ? '' : 's'} · earned ${money(d.earned || 0)}`))
  }) : [el('div', { class: 'empty', style: 'grid-column:1/-1' }, 'No devices yet. Add one below.')]))
}
function alertIn (sel, text) { $(sel).append(el('div', { class: 'notice' }, text)) }

// ---------- sweep: hub → host wallet, waits for the signer ----------
function sweep () {
  const h = hub()
  h.toSign.push({ id: 'ts-' + Date.now(), kind: 'send', amount: h.earned, summary: `Send ${money(h.earned)} ${DOLLAR} from ${h.name} to your wallet` })
  render()
}
function signExample (it) {
  const h = hub(); h.toSign = h.toSign.filter((x) => x !== it)
  state.wallets[0].husd += it.amount; h.earned -= it.amount; render()
}

// ---------- devices ----------
let current = null
function openDevice (d) {
  current = d
  $('#device-title').textContent = d.name
  $('#edit-text').value = ''; $('#edit-out').replaceChildren()
  renderDevice()
  show('device')
}
function renderDevice () {
  const d = current
  $('#device-body').replaceChildren(
    el('div', { class: 'row' }, el('span', { style: 'font-size:40px', 'aria-hidden': 'true' }, d.icon),
      el('div', { class: 'grow' }, el('strong', {}, d.name), el('div', { class: 'small muted' }, `${money(d.price)} ${DOLLAR} / ${d.unit} · version ${d.version}`))),
    el('span', { class: 'label' }, 'Rules'),
    d.rules.length ? el('ul', { class: 'rules' }, ...d.rules.map((r) => el('li', {}, ruleText(r)))) : el('p', { class: 'small muted' }, 'No rules yet.'))
  const { state: _s, earned: _e, ...cfg } = d
  $('#device-json').textContent = JSON.stringify(cfg, null, 2)
}
function proposal (cur, next, onApply) {
  const errors = validate(next, cur)
  const changes = cur ? diff(cur, next) : []
  return el('div', { class: 'card' },
    el('span', { class: 'label' }, cur ? 'Proposed changes' : 'Proposed configuration'),
    errors.length ? el('div', { class: 'notice bad' }, errors.join(' ')) : null,
    cur ? (changes.length
      ? el('ul', { class: 'diff' }, ...changes.map((c) => el('li', { class: c.from === undefined ? 'add' : c.to === undefined ? 'del' : 'mod' },
          c.field === 'rule' ? (c.to ? `+ rule: ${c.to}` : `− rule: ${c.from}`)
            : `${c.field}: ${c.field === 'price' ? money(c.from) : c.from} → ${c.field === 'price' ? money(c.to) : c.to}`)))
      : el('p', { class: 'small muted' }, 'No changes understood. Try "raise the price to 2.50 and lock it after 22:00".'))
      : el('pre', { class: 'mono json' }, JSON.stringify(next, null, 2)),
    el('button', { class: 'btn primary block', type: 'button', disabled: errors.length > 0 || (cur && !changes.length), on: { click: onApply } }, 'Apply'))
}
$('#edit-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const text = $('#edit-text').value.trim(); if (!text) return
  const next = exampleEdit(text, current)
  $('#edit-out').replaceChildren(proposal(current, next, () => {
    Object.assign(current, next, { version: current.version + 1 })
    $('#edit-out').replaceChildren(el('div', { class: 'notice ok' }, `Saved as version ${current.version}.`))
    renderDevice(); render()
  }))
})
$('#add-device').onclick = () => { $('#add-dev-out').replaceChildren(); show('add-dev') }
$('#propose-device').onclick = () => {
  const cfg = exampleDevice($('#descriptor').value)
  if (hub().devices.some((d) => d.id === cfg.id)) cfg.id += '-' + (hub().devices.length + 1)
  $('#add-dev-out').replaceChildren(proposal(null, cfg, () => {
    hub().devices.push({ ...cfg, state: { status: 'idle' }, earned: 0 })
    show(null); render()
  }))
}

// ---------- hubs ----------
$('#add-hub-form').addEventListener('submit', (e) => {
  e.preventDefault()
  let url = $('#hub-url').value.trim().replace(/\/$/, ''); if (!/^https?:\/\//.test(url)) url = 'http://' + url
  if (!/^https?:\/\/[^/\s]+$/.test(url)) { $('#add-hub-msg').replaceChildren(el('div', { class: 'notice bad' }, 'Enter an address like 192.168.7.246:8080.')); return }
  // Example mode: the hub is added locally; with the real API the page first calls GET /api/wallet with the owner key.
  state.hubs.push({ url, name: url.replace(/^https?:\/\//, ''), earned: 0, sats: 0, freeUtxos: 0, toSign: [], devices: [] })
  hubIndex = state.hubs.length - 1; show(null); render()
})

// ---------- sheets ----------
function show (id) { document.querySelectorAll('.sheet').forEach((s) => { s.hidden = s.id !== id }); $('#home').hidden = !!id }
document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) show(null) })
$('#wallets').addEventListener('scroll', () => { const c = $('#wallets'); const i = Math.round(c.scrollLeft / c.clientWidth); if (i !== walletIndex) { walletIndex = i; render() } }, { passive: true })

render()
