// The hub's local AI: QVAC through its OpenAI-compatible server (qvac serve --openai).
// The model only fills a small JSON (structured output); this file validates every
// field and computes every number. Nothing here moves money.
//
//   QVAC_URL=http://<ai-pc>:11434 QVAC_API_KEY=... node src/ai.js service "e-bike, 3 dollars an hour, max 4 hours"
//   node src/ai.js behaviour "if fewer than 3 beers, propose a restock"   (services from HUB_URL or a demo list)
//   node src/ai.js bundle "a wash and then the bike for 2 hours"
//   node src/ai.js device '{"name":"Bosch WAN28","type":"washing_machine","commands":["start","lock","unlock"]}'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const QVAC_URL = (process.env.QVAC_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '').replace(/\/v1$/, '')
const QVAC_API_KEY = process.env.QVAC_API_KEY || ''
const QVAC_MODEL = process.env.QVAC_MODEL || 'qwen3.5-2b'
const QVAC_TIMEOUT_MS = Number(process.env.QVAC_TIMEOUT_MS || 90_000)

const prompt = (name) => fs.readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8')
const PROMPTS = { service: prompt('service'), behaviour: prompt('behaviour'), bundle: prompt('bundle'), device: prompt('device'), documentRules: prompt('document-rules'), assistant: prompt('assistant') }

// One call to the model: system prompt + user text, answer forced to match `schema`.
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
// Money guard: accept an amount from the model only if that number is written in the host's text
// (small models copy numbers from the prompt examples). "20", "20.5" and "20,5" all match 20.5 / 20.
function written (x, text) {
  x = num(x)
  if (x === null) return false
  const numbers = (String(text).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(',', '.')))
  return numbers.includes(x)
}
const listServices =(services) => services.map((s) => `${s.id}: ${s.name} (${s.type})`).join('\n')
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
const TRIGGERS = ['stock_below', 'weekday', 'overdue', 'after_hour', 'use_count']
// Same action names as src/behaviours.js (docs/PLAN.md section 4).
const ACTIONS = ['propose_purchase', 'change_price', 'notify', 'lock', 'unlock', 'keep_deposit']
const nullable = (type) => ({ type: [type, 'null'] })

// ---------- text → service ----------
// What the model fills for a service; the code turns it into the hub's service JSON (buildService).
const SERVICE_FIELDS = {
  name: { type: 'string' },
  kind: { type: 'string', enum: Object.keys(ICONS) },
  type: { type: 'string', enum: TYPES },
  priceDollars: { type: 'number' },
  maxHours: nullable('integer')
}

// → { name, icon, type, price (cents; per hour for rent), unit, maxHours? }
export async function textToService (text) {
  const out = await ask(PROMPTS.service, text, 'service', {
    type: 'object',
    properties: SERVICE_FIELDS,
    required: Object.keys(SERVICE_FIELDS),
    additionalProperties: false
  })
  return buildService(out)
}

