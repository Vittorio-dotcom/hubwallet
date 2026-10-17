// HubWallet device screen logic. Reads the hub's public API every 3 s and shows the device state big:
// the porthole ring fills while the device runs, with a countdown; a QR code opens the guest app on this hub.
// Falls back to example data (marked) while no hub answers.
import { el, fill, money, DOLLAR, icon, porthole, statusOf, clock, ruleText, ruleIcon, themeButton } from './ui.js'
import { liquid } from './liquid.js'
liquid()

const $ = (s) => document.querySelector(s)
const qs = new URLSearchParams(location.search)
const ID = qs.get('id')
const HUB = location.origin
// Guest app URL for the QR: only an http(s) URL is accepted (no javascript: or other schemes), else the default.
const GUEST = (() => {
  const fallback = 'http://127.0.0.1:8090/guest.html'
  try { const u = new URL(qs.get('guest') || fallback); return /^https?:$/.test(u.protocol) ? u.origin + u.pathname : fallback } catch { return fallback }
})()
const get = async (path) => { const r = await fetch(HUB + path); if (!r.ok) throw new Error(r.status); return r.json() }

const EXAMPLE = { name: 'Lavanderia', dollar: DOLLAR, services: [
  { id: 'washer', name: 'Washing machine', icon: 'washer', type: 'use', price: 300, unit: 'wash', state: { status: 'running', until: Date.now() + 38 * 1000 },
    rules: [{ when: { kind: 'after_hour', value: 22 }, do: { kind: 'lock' } }, { when: { kind: 'after_hour', value: 7 }, do: { kind: 'unlock' } }] },
  { id: 'dryer', name: 'Dryer', icon: 'dryer', type: 'use', price: 200, unit: 'cycle', state: { status: 'idle' }, rules: [] }
] }

// "Opens at 7:00" for a device locked by a time rule
const opensAt = (s) => { const u = (s.rules || []).find((r) => r.when?.kind === 'after_hour' && r.do?.kind === 'unlock'); return u ? `${u.when.value}:00` : null }

let data = null; let example = false; let lastKey = ''
const theme = themeButton() // one button, kept across redraws
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
  const top = el('div', { class: 'screen-top' }, el('span', { class: 'brand-mark' }, icon('hub', { size: 16 })), el('span', { class: 'grow' }, data.name || 'Hub'),
    example ? el('span', { class: 'example-tag' }, 'Example data') : null, theme)

  if (!ID) { // which device does this screen stand for?
    fill(screen, top, el('div', { class: 'title-block' }, el('h1', {}, 'Choose a device'), el('p', {}, 'This screen will show its status and a code to pay.')),
      el('div', { class: 'picker' }, ...data.services.map((s) => el('a', { class: 'device-card', href: `?id=${encodeURIComponent(s.id)}` },
        porthole(s, { size: 72 }), el('h3', {}, s.name), el('span', { class: 'muted' }, `${money(s.price)} ${data.dollar || DOLLAR} per ${s.unit || 'use'}`)))))
    lastKey = ''
    return
  }
  const s = data.services.find((x) => x.id === ID)
  if (!s) { fill(screen, top, el('div', { class: 'empty' }, icon('alert', { size: 40 }), el('h2', {}, 'Device not found'), el('p', {}, `This hub has no device called “${ID}”.`))); return }

  const st = statusOf(s)
  const key = `${st.key}|${s.price}|${(s.rules || []).length}`
  // Only redraw the whole screen when something changes (keeps the QR code and the ring animation steady).
  if (key === lastKey) { tick(s); return }
  lastKey = key

  const words = st.key === 'busy' ? 'In use' : st.key === 'locked' ? 'Locked' : 'Available'
  const detail = st.key === 'busy' ? el('div', { class: 'screen-timer', id: 'timer', 'aria-label': 'Time left' }, clock(st.until))
    : st.key === 'locked' ? el('p', { class: 'muted' }, opensAt(s) ? `Opens again at ${opensAt(s)}` : 'Locked by the owner\'s rules')
      : el('p', { class: 'price-big' }, money(s.price), el('small', {}, `${data.dollar || DOLLAR} per ${s.unit || 'use'}`))

  fill(screen, top,
    el('section', { class: `screen-main ${st.key}` },
      el('div', { id: 'ring' }, porthole(s, { size: null })),
      el('div', { class: 'stack', style: 'align-items:center;gap:6px' }, el('h2', { class: 'muted' }, s.name), el('div', { class: 'screen-status' }, words)),
      detail),
    st.key === 'free' ? el('section', { class: 'screen-pay' },
      el('div', { id: 'qr', role: 'img', 'aria-label': 'QR code: pay with HubWallet' }),
      el('div', { class: 'stack', style: 'gap:6px' }, el('h3', {}, 'Scan to pay with HubWallet'),
        el('p', { class: 'footnote' }, 'Your wallet checks the price before you confirm. The machine starts as soon as the payment arrives.'))) : null,
    (s.rules || []).length ? el('section', { class: 'section' }, el('div', { class: 'group' },
      ...s.rules.map((r) => el('div', { class: 'cell' }, el('span', { class: 'cell-icon gray' }, icon(ruleIcon(r), { size: 16 })), el('span', { class: 'grow' }, ruleText(r)))))) : null)
  if (st.key === 'free') drawQr()
}

// every second: countdown text and ring progress, without rebuilding the page
function tick (s) {
  const st = statusOf(s)
  const t = document.getElementById('timer'); if (t && st.key === 'busy') t.textContent = clock(st.until)
  const ring = document.getElementById('ring'); if (ring && st.key === 'busy') fill(ring, porthole(s, { size: null }))
}

function drawQr () {
  const box = document.getElementById('qr'); if (!box) return
  const u = new URL(GUEST); u.searchParams.set('hubs', HUB)
  if (window.QRCode) { fill(box); new window.QRCode(box, { text: u.toString(), width: 150, height: 150, correctLevel: window.QRCode.CorrectLevel.M }) }
  else fill(box, el('a', { href: u.toString() }, icon('qr', { size: 48 })))
}

load()
setInterval(load, 3000)
setInterval(() => { const s = data?.services.find((x) => x.id === ID); if (s) tick(s) }, 1000)
