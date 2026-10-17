// The hub's local AI: QVAC through its OpenAI-compatible server (qvac serve --openai).
// The model only fills a small JSON (structured output); this file validates every
// field and computes every number. Nothing here moves money.
//
//   QVAC_URL=http://<ai-pc>:11434 QVAC_API_KEY=... node src/ai.js service "e-bike, 3 dollars an hour, max 4 hours"
//   node src/ai.js behaviour "if fewer than 3 beers, propose a restock"   (services from HUB_URL or a demo list)
//   node src/ai.js bundle "a wash and then the bike for 2 hours"
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const QVAC_URL = (process.env.QVAC_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '').replace(/\/v1$/, '')
const QVAC_API_KEY = process.env.QVAC_API_KEY || ''
const QVAC_MODEL = process.env.QVAC_MODEL || 'qwen3.5-2b'
const QVAC_TIMEOUT_MS = Number(process.env.QVAC_TIMEOUT_MS || 90_000)

const prompt = (name) => fs.readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8')
const PROMPTS = { service: prompt('service'), behaviour: prompt('behaviour'), bundle: prompt('bundle') }

// One call to the model: system prompt + user text, answer forced to match `schema`.
async function ask (system, text, name, schema) {
  text = String(text || '').trim().slice(0, 500)
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
        max_tokens: 400,
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
const listServices = (services) => services.map((s) => `${s.id}: ${s.name} (${s.type})`).join('\n')
function serviceIds (services) {
  const ids = (services || []).map((s) => String(s.id)).filter(Boolean)
  if (!ids.length) throw new Error('The hub has no services yet.')
  return ids
}

const ICONS = {
  door: '🚪', gate: '🚧', locker: '🔐', room: '🛏️', washer: '🧺', dryer: '🌀', fridge: '🍺', coffee: '☕',
  printer: '🖨️', bike: '🚲', scooter: '🛴', car: '🚗', parking: '🅿️', charger: '🔌', tool: '🛠️', other: '🧩'
}
const TYPES = ['access', 'use', 'rent']
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const TRIGGERS = ['stock_below', 'weekday', 'overdue', 'after_hour']
const ACTIONS = ['propose_purchase', 'change_price', 'notify']
const nullable = (type) => ({ type: [type, 'null'] })

// ---------- text → service ----------
// → { name, icon, type, price (cents; per hour for rent), unit, maxHours? }
export async function textToService (text) {
  const out = await ask(PROMPTS.service, text, 'service', {
    type: 'object',
    properties: {
      name: { type: 'string' },
      kind: { type: 'string', enum: Object.keys(ICONS) },
      type: { type: 'string', enum: TYPES },
      priceDollars: { type: 'number' },
      maxHours: nullable('integer')
    },
    required: ['name', 'kind', 'type', 'priceDollars', 'maxHours'],
    additionalProperties: false
  })
  let type = TYPES.includes(out.type) ? out.type : 'use'
  if (type === 'access' && cents(out.priceDollars) > 0) type = 'use' // a key is never sold; a price means pay per use
  const svc = {
    name: str(out.name, 40) || 'Service',
    icon: ICONS[out.kind] || ICONS.other,
    type,
    price: type === 'access' ? 0 : cents(out.priceDollars),
    unit: type === 'rent' ? 'hour' : 'use'
  }
  if (type === 'rent') svc.maxHours = int(out.maxHours, 1, 24) || undefined
  return svc
}

// ---------- text → behaviour ----------
// → { serviceId, trigger: { kind, value }, action: { kind, ... } }
//   trigger.value: stock_below → items left · weekday → ['sat','sun'] · overdue → hours late · after_hour → 0–23
//   action: propose_purchase { item, quantity?, maxAmount? (cents) } · change_price { percent } · notify { message }
export async function textToBehaviour (text, services) {
  const ids = serviceIds(services)
  const out = await ask(`${PROMPTS.behaviour}\nThe hub's services:\n${listServices(services)}`, text, 'behaviour', {
    type: 'object',
    properties: {
      serviceId: { type: 'string', enum: ids },
      triggerKind: { type: 'string', enum: TRIGGERS },
      triggerNumber: nullable('number'),
      triggerDays: { type: 'array', items: { type: 'string', enum: DAYS }, maxItems: 7 },
      actionKind: { type: 'string', enum: ACTIONS },
      purchaseItem: nullable('string'),
      purchaseQuantity: nullable('integer'),
      purchaseMaxDollars: nullable('number'),
      pricePercent: nullable('number'),
      message: nullable('string')
    },
    required: ['serviceId', 'triggerKind', 'triggerNumber', 'triggerDays', 'actionKind', 'purchaseItem',
      'purchaseQuantity', 'purchaseMaxDollars', 'pricePercent', 'message'],
    additionalProperties: false
  })
  if (!ids.includes(out.serviceId)) throw new Error('I could not tell which service this rule is for.')
  if (!TRIGGERS.includes(out.triggerKind)) throw new Error('I could not tell when this rule should run.')
  if (!ACTIONS.includes(out.actionKind)) throw new Error('I could not tell what this rule should do.')

  let value
  if (out.triggerKind === 'stock_below') value = int(out.triggerNumber, 1, 1000)
  if (out.triggerKind === 'overdue') value = int(out.triggerNumber, 0, 72) ?? 0
  if (out.triggerKind === 'after_hour') value = int(out.triggerNumber, 0, 23)
  if (out.triggerKind === 'weekday') value = DAYS.filter((d) => (out.triggerDays || []).includes(d))
  if (value === null || (Array.isArray(value) && !value.length)) throw new Error('The rule needs a number or a day (e.g. "fewer than 3", "at the weekend", "after 10 pm").')

  let action
  if (out.actionKind === 'propose_purchase') {
    const item = str(out.purchaseItem, 40)
    if (!item) throw new Error('What should the hub propose to buy?')
    action = { kind: 'propose_purchase', item }
    const quantity = int(out.purchaseQuantity, 1, 1000)
    if (quantity) action.quantity = quantity
    if (num(out.purchaseMaxDollars)) action.maxAmount = cents(out.purchaseMaxDollars)
  }
  if (out.actionKind === 'change_price') {
    const percent = int(out.pricePercent, -90, 200)
    if (!percent) throw new Error('By how much should the price change?')
    action = { kind: 'change_price', percent }
  }
  if (out.actionKind === 'notify') {
    action = { kind: 'notify', message: str(out.message, 140) || `Rule triggered: ${str(text, 100)}` }
  }
  return { serviceId: out.serviceId, trigger: { kind: out.triggerKind, value }, action, text: str(text, 200) }
}

// ---------- text → bundle ----------
// → [{ serviceId, hours? }]  (hours only for rent, clamped to the service's maxHours)
export async function textToBundle (text, services) {
  const ids = serviceIds(services)
  const out = await ask(`${PROMPTS.bundle}\nThe hub's services:\n${listServices(services)}`, text, 'bundle', {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          properties: { serviceId: { type: 'string', enum: ids }, hours: nullable('integer') },
          required: ['serviceId', 'hours'],
          additionalProperties: false
        }
      }
    },
    required: ['items'],
    additionalProperties: false
  })
  const bundle = []
  for (const it of out.items || []) {
    const svc = services.find((s) => String(s.id) === it.serviceId)
    if (!svc || svc.type === 'access' || bundle.some((b) => b.serviceId === svc.id)) continue
    bundle.push(svc.type === 'rent' ? { serviceId: svc.id, hours: int(it.hours, 1, svc.maxHours || 24) || 1 } : { serviceId: svc.id })
  }
  return bundle
}

// ---------- command line, for testing without the hub ----------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...words] = process.argv.slice(2)
  const text = words.join(' ')
  const demo = [
    { id: 'door', name: 'Front door', type: 'access' },
    { id: 'washer', name: 'Washing machine', type: 'use', price: 200 },
    { id: 'bike', name: 'E-bike', type: 'rent', price: 300, maxHours: 4 },
    { id: 'fridge', name: 'Minibar', type: 'use', price: 250 }
  ]
  const services = process.env.HUB_URL
    ? (await (await fetch(`${process.env.HUB_URL.replace(/\/+$/, '')}/api/services`)).json()).services
    : demo
  const fn = { service: () => textToService(text), behaviour: () => textToBehaviour(text, services), bundle: () => textToBundle(text, services) }[cmd]
  if (!fn) { console.error('usage: node src/ai.js service|behaviour|bundle <text>'); process.exit(1) }
  const t = Date.now()
  try {
    console.log(JSON.stringify(await fn(), null, 2))
    console.error(`(${((Date.now() - t) / 1000).toFixed(1)} s, model ${QVAC_MODEL} at ${QVAC_URL})`)
  } catch (e) { console.error('error:', e.message); process.exit(1) }
}