function buildService (out) {
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
// What the model fills for one rule (flat: small models handle flat JSON better than nested unions).
const BEHAVIOUR_FIELDS = {
  triggerKind: { type: 'string', enum: TRIGGERS },
  triggerNumber: nullable('number'),
  triggerDays: { type: 'array', items: { type: 'string', enum: DAYS }, maxItems: 7 },
  actionKind: { type: 'string', enum: ACTIONS },
  purchaseItem: nullable('string'),
  purchaseQuantity: nullable('integer'),
  purchaseMaxDollars: nullable('number'),
  pricePercent: nullable('number'),
  depositDollars: nullable('number'),
  message: nullable('string')
}

// → { serviceId, trigger: { kind, value }, action: { kind, ... }, text }
//   trigger.value: stock_below → items left · weekday → ['sat','sun'] · overdue → hours late · after_hour → 0–23 · use_count → every N uses
//   action: propose_purchase { item, quantity?, maxAmount? (cents) } · change_price { percent } · notify { message }
//           lock {} · unlock {} · keep_deposit { amount? (cents; absent = the whole deposit) }
export async function textToBehaviour (text, services) {
  const ids = serviceIds(services)
  const out = await ask(`${PROMPTS.behaviour}\nThe hub's services:\n${listServices(services)}`, text, 'behaviour', {
    type: 'object',
    properties: { serviceId: { type: 'string', enum: ids }, ...BEHAVIOUR_FIELDS },
    required: ['serviceId', ...Object.keys(BEHAVIOUR_FIELDS)],
    additionalProperties: false
  })
  if (!ids.includes(out.serviceId)) throw new Error('I could not tell which service this rule is for.')
  return { serviceId: out.serviceId, ...buildBehaviour(out, text) }
}

// Model output → { trigger, action, text }. Throws with a message for the host if the rule is incomplete.
// `source` is the text the host wrote (or the document): amounts are accepted only if written there.
function buildBehaviour (out, text, source = text) {
  if (!TRIGGERS.includes(out.triggerKind)) throw new Error('I could not tell when this rule should run.')
  if (!ACTIONS.includes(out.actionKind)) throw new Error('I could not tell what this rule should do.')

  let value
  if (out.triggerKind === 'stock_below') value = int(out.triggerNumber, 1, 1000)
  if (out.triggerKind === 'overdue') value = int(out.triggerNumber, 0, 72) ?? 0
  if (out.triggerKind === 'after_hour') value = int(out.triggerNumber, 0, 23)
  if (out.triggerKind === 'use_count') value = int(out.triggerNumber, 1, 100_000)
  if (out.triggerKind === 'weekday') value = DAYS.filter((d) => (out.triggerDays || []).includes(d))
  if (value === null || (Array.isArray(value) && !value.length)) throw new Error('The rule needs a number or a day (e.g. "fewer than 3", "at the weekend", "after 10 pm").')

  let action
  if (out.actionKind === 'propose_purchase') {
    const item = str(out.purchaseItem, 40)
    if (!item) throw new Error('What should the hub propose to buy?')
    action = { kind: 'propose_purchase', item }
    const quantity = int(out.purchaseQuantity, 1, 1000)
    if (quantity) action.quantity = quantity
    if (written(out.purchaseMaxDollars, source)) action.maxAmount = cents(out.purchaseMaxDollars)
  }
  if (out.actionKind === 'change_price') {
    const percent = int(out.pricePercent, -90, 200)
    if (!percent) throw new Error('By how much should the price change?')
    action = { kind: 'change_price', percent }
  }
  if (out.actionKind === 'notify') {
    action = { kind: 'notify', message: str(out.message, 140) || `Rule triggered: ${str(text, 100)}` }
  }
  if (out.actionKind === 'lock' || out.actionKind === 'unlock') action = { kind: out.actionKind }
  if (out.actionKind === 'keep_deposit') {
    action = { kind: 'keep_deposit' }
    if (written(out.depositDollars, source)) action.amount = cents(out.depositDollars)
  }
  return { trigger: { kind: out.triggerKind, value }, action, text: str(text, 200) }
}

// ---------- device descriptor → service + behaviours (plug-and-play) ----------
// A new device introduces itself with a descriptor (in the product from Matter / Home Assistant; in the demo
// pasted by the host). The model proposes the service, a suggested price and up to 3 rules; the host confirms.
// → { service: { name, icon, type, price, unit, maxHours? }, behaviours: [{ trigger, action, text }] }
//   behaviours have no serviceId yet: the hub adds it when it creates the service.
export async function deviceToService (descriptor) {
  const json = typeof descriptor === 'string' ? descriptor : JSON.stringify(descriptor)
  if (!json || json === '{}' || json === 'null') throw new Error('Paste the device descriptor first.')
  const out = await ask(PROMPTS.device, json, 'device', {
    type: 'object',
    properties: {
      ...SERVICE_FIELDS,
      behaviours: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          properties: { description: { type: 'string' }, ...BEHAVIOUR_FIELDS },
          required: ['description', ...Object.keys(BEHAVIOUR_FIELDS)],
          additionalProperties: false
        }
      }
    },
    required: [...Object.keys(SERVICE_FIELDS), 'behaviours'],
    additionalProperties: false
  }, { maxChars: 2000, maxTokens: 900 })
  const behaviours = []
  for (const b of out.behaviours || []) {
    // A suggested rule that does not hold together is dropped, not shown: the host can always add rules by text.
    try { behaviours.push(buildBehaviour(b, str(b.description, 200) || '')) } catch {}
  }
  const service = buildService(out)
  // Safety: a door is opened by the guest's key; a timed lock/unlock rule could lock a guest out at night.
  const safe = service.type === 'access' ? behaviours.filter((x) => !['lock', 'unlock'].includes(x.action.kind)) : behaviours
  return { service, behaviours: safe }
}

