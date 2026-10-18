/*!
 * Liquid Glass — refraction (plain JavaScript port for HubWallet).
 *
 * Ported from the Angular directive of LiquidGlassSkill (https://github.com/stormaref/LiquidGlassSkill, MIT),
 * whose refraction field is a port of the fragment shader in liquid-glass-js
 * (https://github.com/dashersw/liquid-glass-js) — Copyright (c) 2025 Armagan Amcalar, MIT. Permission is hereby
 * granted, free of charge, to any person obtaining a copy of that software to deal in it without restriction,
 * provided this notice travels with it; it is provided "as is", without warranty of any kind. Keep this header.
 *
 * How it works: per element size, a displacement map is baked into a canvas (edge/rim exponential refraction,
 * corner boost, rim ripple), wrapped in an SVG filter (feImage → feDisplacementMap → feGaussianBlur) and used as
 * `backdrop-filter: url(#…)`, so the live page behind the glass bends at its rim. Chromium only; elsewhere nothing
 * happens and the CSS `backdrop-filter: blur(3px) saturate(125%)` fallback of liquid-glass.css stays in effect.
 *
 *   import { refract } from './refraction.js'
 *   refract(element)            // call again for elements rendered later; same-size elements share one filter
 */

const GLASS_PRESET = { edgeIntensity: 0.015, rimIntensity: 0.028, baseIntensity: 0.05, edgeDistance: 0.5, rimDistance: 1.7, baseDistance: 0.2, cornerBoost: 0.06, rippleEffect: 0.26, blurRadius: 2, warp: false }
const SUPERSAMPLE = 2 // the rim lives in 1–2 px: a 2× map keeps the edge lens crisp
const MAX_MAP_EDGE = 1400 // bound the bake for big surfaces (refraction is edge-local)
const BLUR_STD_PER_RADIUS = 0.35 // fit so blurRadius 2 matches the library's frosting
const SVG = 'http://www.w3.org/2000/svg'

export function supported () {
  const brands = navigator.userAgentData?.brands
  if (brands) return brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/i.test(b.brand))
  return /Chrome\//.test(navigator.userAgent)
}

const filters = new Map() // key → { id, node, refs }
let defs = null
let nextId = 0
function ensureDefs () {
  if (!defs || !defs.isConnected) {
    const svg = document.createElementNS(SVG, 'svg')
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true'); svg.style.position = 'fixed'
    svg.appendChild(document.createElementNS(SVG, 'defs'))
    document.body.appendChild(svg)
    defs = svg
  }
  return defs.querySelector('defs')
}

const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v)))
const resolveRadius = (computed, w, h) => { const v = parseFloat(computed) || 0; return computed.trim().endsWith('%') ? (v / 100) * Math.min(w, h) : v }

