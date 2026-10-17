// HubWallet shared UI kit for the guest app, host app and device screen (plain ES module, no build).
// - el()/fill(): build DOM from text only (no HTML injection)
// - icon(): line icons drawn as inline SVG (no emoji anywhere in the UI)
// - deviceArt(): the device illustration from web/img/<key>.png if it exists, else its SVG icon
// - porthole(): the device status ring, shaped like a washing-machine door; it fills while the device runs
// - status/rule helpers shared by the three pages

export const money = (cents) => (Number(cents || 0) / 100).toFixed(2)
export const DOLLAR = 'HUSD'

// Fills a node, skipping null/false parts (native replaceChildren would print them as the text "null").
export const fill = (node, ...parts) => node.replaceChildren(...parts.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false))
export function el (tag, props = {}, ...children) {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn)
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v)
  }
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : String(c))
  return n
}

// ---------- icons: 24×24, stroke 1.75, round caps (the SF Symbols / Lucide family look) ----------
const P = {
  washer: '<rect x="3" y="2" width="18" height="20" rx="3"/><path d="M3 6.5h18"/><path d="M6.5 4.3h.01M9 4.3h.01"/><circle cx="12" cy="14" r="5"/><path d="M8.6 14.6c1.2-.9 2.2.9 3.4 0s2.2.9 3.4 0"/>',
  dryer: '<rect x="3" y="2" width="18" height="20" rx="3"/><path d="M3 6.5h18"/><path d="M6.5 4.3h.01M9 4.3h.01"/><circle cx="12" cy="14" r="5"/><circle cx="12" cy="14" r="2"/><path d="M15.5 4.3h2"/>',
  iron: '<path d="M3 17h18l-1.6-6.2A4 4 0 0 0 15.5 8H9"/><path d="M6 8h3"/><path d="M3 17v1.5A1.5 1.5 0 0 0 4.5 20h15a1.5 1.5 0 0 0 1.5-1.5V17"/><path d="M9 13h7"/>',
  coffee: '<path d="M10 2v2M14 2v2M6 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h12a4 4 0 1 1 0 8h-1"/>',
  fridge: '<rect x="5" y="2" width="14" height="20" rx="2.5"/><path d="M5 10h14M8 6v1.5M8 13v3"/>',
  printer: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  bike: '<circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17 9 9h6l3.5 8M9 9 7.5 6H6M15 9l-3.5 8"/>',
  charger: '<path d="M7 2h7a2 2 0 0 1 2 2v16H5V4a2 2 0 0 1 2-2z"/><path d="M3 20h15M16 9h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8l-3-3"/><path d="m11 6-2.5 4h3L9 14"/>',
  door: '<path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17M3 21h18"/><path d="M15 12h.01"/>',
  parking: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>',
  device: '<rect x="4" y="3" width="16" height="18" rx="3"/><circle cx="12" cy="12" r="3.5"/><path d="M8 6.5h.01"/>',
  hub: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  spark: '<path d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9.5"/><path d="m8 12.3 2.7 2.7L16.2 9.5"/>',
  alert: '<circle cx="12" cy="12" r="9.5"/><path d="M12 7.5v5.5M12 16.5h.01"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  user: '<circle cx="12" cy="8" r="4.5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15.4-6.4L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.4 6.4L3 16"/><path d="M8 16H3v5"/>',
  search: '<circle cx="11" cy="11" r="7.5"/><path d="m20.5 20.5-4.2-4.2"/>',
  doc: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z"/><path d="M14 2v6h6M8.5 13h7M8.5 17h5"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  arrowUp: '<path d="M7 17 17 7M8 7h9v9"/>',
  arrowDown: '<path d="M17 7 7 17M16 17H7V8"/>',
  key: '<circle cx="7.5" cy="15.5" r="5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3M21 14v.01M17 21h4v-4M14 21v-3"/>',
  send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 11v5.5M12 7.5h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7Z"/>',
  auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none"/>'
}
const SVG = 'http://www.w3.org/2000/svg'
export function icon (name, { size = 22, label } = {}) {
  const s = document.createElementNS(SVG, 'svg')
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size)
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.75')
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('class', 'ico')
  if (label) { s.setAttribute('role', 'img'); s.setAttribute('aria-label', label) } else s.setAttribute('aria-hidden', 'true')
  s.innerHTML = P[name] || P.device // static paths from this file only, never user data
  return s
}