// ---------- house documents (private: contracts, rules, manuals stay in the hub) ----------
// A document → the rules the devices can apply by themselves, proposed to the host.
// → [{ serviceId, trigger, action, text }]  (0–8 rules; rules that do not hold together are dropped)
export async function documentToBehaviours (text, services) {
  const ids = serviceIds(services)
  const out = await ask(`${PROMPTS.documentRules}\nThe hub's services:\n${listServices(services)}`, text, 'document_rules', {
    type: 'object',
    properties: {
      rules: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          properties: { serviceId: { type: 'string', enum: ids }, description: { type: 'string' }, ...BEHAVIOUR_FIELDS },
          required: ['serviceId', 'description', ...Object.keys(BEHAVIOUR_FIELDS)],
          additionalProperties: false
        }
      }
    },
    required: ['rules'],
    additionalProperties: false
  }, { maxChars: 6000, maxTokens: 1500 })
  const rules = []
  for (const r of out.rules || []) {
    if (!ids.includes(r.serviceId)) continue
    try {
      const rule = { serviceId: r.serviceId, ...buildBehaviour(r, str(r.description, 200) || '', text) }
      // the same rule twice (small models repeat themselves) is shown once
      const same = (x) => x.serviceId === rule.serviceId && JSON.stringify([x.trigger, x.action]) === JSON.stringify([rule.trigger, rule.action])
      if (!rules.some(same)) rules.push(rule)
    } catch {}
  }
  return rules
}

// A guest's question → an answer taken only from the documents, with the document it comes from.
// documents: [{ title, text }]. Short documents go to the model whole; long ones are cut to the paragraphs
// that share the most words with the question (simple retrieval, no vector database).
// → { answer, found, source }   (source = the document title, or null)
export async function answerFromDocuments (question, documents) {
  const docs = (documents || []).filter((d) => d && d.text).map((d, i) => ({ title: str(d.title, 80) || `Document ${i + 1}`, text: String(d.text) }))
  if (!docs.length) throw new Error('The host has not added any document yet.')
  const context = pickContext(String(question || ''), docs, 6000)
  const titles = docs.map((d) => d.title)
  const out = await ask(`${PROMPTS.assistant}\nDocuments:\n${context}`, question, 'answer', {
    type: 'object',
    properties: { answer: { type: 'string' }, found: { type: 'boolean' }, source: { type: 'string', enum: [...titles, ''] } },
    required: ['answer', 'found', 'source'],
    additionalProperties: false
  }, { maxTokens: 300 })
  const found = out.found === true && titles.includes(out.source)
  return { answer: str(out.answer, 600) || 'Sorry, I do not know. Please ask the host.', found, source: found ? out.source : null }
}

// Whole documents if they fit in `budget` characters; otherwise the paragraphs with most words in common with the question.
function pickContext (question, docs, budget) {
  const whole = docs.map((d) => `### ${d.title}\n${d.text.trim()}`).join('\n\n')
  if (whole.length <= budget) return whole
  const wordsOf = (t) => t.toLowerCase().match(/[\p{L}\d]{4,}/gu) || []
  const asked = new Set(wordsOf(question))
  const parts = docs.flatMap((d) => d.text.split(/\n\s*\n|\n(?=\s*[-*#])/).map((p) => ({ title: d.title, p: p.trim() })).filter((x) => x.p))
  for (const x of parts) x.score = wordsOf(x.p).filter((w) => asked.has(w)).length
  const byDoc = {}
  let used = 0
  for (const x of parts.sort((a, b) => b.score - a.score)) {
    if (used + x.p.length > budget) continue
    ;(byDoc[x.title] ||= []).push(x.p)
    used += x.p.length + 1
  }
  return Object.entries(byDoc).map(([t, ps]) => `### ${t}\n${ps.join('\n')}`).join('\n\n')
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
  const demo = [ // the demo laundry (docs/PLAN.md "Demo scope")
    { id: 'washer', name: 'Washing machine', type: 'use', price: 300 },
    { id: 'dryer', name: 'Dryer', type: 'use', price: 200 }
  ]
  const services = process.env.HUB_URL
    ? (await (await fetch(`${process.env.HUB_URL.replace(/\/+$/, '')}/api/services`)).json()).services
    : demo
  // the demo documents: prompts/documents/*.md, title = file name
  const docsDir = new URL('../prompts/documents/', import.meta.url)
  const documents = () => fs.readdirSync(docsDir).filter((f) => f.endsWith('.md'))
    .map((f) => ({ title: f.replace(/\.md$/, ''), text: fs.readFileSync(new URL(f, docsDir), 'utf8') }))
  const fn = {
    service: () => textToService(text),
    behaviour: () => textToBehaviour(text, services),
    bundle: () => textToBundle(text, services),
    device: () => deviceToService(text),
    rules: () => documentToBehaviours(fs.readFileSync(text, 'utf8'), services), // text = path of a document
    ask: () => answerFromDocuments(text, documents())
  }[cmd]
  if (!fn) { console.error('usage: node src/ai.js service|behaviour|bundle|device|rules|ask <text, descriptor JSON or document path>'); process.exit(1) }
  const t = Date.now()
  try {
    console.log(JSON.stringify(await fn(), null, 2))
    console.error(`(${((Date.now() - t) / 1000).toFixed(1)} s, model ${QVAC_MODEL} at ${QVAC_URL})`)
  } catch (e) { console.error('error:', e.message); process.exit(1) }
}