// Bake the refraction field: R/G encode the x/y sample offset around neutral, scaled to feDisplacementMap's `scale`.
function buildDisplacementMap (w, h, radius, pageW, pageH, cfg) {
  const ss = Math.max(0.25, Math.min(SUPERSAMPLE, MAX_MAP_EDGE / Math.max(w, h)))
  const bw = Math.max(1, Math.round(w * ss)); const bh = Math.max(1, Math.round(h * ss))
  const r = radius * ss; const minDim = Math.min(w, h)
  const dx = new Float32Array(bw * bh); const dy = new Float32Array(bw * bh)
  let maxAbs = 0
  for (let py = 0; py < bh; py++) {
    for (let px = 0; px < bw; px++) {
      const cx = (px + 0.5) / bw; const cy = (py + 0.5) / bh
      // signed distance to the rounded-rect edge (supersampled px → CSS px)
      const tx = Math.abs(px + 0.5 - bw / 2) - (bw / 2 - r)
      const ty = Math.abs(py + 0.5 - bh / 2) - (bh / 2 - r)
      const outside = Math.hypot(Math.max(tx, 0), Math.max(ty, 0))
      const inside = Math.min(Math.max(tx, ty), 0)
      const distPx = Math.max(-(outside + inside - r), 0) / ss
      const edgeFall = Math.exp(-distPx * cfg.edgeDistance)
      const rimFall = Math.exp(-distPx * cfg.rimDistance)
      const baseFall = 1 - Math.exp(-distPx * cfg.baseDistance)
      const total = (cfg.warp ? baseFall * cfg.baseIntensity : 0) + edgeFall * cfg.edgeIntensity + rimFall * cfg.rimIntensity
      let nx = cx - 0.5; let ny = cy - 0.5 // normal in texcoord space
      const len = Math.hypot(nx, ny)
      if (len > 0) { nx /= len; ny /= len }
      const cornerNorm = Math.max(Math.min(cx, 1 - cx), Math.min(cy, 1 - cy)) * minDim
      const corner = Math.exp(-cornerNorm * 0.3) * cfg.cornerBoost
      const ripple = Math.sin((distPx / minDim) * 25) * cfg.rippleEffect * rimFall
      const fx = (nx * (total + corner) - ny * ripple) * pageW // page-texture fractions → pixels
      const fy = (ny * (total + corner) + nx * ripple) * pageH
      const i = py * bw + px
      dx[i] = fx; dy[i] = fy
      maxAbs = Math.max(maxAbs, Math.abs(fx), Math.abs(fy))
    }
  }
  const scale = Math.max(maxAbs * 2, 1e-4)
  const bias = scale * (128 / 255 - 0.5) // feDisplacementMap decodes 128 as slightly off zero: pre-subtract it
  const canvas = document.createElement('canvas'); canvas.width = bw; canvas.height = bh
  const ctx = canvas.getContext('2d'); const image = ctx.createImageData(bw, bh); const data = image.data
  for (let i = 0; i < bw * bh; i++) {
    data[i * 4] = clampByte(255 * (0.5 + (dx[i] - bias) / scale))
    data[i * 4 + 1] = clampByte(255 * (0.5 + (dy[i] - bias) / scale))
    data[i * 4 + 2] = 128; data[i * 4 + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return { mapUrl: canvas.toDataURL('image/png'), scale }
}

function acquireFilter (key, w, h, radius, pageW, pageH, cfg) {
  let entry = filters.get(key)
  if (entry && entry.node.isConnected) { entry.refs++; return entry }
  if (entry) filters.delete(key)
  const { mapUrl, scale } = buildDisplacementMap(w, h, radius, pageW, pageH, cfg)
  const id = `liquid-glass-${nextId++}`
  const filter = document.createElementNS(SVG, 'filter')
  // the region must extend past the box by the largest displacement plus the blur, or corners clip
  const marginPx = scale / 2 + 3 * cfg.blurRadius * BLUR_STD_PER_RADIUS
  const mx = (marginPx / w) * 100; const my = (marginPx / h) * 100
  for (const [k, v] of Object.entries({ id, x: `${-mx}%`, y: `${-my}%`, width: `${100 + 2 * mx}%`, height: `${100 + 2 * my}%`, 'color-interpolation-filters': 'sRGB' })) filter.setAttribute(k, v)
  const feImage = document.createElementNS(SVG, 'feImage')
  for (const [k, v] of Object.entries({ href: mapUrl, x: 0, y: 0, width: w, height: h, preserveAspectRatio: 'none', result: 'map' })) feImage.setAttribute(k, v)
  const feDisp = document.createElementNS(SVG, 'feDisplacementMap')
  for (const [k, v] of Object.entries({ in: 'SourceGraphic', in2: 'map', scale, xChannelSelector: 'R', yChannelSelector: 'G', result: 'displaced' })) feDisp.setAttribute(k, v)
  const feBlur = document.createElementNS(SVG, 'feGaussianBlur')
  feBlur.setAttribute('in', 'displaced'); feBlur.setAttribute('stdDeviation', String(cfg.blurRadius * BLUR_STD_PER_RADIUS))
  filter.append(feImage, feDisp, feBlur)
  ensureDefs().appendChild(filter)
  entry = { id, node: filter, refs: 1 }
  filters.set(key, entry)
  return entry
}
function release (key) {
  const entry = filters.get(key)
  if (entry && --entry.refs <= 0) { filters.delete(key); entry.node.remove() }
}

// ---------- per-element state: rebuild on element resize and (debounced) on window resize ----------
const state = new WeakMap() // el → { key, frame }
const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((entries) => entries.forEach((e) => schedule(e.target))) : null
let winTimer = 0
const tracked = new Set()
addEventListener('resize', () => { clearTimeout(winTimer); winTimer = setTimeout(() => tracked.forEach((el) => el.isConnected ? schedule(el) : forget(el)), 180) }, { passive: true })

function schedule (el) {
  const s = state.get(el); if (!s) return
  cancelAnimationFrame(s.frame)
  s.frame = requestAnimationFrame(() => rebuild(el))
}
function rebuild (el) {
  const s = state.get(el); if (!s) return
  if (!el.isConnected) { forget(el); return }
  const w = Math.round(el.offsetWidth); const h = Math.round(el.offsetHeight)
  if (w < 2 || h < 2) return
  const radius = Math.min(resolveRadius(getComputedStyle(el).borderTopLeftRadius, w, h), Math.min(w, h) / 2)
  const pageW = innerWidth; const pageH = innerHeight
  const cfg = { ...GLASS_PRESET, ...(s.config || {}) }
  const key = [w, h, Math.round(radius), pageW, pageH, JSON.stringify(cfg)].join('|')
  if (key === s.key) return
  if (s.key) release(s.key)
  const entry = acquireFilter(key, w, h, radius, pageW, pageH, cfg)
  s.key = key
  el.style.backdropFilter = `url(#${entry.id})`
  el.style.webkitBackdropFilter = `url(#${entry.id})`
  el.classList.add('is-refracting')
}
function forget (el) {
  const s = state.get(el); if (!s) return
  if (s.key) release(s.key)
  ro?.unobserve(el); tracked.delete(el); state.delete(el)
}

// Give elements real refraction (Chromium); safe to call repeatedly and on re-rendered elements.
export function refract (...nodes) {
  if (!supported()) return
  for (const el of nodes.flat()) {
    if (!el || state.has(el)) continue
    state.set(el, { key: null, frame: 0, config: null })
    tracked.add(el); ro?.observe(el); schedule(el)
  }
  // drop elements that left the page (re-rendered lists) so their filters can be released
  for (const el of tracked) if (!el.isConnected) forget(el)
}