// Device icon key: new hubs send a key ("washer"); hubs from before the redesign sent an emoji.
const EMOJI = { '🧺': 'washer', '🌀': 'dryer', '☕': 'coffee', '🍺': 'fridge', '🚪': 'door', '🔐': 'lock', '🖨️': 'printer', '🚲': 'bike', '🛴': 'bike', '🅿️': 'parking', '🔌': 'charger' }
export function iconKey (d) {
  const k = String(d?.icon || '')
  if (P[k]) return k
  if (EMOJI[k]) return EMOJI[k]
  const n = String(d?.name || '').toLowerCase()
  if (/dry|asciug/.test(n)) return 'dryer'
  if (/wash|lavatr/.test(n)) return 'washer'
  if (/iron|ferro/.test(n)) return 'iron'
  if (/coffee|caff/.test(n)) return 'coffee'
  return 'device'
}
// Illustration if web/img/<key>.png exists (generated renders), otherwise the line icon. Never breaks the layout.
const IMG = ['washer', 'dryer', 'iron', 'coffee', 'device']
// size null = fluid (sized by CSS, e.g. the big porthole of the device screen)
export function deviceArt (d, { size = 44 } = {}) {
  const key = iconKey(d)
  const box = el('span', { class: 'art', style: size ? `--art:${size}px` : null, 'aria-hidden': 'true' })
  const fallback = () => fill(box, icon(key, { size: size ? Math.round(size * 0.58) : 120 }))
  if (!IMG.includes(key)) { fallback(); return box }
  const img = el('img', { src: `img/${key}.png`, alt: '', width: size || null, height: size || null, decoding: 'async' })
  img.addEventListener('error', fallback, { once: true })
  box.append(img)
  return box
}

// ---------- device status ----------
// key: free | busy | locked · until: ms timestamp while busy
export function statusOf (s) {
  const st = s?.state?.status || s?.device?.state || 'idle'
  const until = s?.state?.until || s?.device?.until || 0
  if (st === 'running' || st === 'rented') return { key: 'busy', label: 'In use', until }
  if (st === 'locked') return { key: 'locked', label: 'Locked' }
  return { key: 'free', label: 'Available' }
}
export const clock = (until) => {
  const ms = Math.max(0, until - Date.now()); const m = Math.floor(ms / 60000); const s = Math.floor((ms % 60000) / 1000)
  return `${m}:${String(s).padStart(2, '0')}`
}

// The porthole: a ring around the device, like the door of a washing machine.
// progress 0..1 fills the ring while the device runs (the full run length is estimated from the first time we see it).
const runLength = {}
export function progressOf (id, until) {
  if (!until || until <= Date.now()) { delete runLength[id]; return 0 }
  const left = until - Date.now()
  if (!runLength[id] || left > runLength[id]) runLength[id] = Math.max(left, 1)
  return 1 - left / runLength[id]
}
export function porthole (d, { size = 64, art = true } = {}) {
  const st = statusOf(d)
  const r = 46; const c = 2 * Math.PI * r
  const p = st.key === 'busy' ? progressOf(d.id, st.until) : 1 // free and locked: a full ring (green / dashed red)
  const ring = document.createElementNS(SVG, 'svg')
  ring.setAttribute('viewBox', '0 0 100 100'); ring.setAttribute('class', 'ring'); ring.setAttribute('aria-hidden', 'true')
  ring.innerHTML = `<circle cx="50" cy="50" r="${r}" class="ring-track"/><circle cx="50" cy="50" r="${r}" class="ring-fill" stroke-dasharray="${c}" stroke-dashoffset="${(c * (1 - p)).toFixed(1)}"/>`
  return el('span', { class: `porthole ${st.key}`, style: size ? `--size:${size}px` : null }, ring, art ? deviceArt(d, { size: size ? Math.round(size * 0.62) : null }) : null)
}

// ---------- rules in words (same vocabulary as docs/HOST-APP.md) ----------
const DAYS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }
const days = (v) => { const a = [].concat(v || []); return a.length === 2 && a.includes('sat') && a.includes('sun') ? 'at the weekend' : 'on ' + a.map((x) => DAYS[x] || x).join(', ') }
const WHEN = { after_hour: (v) => `After ${v}:00`, weekday: (v) => days(v)[0].toUpperCase() + days(v).slice(1), stock_below: (v) => `When fewer than ${v} are left`, counter_at: (v) => `Every ${v} uses`, overdue: (v) => v ? `When ${v} h late` : 'When late' }
const DO = { lock: () => 'lock it', unlock: () => 'unlock it', set_price: (d) => `price ${money(d.price)} ${DOLLAR}`, notify: (d) => d.text ? `tell me: “${d.text}”` : 'tell me', propose_purchase: (d) => `propose ${d.reason || 'maintenance'}`, keep_deposit: () => 'keep the deposit' }
export const ruleText = (r) => `${(WHEN[r?.when?.kind] || (() => r?.when?.kind))(r?.when?.value)}: ${(DO[r?.do?.kind] || (() => r?.do?.kind))(r?.do || {})}`
export const ruleIcon = (r) => ({ lock: 'lock', unlock: 'lock', set_price: 'wallet', notify: 'info', propose_purchase: 'spark', keep_deposit: 'wallet' }[r?.do?.kind] || 'clock')

