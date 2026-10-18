// The device layer of a hub (docs/HOST-APP.md): which devices the hub sells, their price and rules, their state.
// Runs inside the hub server (src/hub.js), on top of the payment layer (src/hub-core.js). It never touches the
// wallet: it only calls hub.requestPayment() and listens to hub.on('paid').
//
//   data/<hub>/devices/<id>.json        current config of each device (docs/HOST-APP.md §2)
//   data/<hub>/devices/<id>.v<n>.json   previous versions, for rollback
//   data/<hub>/devices-state.json       runtime: status, until, earned, uses, notices, demo clock
//
// Env: DOLLAR_ASSET (rgb:… asset id of HUSD: required to sell; never a ticker) · USE_MS (one "use" runs this long,
// demo 45 s) · HOUR_MS (one rental hour, demo 60 s) · DEMO_DEVICES=1 (an empty hub starts with washer + dryer).
//
// Routes (mounted under /api). Owner (X-Hub-Key):
//   GET  /devices                    → [config + { state, earned, uses }]
//   POST /devices/chat {messages}    → { reply, proposed? }   add a device by chatting with the AI (not saved)
//   POST /devices {config}           → saved config (version 1)
//   POST /devices/:id/edit {text}    → { proposed, diff } or { reply } (the AI asks: "How much?", "From what time?")
//   POST /devices/documents {text}   → [{ deviceId, rule: { when, do }, text }]   rules from a house document (not saved)
//   POST /devices/:id/apply {config} → saved config (version + 1; the previous one is kept)
//   POST /devices/:id/rollback {version} · DELETE /devices/:id
//   GET  /devices/notices            → what the rules raised (maintenance, notify)
//   POST /devices/clock {hour|null}  → demo: pretend it is that hour (to show "locked after 22:00")
// Public (guest app, device pages):
//   GET  /services                   → { name, dollar, dollarId, services: [{ id, name, icon, type, price, unit, rules, state }] }
//   POST /services/:id/order {hours?} → { id (= payment id), serviceId, assetId, amount, invoice, recipientId, status }
//   GET  /orders/:id                 → public payment + serviceId + service
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { chatDevice, editDevice, documentToRules, ruleText } from './ai.js'

const TYPES = ['use', 'rent', 'access']
const WHEN = ['after_hour', 'weekday', 'stock_below', 'counter_at', 'overdue']
const DO = ['lock', 'unlock', 'set_price', 'notify', 'propose_purchase', 'keep_deposit']
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] // index = Date.getDay()
const ID_RE = /^[a-z0-9][a-z0-9-]{0,29}$/

const DEMO = [ // the demo laundry (docs/PLAN.md "Demo scope")
  { id: 'washer', name: 'Washing machine', icon: 'washer', type: 'use', price: 300, unit: 'wash', commands: ['start', 'stop', 'lock', 'unlock'], rules: [{ when: { kind: 'counter_at', value: 50 }, do: { kind: 'propose_purchase', reason: 'maintenance' } }], version: 1 },
  { id: 'dryer', name: 'Dryer', icon: 'dryer', type: 'use', price: 200, unit: 'cycle', commands: ['start', 'stop', 'lock', 'unlock'], rules: [], version: 1 }
]

