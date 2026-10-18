// The hub's local AI: QVAC through its OpenAI-compatible server (qvac serve --openai). Used by the HOST only
// (no AI on the guest side). The model only fills a small JSON (structured output); this file validates every
// field and computes every number. Nothing here saves a device or moves money: it returns a PROPOSAL that the
// host app shows (with a diff) and the host applies (docs/HOST-APP.md §3).
//
// Device config format (docs/HOST-APP.md §2):
//   { id, name, icon, type: use|rent|access, price (HUSD cents), unit, commands: [..],
//     rules: [{ when: { kind, value }, do: { kind, ... } }], version }
//   when.kind: after_hour (0–23) · weekday (['sat','sun']) · stock_below (N) · counter_at (every N uses) · overdue (hours late)
//   do.kind:   lock · unlock · set_price { price } · notify { text } · propose_purchase { reason } · keep_deposit { amount? }
//
// Command line (QVAC_URL=http://<ai-pc>:11434 QVAC_API_KEY=...):
//   node src/ai.js device '{"name":"Bosch WAN28","type":"washing_machine","commands":["start","stop","lock","unlock"]}'
//   node src/ai.js edit "raise it to 2.50 and lock it after 22:00"      (edits the demo washing machine)
//   node src/ai.js rule "every 50 washes propose maintenance"
//   node src/ai.js service "dryer, 2 dollars a cycle"
//   node src/ai.js rules prompts/documents/regolamento-lavanderia.md     (house rules → proposed rules)
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const QVAC_URL = (process.env.QVAC_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '').replace(/\/v1$/, '')
const QVAC_API_KEY = process.env.QVAC_API_KEY || ''
const QVAC_MODEL = process.env.QVAC_MODEL || 'qwen3.5-2b'
const QVAC_TIMEOUT_MS = Number(process.env.QVAC_TIMEOUT_MS || 90_000)

const prompt = (name) => fs.readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8')
const PROMPTS = { service: prompt('service'), rule: prompt('rule'), device: prompt('device'), edit: prompt('edit'), documentRules: prompt('document-rules'), chat: prompt('chat') }