// ---------- theme: automatic (system), light or dark; remembered on this device ----------
// The page head sets html[data-theme] before CSS paints (no flash); this button cycles auto → light → dark.
const THEMES = [{ v: null, icon: 'auto', label: 'Theme: automatic' }, { v: 'light', icon: 'sun', label: 'Theme: light' }, { v: 'dark', icon: 'moon', label: 'Theme: dark' }]
const getTheme = () => { try { return localStorage.getItem('hw-theme') } catch { return null } }
function setTheme (v) {
  if (v) document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme
  try { if (v) localStorage.setItem('hw-theme', v); else localStorage.removeItem('hw-theme') } catch {}
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', v || 'light dark')
}
export function themeButton () {
  const b = el('button', { class: 'icon-btn theme-btn', type: 'button' })
  const draw = () => { const t = THEMES.find((x) => x.v === getTheme()) || THEMES[0]; b.setAttribute('aria-label', t.label); b.title = t.label; fill(b, icon(t.icon, { size: 18 })) }
  b.addEventListener('click', () => { const i = THEMES.findIndex((x) => x.v === getTheme()); setTheme(THEMES[(i + 1) % THEMES.length].v); draw() })
  draw()
  return b
}

// ---------- liquid glass refraction (Chrome / Edge) ----------
// Technique from kube.io "Liquid Glass in CSS and SVG": a displacement map shaped like the element's rim bends
// what is behind the glass near its edges (feDisplacementMap used as a backdrop-filter). Other browsers keep the
// frosted glass of app.css. Filters are cached by size, so re-rendered elements of the same size share one.
const chromium = typeof navigator !== 'undefined' && /(Chrome|Edg)\//.test(navigator.userAgent) && !/Firefox|FxiOS/.test(navigator.userAgent)
const reduceTransparency = () => matchMedia('(prefers-reduced-transparency: reduce)').matches
let defs = null
const lensCache = new Map()
function lensFilter (w, h, r, bezel = 22, scale = 46) {
  const key = `${w}x${h}x${r}`
  if (lensCache.has(key)) return lensCache.get(key)
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const g = c.getContext('2d'); const img = g.createImageData(w, h); const px = img.data
  const cx = w / 2; const cy = h / 2; const hx = w / 2 - r; const hy = h / 2 - r
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // distance to the rounded-rect rim and the outward normal there
      const ax = Math.abs(x + 0.5 - cx); const ay = Math.abs(y + 0.5 - cy); const sx = Math.sign(x + 0.5 - cx) || 1; const sy = Math.sign(y + 0.5 - cy) || 1
      const dx = ax - hx; const dy = ay - hy
      let dist; let nx = 0; let ny = 0
      if (dx > 0 && dy > 0) { const l = Math.hypot(dx, dy) || 1; dist = r - l; nx = (dx / l) * sx; ny = (dy / l) * sy } else if (dx > dy) { dist = w / 2 - ax; nx = sx } else { dist = h / 2 - ay; ny = sy }
      const t = Math.max(0, Math.min(1, 1 - dist / bezel)); const m = t * t // convex bevel: strongest at the rim
      const i = (y * w + x) * 4
      px[i] = 128 - nx * m * 127; px[i + 1] = 128 - ny * m * 127; px[i + 2] = 128; px[i + 3] = 255 // sample from inside the glass
    }
  }
  g.putImageData(img, 0, 0)
  if (!defs) {
    const svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true')
    svg.style.position = 'absolute'; defs = document.createElementNS(SVG, 'defs'); svg.append(defs); document.body.append(svg)
  }
  const id = 'lens-' + lensCache.size
  const f = document.createElementNS(SVG, 'filter')
  for (const [k, v] of Object.entries({ id, x: 0, y: 0, width: w, height: h, filterUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' })) f.setAttribute(k, v)
  const fi = document.createElementNS(SVG, 'feImage')
  for (const [k, v] of Object.entries({ href: c.toDataURL(), x: 0, y: 0, width: w, height: h, result: 'map', preserveAspectRatio: 'none' })) fi.setAttribute(k, v)
  const fd = document.createElementNS(SVG, 'feDisplacementMap')
  for (const [k, v] of Object.entries({ in: 'SourceGraphic', in2: 'map', scale, xChannelSelector: 'R', yChannelSelector: 'G' })) fd.setAttribute(k, v)
  f.append(fi, fd); defs.append(f)
  lensCache.set(key, id)
  return id
}
const observed = new WeakSet()
const sizer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((entries) => entries.forEach((e) => applyLens(e.target))) : null
function applyLens (node) {
  const w = Math.round(node.offsetWidth); const h = Math.round(node.offsetHeight)
  if (!w || !h || w * h > 900_000) return
  const r = Math.min(parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0, h / 2, w / 2)
  node.style.setProperty('--lens', `url(#${lensFilter(w, h, Math.round(r))})`)
  node.classList.add('lens')
}
// Give these elements real refraction (call again after re-rendering them).
export function lens (...nodes) {
  if (!chromium || reduceTransparency()) return
  for (const n of nodes.flat()) { if (!n) continue; applyLens(n); if (sizer && !observed.has(n)) { sizer.observe(n); observed.add(n) } }
}