// ---------- validation by code: the AI's proposal (or a page's request) is never saved as is ----------
// Returns a clean config with known fields only, or throws with every problem found.
export function validateDevice (cfg, { current } = {}) {
  const errors = []
  if (!cfg || typeof cfg !== 'object') throw new Error('A device configuration is required.')
  const id = String(cfg.id || '')
  if (!ID_RE.test(id)) errors.push('The id must be lowercase letters, digits and dashes (max 30).')
  if (current && id !== current.id) errors.push('The device id cannot change.')
  const name = String(cfg.name || '').trim()
  if (!name || name.length > 40) errors.push('The name must be 1 to 40 characters.')
  if (!TYPES.includes(cfg.type)) errors.push('Unknown device type (use, rent, access).')
  if (!Number.isInteger(cfg.price) || cfg.price < 0 || cfg.price > 100_000) errors.push('The price must be a whole number of cents (0 to 100000).')
  const commands = Array.isArray(cfg.commands) ? cfg.commands.filter((c) => typeof c === 'string').map((c) => c.slice(0, 30)).slice(0, 10) : []
  const rules = []
  for (const r of Array.isArray(cfg.rules) ? cfg.rules.slice(0, 10) : []) {
    const w = r?.when; const d = r?.do
    if (!WHEN.includes(w?.kind)) { errors.push(`Unknown rule condition: ${w?.kind}`); continue }
    if (!DO.includes(d?.kind)) { errors.push(`Unknown rule action: ${d?.kind}`); continue }
    let value = w.value
    if (w.kind === 'after_hour' && !(Number.isInteger(value) && value >= 0 && value <= 23)) errors.push('"after_hour" needs an hour 0–23.')
    if (['stock_below', 'counter_at'].includes(w.kind) && !(Number.isInteger(value) && value > 0)) errors.push(`"${w.kind}" needs a positive whole number.`)
    if (w.kind === 'overdue' && !(Number.isInteger(value) && value >= 0)) value = 0
    if (w.kind === 'weekday') { value = [].concat(value).filter((x) => DAYS.includes(x)); if (!value.length) errors.push('"weekday" needs days (mon…sun).') }
    const act = { kind: d.kind }
    if (d.kind === 'set_price') { if (!Number.isInteger(d.price) || d.price < 0 || d.price > 100_000) errors.push('"set_price" needs a price in whole cents.'); else act.price = d.price }
    if (d.kind === 'notify') act.text = String(d.text || 'Rule triggered.').slice(0, 140)
    if (d.kind === 'propose_purchase') act.reason = String(d.reason || 'maintenance').slice(0, 60)
    if (d.kind === 'keep_deposit' && Number.isInteger(d.amount) && d.amount > 0) act.amount = d.amount
    if ((d.kind === 'lock' || d.kind === 'unlock') && cfg.type === 'access') errors.push('A door has no timed lock: the guest\'s key decides.')
    rules.push({ when: { kind: w.kind, value }, do: act })
  }
  if (errors.length) throw new Error(errors.join(' '))
  const clean = { id, name, icon: String(cfg.icon || 'device').slice(0, 20), type: cfg.type, price: cfg.price, unit: String(cfg.unit || 'use').slice(0, 12), commands, rules, version: Number.isInteger(cfg.version) && cfg.version > 0 ? cfg.version : 1 }
  if (cfg.type === 'rent' && Number.isInteger(cfg.maxHours) && cfg.maxHours > 0) clean.maxHours = Math.min(cfg.maxHours, 24)
  // options = small services of one machine (espresso / macchiato / cappuccino; wash 30° / 60°), each with
  // its own price, optionally its own run time (minutes) and the hours it is offered (from–to, 0–24)
  const options = []
  for (const o of Array.isArray(cfg.options) ? cfg.options.slice(0, 8) : []) {
    const oname = String(o?.name || '').trim().slice(0, 30)
    const oid = String(o?.id || oname).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)
    if (!oname || !oid) { errors.push('Every option needs a name.'); continue }
    if (!Number.isInteger(o.price) || o.price < 0 || o.price > 100_000) { errors.push(`The price of "${oname}" must be a whole number of cents.`); continue }
    const opt = { id: oid, name: oname, price: o.price }
    if (o.minutes != null) { if (Number.isInteger(o.minutes) && o.minutes > 0 && o.minutes <= 600) opt.minutes = o.minutes; else errors.push(`The time of "${oname}" must be 1–600 minutes.`) }
    if (o.from != null || o.to != null) {
      if (Number.isInteger(o.from) && Number.isInteger(o.to) && o.from >= 0 && o.from <= 23 && o.to >= 1 && o.to <= 24 && o.from !== o.to) { opt.from = o.from; opt.to = o.to } else errors.push(`The hours of "${oname}" must be like 7-11.`)
    }
    if (!options.some((x) => x.id === oid)) options.push(opt)
  }
  if (errors.length) throw new Error(errors.join(' '))
  if (options.length) clean.options = options
  return clean
}