// One call to the model: system prompt + user text, answer forced to match `schema` (JSON schema → grammar).
async function ask (system, text, name, schema, { maxChars = 500, maxTokens = 400 } = {}) {
  text = String(text || '').trim().slice(0, maxChars)
  if (!text) throw new Error('Write a sentence first.')
  let res
  try {
    res = await fetch(`${QVAC_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(QVAC_API_KEY && { Authorization: `Bearer ${QVAC_API_KEY}` }) },
      body: JSON.stringify({
        model: QVAC_MODEL,
        messages: [{ role: 'system', content: system }, { role: 'user', content: text }],
        temperature: 0,
        max_tokens: maxTokens,
        reasoning_budget: false, // Qwen3.5: '/no_think' in the prompt gives HTTP 500 with a schema
        response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } }
      }),
      signal: AbortSignal.timeout(QVAC_TIMEOUT_MS)
    })
  } catch (e) {
    throw new Error(`The local AI is not reachable at ${QVAC_URL} (${e.name === 'TimeoutError' ? 'timeout' : e.message}).`)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`The local AI answered ${res.status}: ${body.error?.message || 'error'}`)
  try {
    return JSON.parse(body.choices[0].message.content)
  } catch {
    throw new Error('The local AI did not return valid JSON. Try rephrasing.')
  }
}

// ---------- helpers: the code, not the model, decides the final values ----------
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const int = (x, min, max) => { x = num(x); return x === null ? null : Math.min(max, Math.max(min, Math.round(x))) }
const cents = (dollars) => Math.min(100_000, Math.max(0, Math.round((num(dollars) || 0) * 100)))
const str = (x, max) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : null)
const money = (c) => (c / 100).toFixed(2)
const nullable = (type) => ({ type: [type, 'null'] })
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'device'

// Money guard: accept an amount from the model only if that number is written in the host's text
// (small models copy numbers from the prompt examples). "20", "20.5" and "20,5" all match.
function written (x, text) {
  x = num(x)
  if (x === null) return false
  const numbers = (String(text).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(',', '.')))
  return numbers.includes(x)
}

// Same guard for percentages: "+10%" is accepted only if 10 is written (the sign comes from the model: 10% off = -10).
// a percentage only when the host wrote one ("10%", "10 percent", "10 per cento"): "set the price to -5" is not -5%
const percentWritten = (x, text) => (/%|percent|per\s?cento/i.test(text) && written(Math.abs(num(x) ?? NaN), text) ? int(x, -90, 200) : null)
// …and the direction of a percentage comes from the host's words, not from the model ("alza del 10%" is +10).
function percentSigned (p, text) {
  if (!p) return p
  const up = /(alza|aumenta|rincara|raise|increase|higher|more|più|\+\s*\d)/i.test(text)
  const down = /(abbass|scont|ridu|dimin|lower|reduce|decrease|cheaper|discount|\boff\b|meno|-\s*\d)/i.test(text)
  if (up && !down) return Math.abs(p)
  if (down && !up) return -Math.abs(p)
  return p
}

// kind of device (chosen by the model) → icon key drawn by web/ui.js (SVG icon, or web/img/<key>.png if present)
const ICONS = {
  washer: 'washer', dryer: 'dryer', iron: 'iron', coffee: 'coffee', door: 'door', locker: 'lock', fridge: 'fridge',
  printer: 'printer', bike: 'bike', scooter: 'bike', parking: 'parking', charger: 'charger', room: 'door', tool: 'device', other: 'device'
}
const TYPES = ['use', 'rent', 'access']
const UNITS = ['use', 'wash', 'cycle', 'coffee', 'drink', 'page', 'session', 'hour']
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
// Same vocabulary as the behaviours engine and the host app (docs/HOST-APP.md §2).
const WHEN = ['after_hour', 'weekday', 'stock_below', 'counter_at', 'overdue']
const DO = ['lock', 'unlock', 'set_price', 'notify', 'propose_purchase', 'keep_deposit']

// ---------- rules ----------
// What the model fills for one rule: flat fields (small models handle flat JSON better than nested unions).
const RULE_FIELDS = {
  whenKind: { type: 'string', enum: WHEN },
  whenNumber: nullable('number'),
  whenDays: { type: 'array', items: { type: 'string', enum: DAYS }, maxItems: 7 },
  doKind: { type: 'string', enum: DO },
  priceDollars: nullable('number'), // set_price: the new price, if written
  pricePercent: nullable('number'), // set_price: +20 / -10, the code computes the price
  reason: nullable('string'), // propose_purchase: what for · notify: the message
  depositDollars: nullable('number') // keep_deposit: amount, if written
}
const ruleSchema = (extra = {}) => ({
  type: 'object',
  properties: { ...extra, ...RULE_FIELDS },
  required: [...Object.keys(extra), ...Object.keys(RULE_FIELDS)],
  additionalProperties: false
})

// Model output → { when, do }. Throws with a message for the host if the rule does not hold together.
// source: the text the host wrote (money guard) · basePrice: the device price in cents (for "+20%")
// suggest: true for plug-and-play suggestions (the host never wrote an hour: the proposal is shown and can be changed).
function buildRule (o, source, basePrice, { suggest = false } = {}) {
  // lock/unlock "at 7" is a time of day: small models sometimes file the hour as a use counter
  if ((o.doKind === 'lock' || o.doKind === 'unlock') && o.whenKind === 'counter_at' && int(o.whenNumber, 0, 99) === o.whenNumber && o.whenNumber <= 23) o = { ...o, whenKind: 'after_hour' }
  if (!WHEN.includes(o.whenKind)) throw new Error('I could not tell when this rule should run.')
  if (!DO.includes(o.doKind)) throw new Error('I could not tell what this rule should do.')
  let value
  if (o.whenKind === 'after_hour') {
    value = int(o.whenNumber, 0, 23)
    // an hour the host did not write ("lock it at night" → 23?) is not invented: ask. "10 pm" is written as 10 → 22.
    if (!suggest && value !== null && !written(value, source) && !(value >= 12 && written(value - 12, source))) {
      throw new Error('From what time? For example "after 22:00".')
    }
  }
  if (o.whenKind === 'stock_below') value = int(o.whenNumber, 1, 1000)
  if (o.whenKind === 'counter_at') value = int(o.whenNumber, 1, 100_000)
  if (o.whenKind === 'overdue') value = int(o.whenNumber, 0, 72) ?? 0
  if (o.whenKind === 'weekday') value = DAYS.filter((d) => (o.whenDays || []).includes(d))
  if (value === null || (Array.isArray(value) && !value.length)) throw new Error('The rule needs a number or a day (e.g. "after 22:00", "at the weekend", "every 50 washes").')

  let act
  if (o.doKind === 'lock' || o.doKind === 'unlock') act = { kind: o.doKind }
  if (o.doKind === 'set_price') {
    const p = percentSigned(percentWritten(o.pricePercent, source), source)
    if (written(o.priceDollars, source)) act = { kind: 'set_price', price: cents(o.priceDollars) }
    else if (p && basePrice > 0) act = { kind: 'set_price', price: Math.round(basePrice * (1 + p / 100)) } // computed here
    else throw new Error('Which price? Write it, e.g. "3 dollars" or "+20%".')
  }
  if (o.doKind === 'notify') act = { kind: 'notify', text: str(o.reason, 140) || 'Rule triggered.' }
  if (o.doKind === 'propose_purchase') act = { kind: 'propose_purchase', reason: str(o.reason, 60) || 'maintenance' }
  if (o.doKind === 'keep_deposit') {
    act = { kind: 'keep_deposit' }
    if (written(o.depositDollars, source)) act.amount = cents(o.depositDollars)
  }
  return { when: { kind: o.whenKind, value }, do: act }
}
// rent is always per hour; a door is one 'use'; otherwise the unit the model chose, if known
const unitFor = (type, unit) => type === 'rent' ? 'hour' : type === 'access' ? 'use' : (UNITS.includes(unit) && unit !== 'hour' ? unit : 'use')
const sameRule = (a, b) => JSON.stringify([a.when, a.do]) === JSON.stringify([b.when, b.do])

// A rule in plain English, for the prompts (same wording as web/host.js).
export function ruleText (r) {
  const v = r.when?.value
  const when = { after_hour: `after ${v}:00`, weekday: `on ${[].concat(v).join(', ')}`, stock_below: `when stock is below ${v}`, counter_at: `every ${v} uses`, overdue: `when ${v} h overdue` }[r.when?.kind] || r.when?.kind
  const d = r.do || {}
  const act = { lock: 'lock it', unlock: 'unlock it', set_price: `set the price to ${money(d.price || 0)}`, notify: `notify the host (${d.text})`, propose_purchase: `propose a purchase (${d.reason})`, keep_deposit: 'keep the deposit' }[d.kind] || d.kind
  return `${when}: ${act}`
}

// ---------- device descriptor → device config (plug-and-play) ----------
// A new device introduces itself (in the product via Matter / Home Assistant; in the demo the host pastes it).
// → a device config (format above, version 1) with a suggested price and 0–3 rules. NOT saved.
export async function deviceToService (descriptor) {
  let d = descriptor
  if (typeof d === 'string') { try { d = JSON.parse(d) } catch { d = { name: d } } }
  if (!d || typeof d !== 'object' || !Object.keys(d).length) throw new Error('Paste the device descriptor first.')
  const out = await ask(PROMPTS.device, JSON.stringify(d), 'device', {
    type: 'object',
    properties: {
      name: { type: 'string' },
      kind: { type: 'string', enum: Object.keys(ICONS) },
      type: { type: 'string', enum: TYPES },
      priceDollars: { type: 'number' },
      unit: { type: 'string', enum: UNITS },
      rules: { type: 'array', maxItems: 3, items: ruleSchema() }
    },
    required: ['name', 'kind', 'type', 'priceDollars', 'unit', 'rules'],
    additionalProperties: false
  }, { maxChars: 2000, maxTokens: 700 })
  const type = TYPES.includes(out.type) ? out.type : 'use'
  const name = str(out.name, 40) || str(d.name, 40) || 'New device'
  const commands = (Array.isArray(d.commands) ? d.commands : Array.isArray(d.capabilities) ? d.capabilities : ['start', 'stop'])
    .filter((c) => typeof c === 'string').map((c) => c.slice(0, 30)).slice(0, 10)
  const price = type === 'access' ? 0 : cents(out.priceDollars) // a suggestion: the host sees it and can change it
  const rules = []
  for (const o of type === 'access' ? [] : out.rules || []) { // a door: the guest's key decides, no automatic rules
    try {
      const r = buildRule(o, JSON.stringify(d), price, { suggest: true })
      // lock/unlock only if the device can do it; a door is opened by the guest's key, never on a timer
      if ((r.do.kind === 'lock' || r.do.kind === 'unlock') && (type === 'access' || !commands.includes(r.do.kind))) continue
      if (!rules.some((x) => sameRule(x, r))) rules.push(r)
    } catch {} // a suggested rule that does not hold together is dropped: the host can add rules by text
  }
  return {
    id: slug(name),
    name,
    icon: ICONS[out.kind] || ICONS.other,
    type,
    price,
    unit: unitFor(type, out.unit),
    commands,
    rules,
    version: 1
  }
}

// ---------- add a device through a guided chat ----------
// messages: [{ role: 'host'|'ai', text }] (the whole conversation so far) · existingIds: ids already on the hub.
// → { reply, proposed? }. The model re-reads the conversation and fills the slots; the CODE decides what is
// missing and asks one question at a time (device → price → rules); `proposed` = device config, not saved.
// If the host pastes a device descriptor (JSON), it is plug-and-play: deviceToService answers at once.
export async function chatDevice (messages, { existingIds = [] } = {}) {
  const msgs = (Array.isArray(messages) ? messages : []).filter((m) => m && typeof m.text === 'string' && m.text.trim()).slice(-12)
  const hostText = msgs.filter((m) => m.role === 'host').map((m) => m.text).join('\n')
  const uniqueId = (name) => { let id = slug(name); for (let n = 2; existingIds.includes(id); n++) id = `${slug(name)}-${n}`; return id }
  if (!hostText.trim()) return { reply: 'Hi! What device do you want to connect? For example "a dryer in the back room", or paste its descriptor (JSON).' }

  const last = msgs.filter((m) => m.role === 'host').pop().text.trim()
  if (last.startsWith('{')) { // a pasted descriptor: plug-and-play
    let d = null
    try { d = JSON.parse(last) } catch {}
    if (d && typeof d === 'object') {
      const proposed = await deviceToService(d)
      proposed.id = uniqueId(proposed.name)
      return { reply: 'I read the device descriptor. Here is the configuration I propose: check it and apply it, or tell me what to change.', proposed }
    }
  }

  const transcript = msgs.map((m) => `${m.role === 'host' ? 'Host' : 'AI'}: ${m.text.trim()}`).join('\n')
  const out = await ask(PROMPTS.chat, transcript, 'chat', {
    type: 'object',
    properties: {
      name: nullable('string'),
      kind: { type: ['string', 'null'], enum: [...Object.keys(ICONS), null] },
      type: { type: 'string', enum: TYPES },
      priceDollars: nullable('number'),
      unit: { type: 'string', enum: UNITS },
      rulesAnswered: { type: 'boolean' },
      rules: { type: 'array', maxItems: 4, items: ruleSchema() }
    },
    required: ['name', 'kind', 'type', 'priceDollars', 'unit', 'rulesAnswered', 'rules'],
    additionalProperties: false
  }, { maxChars: 3000, maxTokens: 600 })

  const name = str(out.name, 40)
  if (!name) return { reply: 'Which device do you want to connect? For example "a dryer", "a washing machine", "an iron".' }
  const type = TYPES.includes(out.type) ? out.type : 'use'
  const unit = unitFor(type, out.unit)
  const free = /\b(free|gratis|gratuit[ao])\b/i.test(hostText)
  const price = type === 'access' || free ? 0 : (written(out.priceDollars, hostText) ? cents(out.priceDollars) : null)
  const lower = name.toLowerCase()
  if (price === null) return { reply: `How much should one ${unit} of the ${lower} cost, in HUSD? For example "2.50".` }

  const rules = []
  let ruleProblem = null
  for (const o of type === 'access' ? [] : out.rules || []) {
    try { const r = buildRule(o, hostText, price); if (!rules.some((x) => sameRule(x, r))) rules.push(r) } catch (e) { ruleProblem = e.message }
  }
  if (ruleProblem && !rules.length) return { reply: ruleProblem }
  if (!out.rulesAnswered && !rules.length && type !== 'access') {
    return { reply: `Any rules for the ${lower}? For example "lock it after 22:00" or "maintenance every 50 uses". Say "no" if none.` }
  }
  // a device the host asks to lock/unlock must accept those commands
  const commands = ['start', 'stop', ...(rules.some((r) => r.do.kind === 'lock' || r.do.kind === 'unlock') ? ['lock', 'unlock'] : [])]
  const proposed = { id: uniqueId(name), name, icon: ICONS[out.kind] || ICONS.other, type, price, unit, commands, rules, version: 1 }
  return { reply: 'Here is the configuration I propose. Check it and apply it, or tell me what to change.', proposed }
}

// ---------- edit a device in plain language ----------
// → { proposed } (config, not saved) or { reply } (a question when something is missing: "How much?").
// The host page sends in `text` everything the host wrote since the last applied change, so the answer to the
// question ("10%") arrives together with the first request ("raise the price").
// "raise it to 2.50 and lock it after 22:00" + current config → proposed config (same id, version unchanged:
// the hub increments it when the host applies). The model returns only the CHANGES; this code applies them,
// so fields nobody asked to change (id, commands, …) cannot be damaged.
export async function editDevice (text, current) {
  if (!current || typeof current !== 'object' || !current.id) throw new Error('Unknown device.')
  const { state, earned, ...cur } = current // runtime fields are not part of the config
  const rules = Array.isArray(cur.rules) ? cur.rules : []
  const summary = [
    `Device: ${cur.name} (${cur.type}), price ${money(cur.price || 0)} dollars per ${cur.unit || 'use'}.`,
    `Commands: ${(cur.commands || []).join(', ') || 'none'}.`,
    rules.length ? 'Current rules:\n' + rules.map((r, i) => `${i + 1}. ${ruleText(r)}`).join('\n') : 'Current rules: none.',
    (cur.options || []).length ? 'Current options: ' + cur.options.map((o) => `${o.name} ${money(o.price)}${o.minutes ? ` ${o.minutes} min` : ''}`).join(', ') + '.' : 'Current options: none.'
  ].join('\n')
  const out = await ask(`${PROMPTS.edit}\n\n${summary}`, text, 'edit', {
    type: 'object',
    properties: {
      newName: nullable('string'),
      newPriceDollars: nullable('number'),
      pricePercent: nullable('number'),
      removeRules: { type: 'array', items: { type: 'integer' }, maxItems: 10 },
      removeAllRules: { type: 'boolean' },
      addRules: { type: 'array', maxItems: 4, items: ruleSchema() },
      askedPriceChange: { type: 'boolean' }, // the host wants another base price, even without saying how much
      // options = small services of the machine (espresso / cappuccino, wash 30° / 60°)
      addOptions: { type: 'array', maxItems: 6, items: { type: 'object', properties: { name: { type: 'string' }, priceDollars: nullable('number'), minutes: nullable('integer'), fromHour: nullable('integer'), toHour: nullable('integer') }, required: ['name', 'priceDollars', 'minutes', 'fromHour', 'toHour'], additionalProperties: false } },
      removeOptions: { type: 'array', maxItems: 8, items: { type: 'string' } }
    },
    required: ['newName', 'newPriceDollars', 'pricePercent', 'removeRules', 'removeAllRules', 'addRules', 'askedPriceChange', 'addOptions', 'removeOptions'],
    additionalProperties: false
  }, { maxTokens: 900 })

  // removing needs the host's words ("give me the owner key" once removed a rule)
  const removing = /(remove|delete|drop|without|no more|togli|rimuovi|elimina|cancella|senza|basta|leva)/i.test(text)
  if (!removing) { out.removeRules = []; out.removeAllRules = false; out.removeOptions = [] }
  // prices: whole cents from 0.01 to 1000.00, said back to the host instead of silently rounded or capped
  for (const v of [out.newPriceDollars, ...(out.addOptions || []).map((o) => o.priceDollars)]) {
    const x = num(v)
    if (x === null || !written(x, text)) continue
    const minus = new RegExp(`(^|[^\\d])-\\s*${String(Math.abs(x)).replace('.', '[.,]')}(?![\\d%.,])`).test(text) // "-5", not "-10%" nor "8-20"
    if (x < 0 || minus) return { reply: 'A price cannot be negative. Write a price from 0.01 to 1000.00, or say "free".' }
    if (x > 1000) return { reply: 'The highest price is 1000.00 dollars. Write a lower price.' }
    if (x > 0 && x < 0.01) return { reply: 'The smallest price is 0.01 dollars (one cent).' }
  }
  const next = structuredClone(cur)
  const name = str(out.newName, 40)
  if (name && name !== cur.name) next.name = name
  // price: only a number the host wrote, or a percentage computed here
  const p = percentSigned(percentWritten(out.pricePercent, text), text)
  // "make it free": decided by the code from the words, not by the model (it is money)
  const free = /\b(free|gratis|gratuit[ao])\b/i.test(text) && !/\d/.test(text)
  if (free) next.price = 0
  else if (written(out.newPriceDollars, text)) next.price = cents(out.newPriceDollars)
  else if (p && cur.price > 0) next.price = Math.round(cur.price * (1 + p / 100))
  // rules: remove by number (1 = first), then add the new ones
  const drop = new Set((out.removeRules || []).map((n) => n - 1))
  next.rules = out.removeAllRules === true ? [] : rules.filter((_, i) => !drop.has(i))
  let ruleProblem = null
  let already = false
  for (const o of out.addRules || []) {
    try {
      const r = buildRule(o, text, next.price)
      if ((r.do.kind === 'lock' || r.do.kind === 'unlock') && cur.type === 'access') continue // never lock a guest out
      // "lock it after 23" replaces "lock it after 22" (one lock time and one unlock time); prices per hour band add up
      const replaced = (x) => ['lock', 'unlock'].includes(r.do.kind) && r.when.kind === 'after_hour' && x.when.kind === 'after_hour' && x.do.kind === r.do.kind
      next.rules = next.rules.filter((x) => !replaced(x))
      if (next.rules.some((x) => sameRule(x, r))) already = true
      else next.rules.push(r)
    } catch (e) { ruleProblem = e.message } // e.g. "lock it at night": which hour? → asked below
  }
  // options: price, minutes and hours are kept only if the host wrote those numbers (money guard)
  const key = (n) => String(n).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '')
  const dropOpt = new Set((out.removeOptions || []).map(key))
  let options = (cur.options || []).filter((o) => !dropOpt.has(key(o.name)))
  const addOpts = (out.addOptions || []).filter((o) => str(o.name, 30))
  for (const o of addOpts) {
    if (!written(o.priceDollars, text)) { ruleProblem = `How much is ${str(o.name, 30)}? Write its price (e.g. "${str(o.name, 30)} 2.00").`; continue }
    const opt = { name: str(o.name, 30), price: cents(o.priceDollars) }
    if (Number.isInteger(o.minutes) && written(o.minutes, text)) opt.minutes = o.minutes
    if (Number.isInteger(o.fromHour) && Number.isInteger(o.toHour) && written(o.fromHour, text) && written(o.toHour, text)) { opt.from = o.fromHour; opt.to = o.toHour }
    options = options.filter((x) => key(x.name) !== key(opt.name)).concat(opt)
  }
  // a price written for a new option is that option's price, not the machine's
  if (addOpts.length && addOpts.some((o) => num(o.priceDollars) === num(out.newPriceDollars))) next.price = cur.price
  if (options.length) next.options = options; else delete next.options
  const pricedRule = next.rules.some((r) => r.do.kind === 'set_price' && !rules.some((x) => sameRule(x, r)))
  if (out.askedPriceChange === true && next.price === cur.price && !pricedRule && !free) {
    return { reply: 'How much? Write the new price (e.g. 3.50) or a percentage (e.g. +10%).' }
  }
  if (JSON.stringify(next) === JSON.stringify(cur)) {
    if (already && !ruleProblem) return { reply: 'This rule is already on the device. Anything else?' }
    return { reply: ruleProblem || 'I did not get what to change. You can change the price ("price 2.50", "+10%"), add a rule ("lock it after 22:00", "maintenance every 50 uses"), remove one ("remove rule 1") or add a service ("add cappuccino 2.00").' }
  }
  return { proposed: next }
}

// ---------- one rule from plain language (for a device) ----------
// → { when, do, text }
export async function textToRule (text, device = {}) {
  const out = await ask(`${PROMPTS.rule}\n\nDevice: ${device.name || 'device'}, price ${money(device.price || 0)} dollars.`, text, 'rule', ruleSchema())
  return { ...buildRule(out, text, device.price || 0), text: str(text, 200) }
}

// ---------- a new service from plain language ----------
// "dryer, 2 dollars a cycle" → device config (version 1, no commands known yet, no rules)
export async function textToService (text) {
  const out = await ask(PROMPTS.service, text, 'service', {
    type: 'object',
    properties: {
      name: { type: 'string' },
      kind: { type: 'string', enum: Object.keys(ICONS) },
      type: { type: 'string', enum: TYPES },
      priceDollars: { type: 'number' },
      unit: { type: 'string', enum: UNITS }
    },
    required: ['name', 'kind', 'type', 'priceDollars', 'unit'],
    additionalProperties: false
  })
  let type = TYPES.includes(out.type) ? out.type : 'use'
  if (type === 'access' && cents(out.priceDollars) > 0) type = 'use' // a key is never sold; a price means pay per use
  const name = str(out.name, 40) || 'Service'
  return {
    id: slug(name),
    name,
    icon: ICONS[out.kind] || ICONS.other,
    type,
    price: type === 'access' ? 0 : (written(out.priceDollars, text) ? cents(out.priceDollars) : 0),
    unit: unitFor(type, out.unit),
    commands: [],
    rules: [],
    version: 1
  }
}

// ---------- house documents → rules (private: the documents stay in the hub) ----------
// House rules / contract / manual → the rules the devices can apply by themselves, proposed to the host.
// devices: the hub's device configs. → [{ deviceId, when, do, text }]  (0–8; the host confirms each one)
export async function documentToRules (text, devices) {
  const ids = (devices || []).map((d) => String(d.id)).filter(Boolean)
  if (!ids.length) throw new Error('The hub has no devices yet.')
  const list = devices.map((d) => `${d.id}: ${d.name}`).join('\n')
  const out = await ask(`${PROMPTS.documentRules}\nThe hub's devices:\n${list}`, text, 'document_rules', {
    type: 'object',
    properties: { rules: { type: 'array', maxItems: 8, items: ruleSchema({ deviceId: { type: 'string', enum: ids }, description: { type: 'string' } }) } },
    required: ['rules'],
    additionalProperties: false
  }, { maxChars: 6000, maxTokens: 1200 })
  const rules = []
  for (const o of out.rules || []) {
    const dev = devices.find((d) => String(d.id) === o.deviceId)
    if (!dev) continue
    try {
      const r = { deviceId: dev.id, ...buildRule(o, text, dev.price || 0), text: str(o.description, 200) }
      if (!rules.some((x) => x.deviceId === r.deviceId && sameRule(x, r))) rules.push(r)
    } catch {}
  }
  return rules
}

