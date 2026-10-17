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
const percentWritten = (x, text) => (written(Math.abs(num(x) ?? NaN), text) ? int(x, -90, 200) : null)

const ICONS = {
  washer: '🧺', dryer: '🌀', door: '🚪', locker: '🔐', fridge: '🍺', coffee: '☕', printer: '🖨️',
  bike: '🚲', scooter: '🛴', parking: '🅿️', charger: '🔌', room: '🛏️', tool: '🛠️', other: '🧩'
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
function buildRule (o, source, basePrice) {
  // lock/unlock "at 7" is a time of day: small models sometimes file the hour as a use counter
  if ((o.doKind === 'lock' || o.doKind === 'unlock') && o.whenKind === 'counter_at' && int(o.whenNumber, 0, 99) === o.whenNumber && o.whenNumber <= 23) o = { ...o, whenKind: 'after_hour' }
  if (!WHEN.includes(o.whenKind)) throw new Error('I could not tell when this rule should run.')
  if (!DO.includes(o.doKind)) throw new Error('I could not tell what this rule should do.')
  let value
  if (o.whenKind === 'after_hour') value = int(o.whenNumber, 0, 23)
  if (o.whenKind === 'stock_below') value = int(o.whenNumber, 1, 1000)
  if (o.whenKind === 'counter_at') value = int(o.whenNumber, 1, 100_000)
  if (o.whenKind === 'overdue') value = int(o.whenNumber, 0, 72) ?? 0
  if (o.whenKind === 'weekday') value = DAYS.filter((d) => (o.whenDays || []).includes(d))
  if (value === null || (Array.isArray(value) && !value.length)) throw new Error('The rule needs a number or a day (e.g. "after 22:00", "at the weekend", "every 50 washes").')

  let act
  if (o.doKind === 'lock' || o.doKind === 'unlock') act = { kind: o.doKind }
  if (o.doKind === 'set_price') {
    const p = percentWritten(o.pricePercent, source)
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
      const r = buildRule(o, JSON.stringify(d), price)
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
  for (const o of type === 'access' ? [] : out.rules || []) {
    try { const r = buildRule(o, hostText, price); if (!rules.some((x) => sameRule(x, r))) rules.push(r) } catch {}
  }
  if (!out.rulesAnswered && !rules.length && type !== 'access') {
    return { reply: `Any rules for the ${lower}? For example "lock it after 22:00" or "maintenance every 50 uses". Say "no" if none.` }
  }
  // a device the host asks to lock/unlock must accept those commands
  const commands = ['start', 'stop', ...(rules.some((r) => r.do.kind === 'lock' || r.do.kind === 'unlock') ? ['lock', 'unlock'] : [])]
  const proposed = { id: uniqueId(name), name, icon: ICONS[out.kind] || ICONS.other, type, price, unit, commands, rules, version: 1 }
  return { reply: 'Here is the configuration I propose. Check it and apply it, or tell me what to change.', proposed }
}

// ---------- edit a device in plain language ----------
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
    rules.length ? 'Current rules:\n' + rules.map((r, i) => `${i + 1}. ${ruleText(r)}`).join('\n') : 'Current rules: none.'
  ].join('\n')
  const out = await ask(`${PROMPTS.edit}\n\n${summary}`, text, 'edit', {
    type: 'object',
    properties: {
      newName: nullable('string'),
      newPriceDollars: nullable('number'),
      pricePercent: nullable('number'),
      removeRules: { type: 'array', items: { type: 'integer' }, maxItems: 10 },
      removeAllRules: { type: 'boolean' },
      addRules: { type: 'array', maxItems: 4, items: ruleSchema() }
    },
    required: ['newName', 'newPriceDollars', 'pricePercent', 'removeRules', 'removeAllRules', 'addRules'],
    additionalProperties: false
  }, { maxTokens: 600 })

  const next = structuredClone(cur)
  const name = str(out.newName, 40)
  if (name && name !== cur.name) next.name = name
  // price: only a number the host wrote, or a percentage computed here
  const p = percentWritten(out.pricePercent, text)
  // "make it free": decided by the code from the words, not by the model (it is money)
  const free = /\b(free|gratis|gratuit[ao])\b/i.test(text) && !/\d/.test(text)
  if (free) next.price = 0
  else if (written(out.newPriceDollars, text)) next.price = cents(out.newPriceDollars)
  else if (p && cur.price > 0) next.price = Math.round(cur.price * (1 + p / 100))
  // rules: remove by number (1 = first), then add the new ones
  const drop = new Set((out.removeRules || []).map((n) => n - 1))
  next.rules = out.removeAllRules === true ? [] : rules.filter((_, i) => !drop.has(i))
  for (const o of out.addRules || []) {
    try {
      const r = buildRule(o, text, next.price)
      if ((r.do.kind === 'lock' || r.do.kind === 'unlock') && cur.type === 'access') continue // never lock a guest out
      // "lock it after 23" replaces "lock it after 22" (one time rule per action), it does not add a second one
      const replaced = (x) => r.when.kind === 'after_hour' && x.when.kind === 'after_hour' && x.do.kind === r.do.kind
      next.rules = next.rules.filter((x) => !replaced(x))
      if (!next.rules.some((x) => sameRule(x, r))) next.rules.push(r)
    } catch {}
  }
  if (JSON.stringify(next) === JSON.stringify(cur)) throw new Error('I did not understand what to change. Try e.g. "price 2.50", "lock it after 22:00", "remove rule 1".')
  return next
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
