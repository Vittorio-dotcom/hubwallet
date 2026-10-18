// HubWallet Liquid Glass motion (iOS 26 material) for the three pages. Plain ES module, no dependency.
// - light: a specular highlight follows the pointer on glass surfaces (CSS vars --mx/--my)
// - press: glass bulges and glows on touch, then springs back (.press + spring easing in app.css)
// - morph: the top bar compacts on scroll; sheets grow out of the element that opened them
// - droplets: tab and segmented-control indicators slide and stretch like a drop of liquid; page dots merge (goo filter)
// Respects prefers-reduced-motion (no morphing, no stretching; light and colour stay).

import { refract } from './refraction.js'

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const SPRING = 'linear(0, 0.009, 0.035 2.1%, 0.141, 0.281 6.7%, 0.723 12.9%, 0.938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161, 1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, 0.991, 0.977 51%, 0.974 53.8%, 0.975 57.1%, 0.997 69.8%, 1.003 76.9%, 1.004 83.8%, 1)'
const LIGHT = '.group, .overview, .device-card, .confirm, .proposal, .screen-pay, .composer, .sign-banner, .pass, .topbar, .tabbar, .icon-btn, .btn, .seg, .suggest button'
const PRESS = '.btn, .icon-btn, .cell, .pass, .device-card, .tab, .suggest button, .hub-switch button, .seg button'

// ---------- light + press (event delegation: works for elements rendered later) ----------
let started = false
export function liquid () {
  if (started) return
  started = true
  // the SVG goo filter used by .dots
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true'); svg.style.position = 'absolute'
  svg.innerHTML = '<filter id="goo"><feGaussianBlur in="SourceGraphic" stdDeviation="1.4" result="b"/><feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 16 -6"/></filter>'
  document.body.append(svg)

  // refraction only on the two floating bars. An SVG backdrop-filter is repainted on every scroll frame for
  // every element that has it: on all glass surfaces the pages dropped to 22–35 fps (host desktop 22, guest
  // phone 31; 60 with bars only, measured with Playwright on the demo PC). Cards, groups and sheets keep the
  // CSS glass of liquid-glass.css (blur + saturate), which costs almost nothing.
  const GLASS = '.topbar, .tabbar'
  const scan = (root) => { if (root.matches?.(GLASS)) refract(root); root.querySelectorAll?.(GLASS).forEach((n) => refract(n)) }
  scan(document.body)
  new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && scan(n)))).observe(document.body, { childList: true, subtree: true })

  let lit = null
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest?.(LIGHT)
    if (lit && lit !== t) { lit.style.removeProperty('--mx'); lit.style.removeProperty('--my') }
    lit = t
    if (!t) return
    const r = t.getBoundingClientRect()
    t.style.setProperty('--mx', `${e.clientX - r.left}px`)
    t.style.setProperty('--my', `${e.clientY - r.top}px`)
  }, { passive: true })
  const release = () => document.querySelectorAll('.press').forEach((n) => n.classList.remove('press'))
  document.addEventListener('pointerdown', (e) => { const t = e.target.closest?.(PRESS); if (t && !t.disabled) t.classList.add('press') }, { passive: true })
  for (const ev of ['pointerup', 'pointercancel', 'dragstart']) document.addEventListener(ev, release, { passive: true })
  document.addEventListener('pointerleave', release, { passive: true })
}

// ---------- top bar: compacts and shows the page title after scrolling past it ----------
export function morphTopbar (bar, titleEl) {
  if (!bar) return
  const label = document.createElement('span'); label.className = 'topbar-title'; label.setAttribute('aria-hidden', 'true')
  bar.append(label)
  const update = () => {
    label.textContent = titleEl?.textContent || ''
    const past = titleEl ? titleEl.getBoundingClientRect().bottom < bar.getBoundingClientRect().bottom : scrollY > 40
    bar.classList.toggle('compact', past)
  }
  addEventListener('scroll', update, { passive: true }); update()
  return update
}

// ---------- a glass droplet that slides to the selected option and stretches on the way ----------
function moveThumb (thumb, target, container, first) {
  // layout offsets, not screen rects: they stay right while the sheet is still scaling in
  const to = { left: target.offsetLeft, width: target.offsetWidth }
  const from = { left: parseFloat(thumb.style.left) || to.left, width: parseFloat(thumb.style.width) || to.width }
  thumb.style.left = to.left + 'px'; thumb.style.width = to.width + 'px'
  if (first || reduced() || !thumb.animate) return
  // stretch: the droplet first reaches over both positions, then the back catches up (with a spring overshoot)
  const minL = Math.min(from.left, to.left); const maxR = Math.max(from.left + from.width, to.left + to.width)
  thumb.animate([
    { left: from.left + 'px', width: from.width + 'px', transform: 'scaleY(1)' },
    { left: minL + 'px', width: (maxR - minL) + 'px', transform: 'scaleY(.86)', offset: 0.45 },
    { left: to.left + 'px', width: to.width + 'px', transform: 'scaleY(1)' }
  ], { duration: 560, easing: SPRING })
}
// options: the buttons inside container; isSelected(button) → boolean. Call the returned function after a change.
export function droplet (container, selector, isSelected, cls = 'seg-thumb') {
  if (!container) return () => {}
  let thumb = container.querySelector(':scope > .' + cls)
  if (!thumb) { thumb = document.createElement('span'); thumb.className = cls; thumb.setAttribute('aria-hidden', 'true'); container.prepend(thumb) }
  let first = true
  const sync = () => {
    const sel = [...container.querySelectorAll(selector)].find(isSelected)
    if (!sel) { thumb.style.opacity = '0'; return }
    thumb.style.opacity = '1'
    moveThumb(thumb, sel, container, first); first = false
  }
  addEventListener('resize', () => { first = true; sync() }, { passive: true })
  requestAnimationFrame(sync)
  return sync
}

// ---------- floating tab bar: minimises while scrolling down, expands when scrolling up ----------
export function tabbar (bar) {
  if (!bar) return
  let last = scrollY
  addEventListener('scroll', () => {
    const y = scrollY
    if (Math.abs(y - last) < 6) return
    bar.classList.toggle('mini', y > last && y > 80)
    last = y
  }, { passive: true })
}

// ---------- sheets: the panel grows out of the element that was tapped (and goes back into it) ----------
export function morphOpen (panel, from) {
  if (!panel?.animate || reduced()) return
  const p = panel.getBoundingClientRect()
  let start = { transform: 'translateY(48px) scale(.96)', opacity: 0 }
  if (from) {
    const r = from.getBoundingClientRect()
    const dx = (r.left + r.width / 2) - (p.left + p.width / 2); const dy = (r.top + r.height / 2) - (p.top + p.height / 2)
    const sx = Math.max(0.15, r.width / p.width); const sy = Math.max(0.08, r.height / p.height)
    start = { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.4, borderRadius: '28px' }
  }
  panel.animate([start, { transform: 'none', opacity: 1 }], { duration: 620, easing: SPRING })
  panel.closest('.sheet')?.animate([{ backgroundColor: 'rgba(0,0,0,0)' }, {}], { duration: 300, easing: 'ease-out' })
}
export async function morphClose (sheet) {
  const panel = sheet?.querySelector('.sheet-panel')
  if (!panel?.animate || reduced()) return
  await Promise.all([
    panel.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(60px) scale(.94)', opacity: 0 }], { duration: 240, easing: 'cubic-bezier(.4,0,1,1)' }).finished,
    sheet.animate([{}, { backgroundColor: 'rgba(0,0,0,0)' }], { duration: 240 }).finished
  ]).catch(() => {})
}
