// HubWallet device screen logic. Reads the hub's public API every 3 s and shows the device state big,
// with a countdown while it runs, its rules, and a QR code that opens the guest app on this hub.
// Falls back to example data (marked) while the hub's service layer is not there yet.

const $ = (s) => document.querySelector(s)
const money = (cents) => (Number(cents || 0) / 100).toFixed(2)
const qs = new URLSearchParams(location.search)
const ID = qs.get('id')
const HUB = location.origin
// Guest app URL for the QR: only an http(s) URL is accepted (no javascript: or other schemes), else the default.
const GUEST = (() => {
  const fallback = 'http://127.0.0.1:8090/guest.html'
  try { const u = new URL(qs.get('guest') || fallback); return /^https?:$/.test(u.protocol) ? u.origin + u.pathname : fallback } catch { return fallback }
})()

// Fills a node, skipping null/false parts (native replaceChildren would print them as the text "null").
const fill = (node, ...parts) => node.replaceChildren(...parts.flat().filter((x) => x !== null && x !== undefined && x !== false))
function el (tag, props = {}, ...children) {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v)
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : String(c))
  return n
}
const get = async (path) => { const r = await fetch(HUB + path); if (!r.ok) throw new Error(r.status); return r.json() }

const EXAMPLE = { name: 'Lavanderia', dollar: 'HUSD', services: [
  { id: 'washer', name: 'Washing machine', icon: '🧺', type: 'use', price: 200, unit: 'wash', state: { status: 'running', until: Date.now() + 38 * 60000 },
    rules: [{ when: { kind: 'after_hour', value: 22 }, do: { kind: 'lock' } }] },
  { id: 'dryer', name: 'Dryer', icon: '🌀', type: 'use', price: 150, unit: 'cycle', state: { status: 'idle' }, rules: [] }
] }

// rules in words (same vocabulary as docs/HOST-APP.md)
const WHEN = { after_hour: (v) => `After ${v}:00`, weekday: (v) => `On ${v}`, stock_below: (v) => `Stock below ${v}`, counter_at: (v) => `Every ${v} uses`, overdue: () => 'When overdue' }
const DO = { lock: () => 'locked', unlock: () => 'unlocked', set_price: (d) => `price ${money(d.price)}`, notify: () => 'the owner is notified', propose_purchase: (d) => `maintenance proposed${d.reason ? ' (' + d.reason + ')' : ''}`, keep_deposit: () => 'deposit kept' }
const ruleText = (r) => `${(WHEN[r.when?.kind] || (() => r.when?.kind))(r.when?.value)}: ${(DO[r.do?.kind] || (() => r.do?.kind))(r.do || {})}`

// device state from either the new device layer (state.status) or the older field (device.state)
function status (s) {
  const st = s.state?.status || s.device?.state || 'idle'
  const until = s.state?.until || s.device?.until || 0
  if (st === 'running' || st === 'rented') return { key: 'running', text: 'Running', until }
  if (st === 'locked') return { key: 'locked', text: 'Locked' }
  return { key: 'ready', text: 'Ready' }
}
const left = (until) => {
  const ms = Math.max(0, until - Date.now()); const m = Math.floor(ms / 60000); const sec = Math.floor((ms % 60000) / 1000)
  return `${m}:${String(sec).padStart(2, '0')}`
}

let data = null; let example = false; let qrDone = false
async function load () {
  try {
    const info = await get('/api/hub/info').catch(() => null)
    const sv = await get('/api/services')
    data = { ...sv, name: sv.name || info?.name }
    example = false
  } catch { data = EXAMPLE; example = true }
  render()
}

function render () {
  const screen = $('#screen')
  if (!ID) { // device picker
    fill(screen, el('h1', {}, data.name || 'Hub'), el('p', { class: 'muted' }, 'Choose the device this screen stands for.'),
      ...data.services.map((s) => el('a', { class: 'btn block', href: `?id=${encodeURIComponent(s.id)}` }, `${s.icon || '🧩'} ${s.name}`)))
    return
  }
  const s = data.services.find((x) => x.id === ID)
  if (!s) { fill(screen, el('div', { class: 'empty' }, `No device "${ID}" on this hub.`)); return }
  const st = status(s)
  const rules = s.rules || s.behaviours || []
  fill(screen, 
    el('div', { class: 'row' }, el('span', { class: 'label grow' }, data.name || 'Hub'), example ? el('span', { class: 'demo-tag' }, 'Example data') : null),
    el('div', { class: `dev-state ${st.key}` },
      el('span', { class: 'dev-icon', 'aria-hidden': 'true' }, s.icon || '🧩'),
      el('h1', {}, s.name),
      el('div', { class: 'dev-status' }, st.text),
      st.key === 'running' && st.until ? el('div', { class: 'dev-timer', 'aria-label': 'Time left' }, left(st.until)) : null,
      st.key === 'ready' ? el('div', { class: 'dev-price' }, `${money(s.price)} ${data.dollar || 'HUSD'} / ${s.unit || 'use'}`) : null),
    st.key === 'ready' ? el('div', { class: 'card qr-card' },
      el('div', { id: 'qr', 'aria-label': 'QR code to pay with the HubWallet app' }),
      el('div', {}, el('strong', {}, 'Scan to pay'), el('p', { class: 'small muted' }, 'Opens HubWallet on this hub. Your wallet checks the invoice before paying.'),
        el('span', { class: 'mono small' }, HUB.replace(/^https?:\/\//, '')))) : null,
    rules.length ? el('div', { class: 'card' }, el('span', { class: 'label' }, 'Rules of this device'),
      el('ul', { class: 'rules' }, ...rules.map((r) => el('li', {}, ruleText(r))))) : null)
  if (st.key === 'ready') drawQr()
  else qrDone = false
}

function drawQr () {
  const box = document.getElementById('qr'); if (!box) return
  const u = new URL(GUEST); u.searchParams.set('hubs', HUB)
  const url = u.toString()
  if (window.QRCode) { fill(box, ); new window.QRCode(box, { text: url, width: 148, height: 148, correctLevel: window.QRCode.CorrectLevel.M }) }
  else fill(box, el('a', { href: url, class: 'small' }, 'Open HubWallet'))
  qrDone = true
}

load()
setInterval(load, 3000)
setInterval(() => { const t = document.querySelector('.dev-timer'); const s = data?.services.find((x) => x.id === ID); if (t && s) t.textContent = left(status(s).until) }, 1000)