// The host's words → the new options list, read by code (prices and times are never the AI's):
//   "options: espresso 1.50, cappuccino 2.00 7-11"   replace the list ("opzioni:", "servizi:" too)
//   "add cappuccino 2 euro" · "aggiungi lavaggio 60° 3,50 90 min"   add or replace one
//   "remove cappuccino" · "togli l'opzione cappuccino" · "no options"
// Each item: <name> <price> [<n> min] [<from>-<to>]. Returns null when the text is about something else.
const ITEM = /^(.+?)\s+(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur|euro|\$|dollars?|husd)?(?:\s+(\d{1,3})\s*(?:min|minutes?|minuti|')\.?)?(?:\s+(?:dalle\s+|from\s+)?(\d{1,2})(?:[:.]00)?\s*(?:-|–|alle|to)\s*(\d{1,2})(?:[:.]00)?)?$/i
function parseItem (t) {
  const m = String(t).trim().replace(/^(?:un[oa']?|a|an|the|il|lo|la|l')\s+/i, '').match(ITEM)
  if (!m) return null
  const o = { name: m[1].trim().replace(/[:=-]$/, '').trim(), price: Math.round(Number(m[2].replace(',', '.')) * 100) }
  if (m[3]) o.minutes = Number(m[3])
  if (m[4] != null) { o.from = Number(m[4]); o.to = Number(m[5]) }
  return o.name ? o : null
}
const nameKey = (n) => String(n).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '')
export function optionChange (text, current = []) {
  const t = String(text || '').trim().replace(/[.!]+$/, '')
  if (/^(no|nessun[ao]?|senza|remove all|togli tutt[ei])\s+(le\s+)?(options?|opzioni|servizi)$/i.test(t)) return []
  const list = t.match(/^(?:options?|opzioni|servizi|services|choices?|scelte)\s*[:=]?\s*(.+)$/i)
  if (list) {
    const items = list[1].split(/[;\n]+|,(?!\d)/).map(parseItem)
    return items.length && items.every(Boolean) ? items : null
  }
  const add = t.match(/^(?:add|aggiungi|metti|inserisci)\s+(?:(?:an?|the|un[oa']?|il|lo|la|l')\s*)?(?:option|opzione|servizio|service)?\s*:?\s*(.+)$/i)
  // "add a rule: lock after 22" is for the AI, not an option (unless the host says option/servizio)
  if (add && !/\b(option|opzione|servizio|service)\b/i.test(t) && /(rul|regol|lock|blocc|unlock|sblocc|after|dopo|prima|before|mainten|manutenz|%|price|prezzo|weekend|notify|avvisa)/i.test(t)) return null
  if (add) {
    const items = add[1].split(/[;\n]+|,(?!\d)/).map(parseItem)
    if (!items.length || !items.every(Boolean)) return null
    const keep = (current || []).filter((o) => !items.some((n) => nameKey(n.name) === nameKey(o.name)))
    return [...keep, ...items]
  }
  const del = t.match(/^(?:remove|delete|togli|rimuovi|elimina)\s+(?:(?:the|l'|il|la|lo)\s*)?(?:option|opzione|servizio|service)?\s*:?\s*(.+)$/i)
  if (del && current?.some((o) => nameKey(o.name) === nameKey(del[1]))) return current.filter((o) => nameKey(o.name) !== nameKey(del[1]))
  return null
}

// What changed between two configs, in words the host reads before pressing Apply.
export function diffDevices (a, b) {
  const out = []
  for (const k of ['name', 'icon', 'type', 'price', 'unit']) if (a[k] !== b[k]) out.push({ field: k, from: a[k], to: b[k] })
  const ra = (a.rules || []).map(ruleText); const rb = (b.rules || []).map(ruleText)
  for (const r of rb) if (!ra.includes(r)) out.push({ field: 'rule', to: r })
  for (const r of ra) if (!rb.includes(r)) out.push({ field: 'rule', from: r })
  const opt = (d) => (d.options || []).map((o) => `${o.name} ${(o.price / 100).toFixed(2)}${o.minutes ? ` ${o.minutes} min` : ''}${o.from != null ? ` ${o.from}–${o.to}` : ''}`).join(', ')
  if (opt(a) !== opt(b)) out.push({ field: 'options', from: opt(a) || 'none', to: opt(b) || 'none' })
  return out
}

export class DeviceLayer {
  constructor (hub, { dollarId = process.env.DOLLAR_ASSET, useMs = Number(process.env.USE_MS || 45_000), hourMs = Number(process.env.HOUR_MS || 60_000) } = {}) {
    this.hub = hub
    this.dollarId = dollarId || null
    this.useMs = useMs
    this.hourMs = hourMs
    this.minuteMs = Number(process.env.MINUTE_MS || 60_000) // an option's run time; demo: MINUTE_MS=1000 (a 40 min wash runs 40 s)
    this.dir = path.join(hub.wallet.dir, 'devices')
    this.stateFile = path.join(hub.wallet.dir, 'devices-state.json')
    fs.mkdirSync(this.dir, { recursive: true })
    this.state = fs.existsSync(this.stateFile) ? JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) : { devices: {}, notices: [], clockHour: null }
    if (process.env.DEMO_DEVICES === '1' && !this.list().length) for (const d of DEMO) this.write(d)
    // A payment for a device settled: the device starts, its counters move, its rules may fire.
    hub.on('paid', (p) => { try { this.onPaid(p) } catch (e) { console.error('devices:', e.message) } })
  }

  // ---------- storage ----------
  file (id, version) { return path.join(this.dir, version ? `${id}.v${version}.json` : `${id}.json`) }
  list () {
    return fs.readdirSync(this.dir).filter((f) => /^[a-z0-9-]+\.json$/.test(f))
      .map((f) => JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'))).sort((a, b) => a.id.localeCompare(b.id))
  }
  get (id) {
    if (!ID_RE.test(String(id)) || !fs.existsSync(this.file(id))) throw new Error('Unknown device.')
    return JSON.parse(fs.readFileSync(this.file(id), 'utf8'))
  }
  write (cfg) { fs.writeFileSync(this.file(cfg.id), JSON.stringify({ ...cfg, updatedAt: new Date().toISOString() }, null, 1)) }
  saveState () { fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 1)) }
  rt (id) { return (this.state.devices[id] ||= { status: 'idle', until: 0, earned: 0, uses: 0, lastTriggered: {} }) }

  add (config) {
    const cfg = validateDevice({ ...config, version: 1 })
    if (fs.existsSync(this.file(cfg.id))) throw new Error(`A device with id "${cfg.id}" already exists.`)
    this.write(cfg)
    return this.get(cfg.id)
  }
  apply (id, config) {
    const current = this.get(id)
    const cfg = validateDevice({ ...config, version: current.version + 1 }, { current })
    fs.writeFileSync(this.file(id, current.version), JSON.stringify(current, null, 1)) // keep the previous version
    this.write(cfg)
    return this.get(id)
  }
  rollback (id, version) {
    const current = this.get(id)
    if (!Number.isInteger(version) || !fs.existsSync(this.file(id, version))) throw new Error('Unknown version.')
    const old = JSON.parse(fs.readFileSync(this.file(id, version), 'utf8'))
    return this.apply(id, old) // the rollback is a new version: nothing is lost
  }
  remove (id) { this.get(id); fs.unlinkSync(this.file(id)); delete this.state.devices[id]; this.saveState(); return { ok: true } }

  // ---------- state and rules (time and price rules; the counter rules fire in onPaid) ----------
  hour () { return Number.isInteger(this.state.clockHour) ? this.state.clockHour : new Date().getHours() }
  // an option with hours (from–to) is offered only then; "22-6" wraps past midnight
  optionOpen (o) {
    if (o.from == null) return true
    const h = this.hour()
    return o.from < o.to ? h >= o.from && h < o.to : h >= o.from || h < o.to
  }
  // Locked by the "after_hour" rules: the most recent lock/unlock event of the day (wrapping past midnight) wins.
  lockedByRules (cfg) {
    const ev = (cfg.rules || []).filter((r) => r.when.kind === 'after_hour' && (r.do.kind === 'lock' || r.do.kind === 'unlock'))
      .map((r) => ({ h: r.when.value, lock: r.do.kind === 'lock' })).sort((a, b) => a.h - b.h)
    if (!ev.length) return false
    const h = this.hour()
    if (!ev.some((e) => !e.lock)) return ev.some((e) => h >= e.h) // only "lock after H": locked until midnight
    const last = [...ev].reverse().find((e) => e.h <= h) || ev[ev.length - 1]
    return last.lock
  }
  // Price now, computed here (never by the AI): the base price, then a "weekday → set_price" rule for today, then an
  // hour band "after_hour H → set_price": from H until the next band or midnight (before the first band: no band).
  effectivePrice (cfg) {
    const rules = (cfg.rules || []).filter((x) => x.do.kind === 'set_price')
    let price = cfg.price
    const day = rules.filter((x) => x.when.kind === 'weekday' && x.when.value.includes(DAYS[new Date().getDay()])).pop()
    if (day) price = day.do.price
    const h = this.hour()
    const band = rules.filter((x) => x.when.kind === 'after_hour' && x.when.value <= h).sort((a, b) => a.when.value - b.when.value).pop()
    if (band) price = band.do.price
    return price
  }
  status (cfg) {
    const rt = this.rt(cfg.id)
    if (rt.until > Date.now()) return { status: 'running', until: rt.until }
    if (this.lockedByRules(cfg)) return { status: 'locked' }
    return { status: 'idle' }
  }
  view (cfg) { const rt = this.rt(cfg.id); return { ...cfg, price: this.effectivePrice(cfg), basePrice: cfg.price, state: this.status(cfg), earned: rt.earned, uses: rt.uses, lastTriggered: rt.lastTriggered } }
  notice (deviceId, text, kind) {
    this.state.notices.unshift({ at: Date.now(), deviceId, kind, text })
    this.state.notices = this.state.notices.slice(0, 100)
  }

  onPaid (p) {
    const id = p.meta?.serviceId
    if (!id || !fs.existsSync(this.file(id))) return
    const cfg = this.get(id)
    const rt = this.rt(id)
    const opt = cfg.options?.find((o) => o.id === p.meta.option)
    const runFor = cfg.type === 'rent' ? (p.meta.hours || 1) * this.hourMs : opt?.minutes ? opt.minutes * this.minuteMs : this.useMs
    rt.until = Date.now() + runFor
    rt.status = 'running'
    rt.earned += p.amount
    rt.uses += 1
    // counter rules: "every 50 uses → propose maintenance / notify the host"
    cfg.rules.forEach((r, i) => {
      if (r.when.kind !== 'counter_at' || rt.uses % r.when.value !== 0) return
      rt.lastTriggered[i] = Date.now()
      if (r.do.kind === 'propose_purchase') this.notice(id, `${cfg.name}: ${rt.uses} uses, ${r.do.reason} proposed.`, 'propose_purchase')
      if (r.do.kind === 'notify') this.notice(id, `${cfg.name}: ${r.do.text}`, 'notify')
    })
    this.hub.trace?.append('device.start', p.id, { deviceId: id, until: rt.until })
    this.saveState()
    console.log(`[device ${id}] running until ${new Date(rt.until).toLocaleTimeString()} (payment ${p.id})`)
  }

  // ---------- public: a guest orders a device; the price comes from the device config, never from the request ----------
  async order (id, { hours, option } = {}) {
    const cfg = this.get(id)
    if (!this.dollarId) throw new Error('This hub has no dollar asset configured (DOLLAR_ASSET).')
    if (cfg.type === 'access') throw new Error('A door is opened with your key, not paid.')
    const st = this.status(cfg)
    if (st.status === 'running') throw new Error(`${cfg.name} is busy. Try again in a moment.`)
    if (st.status === 'locked') throw new Error(`${cfg.name} is locked by the owner's rules right now.`)
    const h = cfg.type === 'rent' ? Math.min(Math.max(1, Math.round(Number(hours) || 1)), cfg.maxHours || 24) : 1
    // with options the guest picks one; its price comes from the config, never from the request
    const opt = cfg.options?.length ? cfg.options.find((o) => o.id === option) : null
    if (cfg.options?.length && !opt) throw new Error(`Choose one of: ${cfg.options.map((o) => o.name).join(', ')}.`)
    if (opt && !this.optionOpen(opt)) throw new Error(`${opt.name} is offered from ${opt.from}:00 to ${opt.to}:00.`)
    const amount = (opt ? opt.price : this.effectivePrice(cfg)) * h
    const p = await this.hub.requestPayment({
      assetId: this.dollarId, amount,
      description: opt ? `${cfg.name}, ${opt.name}` : cfg.type === 'rent' ? `${cfg.name}, ${h} h` : `${cfg.name}, 1 ${cfg.unit}`,
      meta: { serviceId: cfg.id, hours: h, option: opt?.id }
    })
    return { id: p.id, serviceId: cfg.id, assetId: p.assetId, amount: p.amount, hours: h, option: opt?.id, invoice: p.invoice, recipientId: p.recipientId, status: p.status }
  }

  publicService (cfg) {
    const v = this.view(cfg)
    return { id: v.id, name: v.name, icon: v.icon, type: v.type, price: v.price, unit: v.unit, maxHours: v.maxHours, options: v.options?.map((o) => ({ ...o, open: this.optionOpen(o) })), rules: v.rules, state: v.state }
  }

  // ---------- HTTP ----------
  router () {
    const r = express.Router()
    const owner = (req, res, next) => this.hub.isOwner(req) ? next() : res.status(401).json({ error: 'Owner key required (X-Hub-Key).' })
    const wrap = (fn) => (req, res) => Promise.resolve().then(() => fn(req)).then((x) => res.json(x)).catch((e) => res.status(400).json({ error: String(e.message || e) }))

    // owner
    r.get('/devices', owner, wrap(() => this.list().map((d) => this.view(d))))
    r.get('/devices/notices', owner, wrap(() => this.state.notices))
    r.post('/devices/clock', owner, wrap((req) => {
      const h = req.body?.hour
      this.state.clockHour = Number.isInteger(h) && h >= 0 && h <= 23 ? h : null
      this.saveState()
      return { hour: this.hour(), simulated: this.state.clockHour !== null }
    }))
    // { base, text }: a proposal is already on screen and the host asks to change it ("make it 2 dollars"):
    // edit that proposal instead of starting the conversation again.
    r.post('/devices/chat', owner, wrap(async (req) => {
      if (req.body?.base && req.body?.text) {
        const base = validateDevice(req.body.base)
        const opts = optionChange(req.body.text, base.options)
        if (opts) return { reply: 'Options set. Check them and add the machine, or tell me what else to change.', proposed: validateDevice({ ...base, options: opts }, { current: base }) }
        const out = await editDevice(String(req.body.text), base)
        if (out.reply) return { reply: out.reply }
        return { reply: 'Updated. Check it and apply it, or tell me what else to change.', proposed: validateDevice(out.proposed, { current: base }) }
      }
      // first proposal: options the host already listed in the chat ("options: espresso 1.50, cappuccino 2") go in too
      const out = await chatDevice(req.body?.messages, { existingIds: this.list().map((d) => d.id) })
      if (out.proposed) {
        let opts = null
        for (const m of (req.body?.messages || []).filter((x) => x?.role === 'host')) opts = optionChange(m.text, opts || []) || opts
        if (opts?.length) out.proposed = validateDevice({ ...out.proposed, options: opts })
      }
      return out
    }))
    r.post('/devices', owner, wrap((req) => this.add(req.body?.config)))
    // { text } = what the host wrote since the last applied change (the page joins the answers to the AI's questions);
    // { messages } alone works too. → { proposed, diff } or { reply } when the AI needs something ("How much?").
    r.post('/devices/:id/edit', owner, wrap(async (req) => {
      const current = this.get(req.params.id)
      const msgs = Array.isArray(req.body?.messages) ? req.body.messages : []
      const text = req.body?.text || msgs.filter((m) => m?.role === 'host').map((m) => m.text).join('. ')
      // { base }: the proposal on screen, so changes add up ("price 3", then "and lock it after 22")
      const base = req.body?.base ? validateDevice({ ...req.body.base, version: current.version }, { current }) : current
      const latest = String(req.body?.text || '').split('. ').pop() // the latest request
      const opts = optionChange(latest, base.options)
      const r = opts ? { proposed: { ...base, options: opts } } : await editDevice(text, base)
      if (r.reply) return { reply: r.reply }
      const proposed = validateDevice(r.proposed, { current })
      return { proposed, diff: diffDevices(current, proposed) }
    }))
    // House documents (rules, contract, manual) → proposed rules per device, NOT saved: the page adds the chosen ones
    // to the device config and saves with /devices/:id/apply. The document text is not stored by the hub.
    r.post('/devices/documents', owner, wrap(async (req) => {
      const text = String(req.body?.text || '').trim()
      if (!text) throw new Error('Paste the text of the document first.')
      if (text.length > 6000) throw new Error('Document too long for the local AI: paste the part with the rules (max 6000 characters).')
      return (await documentToRules(text, this.list())).map((r) => ({ deviceId: r.deviceId, rule: { when: r.when, do: r.do }, text: r.text }))
    }))
    r.post('/devices/:id/apply', owner, wrap((req) => this.apply(req.params.id, req.body?.config)))
    r.post('/devices/:id/rollback', owner, wrap((req) => this.rollback(req.params.id, Number(req.body?.version))))
    r.delete('/devices/:id', owner, wrap((req) => this.remove(req.params.id)))

    // public
    r.get('/services', wrap(() => ({ name: this.hub.name, dollar: 'HUSD', dollarId: this.dollarId, services: this.list().map((d) => this.publicService(d)) })))
    r.post('/services/:id/order', wrap((req) => this.order(req.params.id, req.body || {})))
    r.get('/orders/:id', wrap((req) => {
      const p = this.hub.getPayment(req.params.id)
      const id = p.meta?.serviceId
      const cfg = id && fs.existsSync(this.file(id)) ? this.get(id) : null
      return { ...this.hub.publicPayment(p), serviceId: id, service: cfg ? this.publicService(cfg) : null }
    }))
    return r
  }
}

export const createDeviceLayer = (hub, opts) => new DeviceLayer(hub, opts)