// ---------- command line, for testing without the hub ----------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...words] = process.argv.slice(2)
  const text = words.join(' ')
  const demo = [ // the demo laundry (docs/PLAN.md "Demo scope"), format of docs/HOST-APP.md §2
    { id: 'washer', name: 'Washing machine', icon: '🧺', type: 'use', price: 300, unit: 'wash', commands: ['start', 'stop', 'lock', 'unlock'], rules: [{ when: { kind: 'counter_at', value: 50 }, do: { kind: 'propose_purchase', reason: 'maintenance' } }], version: 1 },
    { id: 'dryer', name: 'Dryer', icon: '🌀', type: 'use', price: 200, unit: 'cycle', commands: ['start', 'stop', 'lock', 'unlock'], rules: [], version: 1 }
  ]
  const fn = {
    device: () => deviceToService(text),
    edit: () => editDevice(text, demo[0]),
    rule: () => textToRule(text, demo[0]),
    service: () => textToService(text),
    rules: () => documentToRules(fs.readFileSync(text, 'utf8'), demo) // text = path of a document
  }[cmd]
  if (!fn) { console.error('usage: node src/ai.js device|edit|rule|service|rules <descriptor JSON, text or document path>'); process.exit(1) }
  const t = Date.now()
  try {
    console.log(JSON.stringify(await fn(), null, 2))
    console.error(`(${((Date.now() - t) / 1000).toFixed(1)} s, model ${QVAC_MODEL} at ${QVAC_URL})`)
  } catch (e) { console.error('error:', e.message); process.exit(1) }
}
