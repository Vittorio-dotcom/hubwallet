// HubWallet host app logic.
// Real APIs (API_usage.md, src/devices.js), all on the hub with the owner key (X-Hub-Key), kept on this device:
//   GET  /api/hub/info · GET /api/wallet · GET /api/services (dollarId) · GET /api/devices
//   POST /api/devices/chat {messages} → {reply, proposed?} · POST /api/devices {config}
//   POST /api/devices/:id/edit {text} → {proposed, diff} · POST /api/devices/:id/apply {config}
//   POST /api/devices/clock {hour|null} (demo clock) · GET /api/to-sign?status=pending · POST /api/to-sign/:id/reject
//   POST /api/transfers {assetId, amount, invoice, description} → To sign (sweep)
// Host wallet cards: payer wallet API of src/guest.js (WALLET=provider), GET /api/me, POST /api/receive.
// With no hub connected the page shows example data (marked) so it can be tried.
// The AI never saves anything: it proposes, the hub validates, the host applies. Spending waits for the signer.

const $ = (s) => document.querySelector(s)
const money = (cents) => (Number(cents || 0) / 100).toFixed(2)
const DOLLAR = 'HUSD'

// Fills a node, skipping null/false parts (native replaceChildren would print them as the text "null").
const fill = (node, ...parts) => node.replaceChildren(...parts.flat().filter((x) => x !== null && x !== undefined && x !== false))
function el (tag, props = {}, ...children) {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn)
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v)
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : String(c))
  return n
}
const load_ = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const save_ = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }
async function call (url, { key, body, method } = {}) {
  const headers = {}
  if (key) headers['X-Hub-Key'] = key
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const r = await fetch(url, { method: method || (body !== undefined ? 'POST' : 'GET'), headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`)
  return j
}
const normUrl = (v) => {
  let u = String(v || '').trim().replace(/\/$/, '')
  if (u && !/^https?:\/\//.test(u)) u = 'http://' + u
  return /^https?:\/\/[^/\s]+$/.test(u) ? u : null
}

// ---------- configuration kept on this device ----------
let hubCfg = load_('hostHubs', []) // [{ url, key }]  the owner key never leaves this device except to its hub
let walletCfg = load_('hostWallets', []) // [{ url, label }]  src/guest.js WALLET=provider
let hubIndex = Math.min(load_('hostHubIndex', 0), Math.max(0, hubCfg.length - 1))
let walletIndex = 0

// ---------- example data (only when no hub is connected) ----------
const EXAMPLE = {
  wallets: [{ label: 'Example wallet', me: { address: 'tb1p…host', btc: { vanilla: { spendable: 61200 } }, assets: { nia: [{ ticker: DOLLAR, assetId: 'rgb:example', balance: { spendable: 4250 } }] } } }],
  hubs: [{ url: 'example', name: 'Lavanderia', dollarId: 'rgb:example', wallet: { btc: { vanilla: { spendable: 8800 } }, freeColorableUtxos: 4, assets: { nia: [{ assetId: 'rgb:example', balance: { spendable: 1150 } }] } },
    toSign: [],
    devices: [
      { id: 'washer', name: 'Washing machine', icon: '🧺', type: 'use', price: 300, unit: 'wash', commands: ['start', 'stop'], rules: [], version: 1, state: { status: 'idle' }, earned: 900, uses: 3 },
      { id: 'dryer', name: 'Dryer', icon: '🌀', type: 'use', price: 200, unit: 'cycle', commands: ['start', 'stop'], rules: [{ when: { kind: 'after_hour', value: 22 }, do: { kind: 'lock' } }], version: 2, state: { status: 'running', until: Date.now() + 40 * 60000 }, earned: 400, uses: 2 }
    ] }]
}
const example = () => hubCfg.length === 0

// ---------- live data ----------
let hubs = [] // [{ url, key, name, dollarId, wallet, devices, toSign, error? }]
let wallets = [] // [{ url, label, me?, error? }]
const hub = () => hubs[hubIndex]

async function loadHub ({ url, key }) {
  try {
    const [info, sv, wallet, devices, toSign] = await Promise.all([
      call(url + '/api/hub/info'), call(url + '/api/services'), call(url + '/api/wallet', { key }),
      call(url + '/api/devices', { key }), call(url + '/api/to-sign?status=pending', { key })])
    return { url, key, name: info.name || sv.name, dollarId: sv.dollarId, wallet, devices, toSign }
  } catch (e) { return { url, key, name: url.replace(/^https?:\/\//, ''), devices: [], toSign: [], error: e.message } }
}
async function loadWallet (w) {
  try { return { ...w, me: await call(w.url + '/api/me') } } catch (e) { return { ...w, error: e.message } }
}
async function refresh () {
  if (example()) { hubs = structuredClone(EXAMPLE.hubs); wallets = structuredClone(EXAMPLE.wallets) } else {
    hubs = await Promise.all(hubCfg.map(loadHub))
    wallets = await Promise.all(walletCfg.map(loadWallet))
  }
  render()
}

// ---------- rules in words ----------
const WHEN = { after_hour: (v) => `after ${v}:00`, weekday: (v) => `on ${v}`, stock_below: (v) => `when stock is below ${v}`, counter_at: (v) => `every ${v} uses`, overdue: () => 'when overdue' }
const DO = { lock: () => 'lock it', unlock: () => 'unlock it', set_price: (d) => `set the price to ${money(d.price)} ${DOLLAR}`, notify: () => 'notify me', propose_purchase: (d) => `propose a purchase${d.reason ? ' (' + d.reason + ')' : ''}`, keep_deposit: () => 'keep the deposit' }
const ruleText = (r) => `${(WHEN[r.when?.kind] || (() => r.when?.kind))(r.when?.value)}: ${(DO[r.do?.kind] || (() => r.do?.kind))(r.do || {})}`

// ---------- rendering ----------
const husdOf = (assets, id) => (assets?.nia || []).find((a) => (id ? a.assetId === id : a.ticker === DOLLAR))?.balance?.spendable || 0
function render () {
  $('#demo-tag').hidden = !example()
  // host wallet cards
  const cards = wallets.map((w) => w.error
    ? el('div', { class: 'wcard off' }, el('span', { class: 'label' }, w.label), el('strong', {}, 'Not reachable'), el('span', { class: 'small' }, w.url),
      el('button', { class: 'btn', type: 'button', on: { click: () => { walletCfg = walletCfg.filter((x) => x.url !== w.url); save_('hostWallets', walletCfg); refresh() } } }, 'Remove'))
    : el('div', { class: 'wcard', role: 'group', 'aria-label': w.label },
      el('span', { class: 'label' }, w.label),
      el('span', {}, el('span', { class: 'amount' }, money(husdOf(w.me.assets))), ' ', el('span', { class: 'unit' }, DOLLAR)),
      el('span', { class: 'hint' }, `${(w.me.btc?.vanilla?.spendable ?? 0).toLocaleString('en')} sats · receives your hubs' earnings`)))
  cards.push(el('button', { class: 'wcard add', type: 'button', on: { click: () => show('add-wallet') } },
    el('strong', { style: 'font-size:22px' }, wallets.length ? '+ Add wallet' : 'Connect your wallet'), el('span', { class: 'hint' }, 'Your personal HubWallet (WDK) wallet')))
  fill($('#wallets'), ...cards)
  fill($('#dots'), ...cards.map((_, i) => el('span', { class: i === walletIndex ? 'on' : '' })))

  // hub chips
  fill($('#hub-chips'), ...hubs.map((h, i) => el('button', { class: 'chip', type: 'button', role: 'tab', 'aria-selected': String(i === hubIndex), on: { click: () => { hubIndex = i; save_('hostHubIndex', i); render() } } }, h.name)),
    el('button', { class: 'chip', type: 'button', on: { click: () => show('add-hub') } }, '+ Add hub'))
  const h = hub()
  if (!h) { fill($('#hub-card'), ); fill($('#to-sign'), ); fill($('#devices'), ); return }
  if (h.error) {
    fill($('#hub-card'), el('div', { class: 'notice bad' }, `${h.url}: ${h.error}`),
      el('button', { class: 'btn', type: 'button', on: { click: () => removeHub(hubIndex) } }, 'Remove this hub'))
    fill($('#to-sign'), ); fill($('#devices'), ); return
  }
  const earned = husdOf(h.wallet?.assets, h.dollarId)
  fill($('#hub-card'), el('div', { class: 'card' },
    el('div', { class: 'row' }, el('div', { class: 'grow' }, el('span', { class: 'label' }, 'Earnings on this hub'),
      el('div', {}, el('span', { style: 'font-size:28px;font-weight:700' }, money(earned)), ' ', DOLLAR)),
      el('button', { class: 'btn', type: 'button', disabled: earned <= 0 || h.toSign.length > 0 || !wallets.some((w) => !w.error), on: { click: () => sweep(h, earned) } }, 'Sweep to my wallet')),
    el('p', { class: 'small muted' }, `${(h.wallet?.btc?.vanilla?.spendable ?? 0).toLocaleString('en')} sats for fees · ${h.wallet?.freeColorableUtxos ?? 0} free UTXOs · the hub can receive but never spend`)))

  fill($('#to-sign'), ...h.toSign.map((it) => el('div', { class: 'card warn-card' },
    el('span', { class: 'label' }, 'Waiting for your signature'),
    el('strong', {}, it.description || it.summary || it.kind),
    it.amount ? el('span', { class: 'small' }, `${money(it.amount)} ${DOLLAR}`) : null,
    el('p', { class: 'small muted' }, 'Approve it on your signer (the host phone). From here you can only reject it.'),
    el('button', { class: 'btn', type: 'button', on: { click: () => reject(h, it) } }, 'Reject'))))

  fill($('#devices'), ...(h.devices.length ? h.devices.map((d) => {
    const st = d.state?.status || 'idle'
    return el('button', { class: 'tile', type: 'button', on: { click: () => openDevice(d) }, 'aria-label': d.name },
      el('span', { class: 'ic', 'aria-hidden': 'true' }, d.icon || '🧩'), el('span', { class: 'name' }, d.name),
      el('span', { class: 'price' }, `${money(d.price)} ${DOLLAR} / ${d.unit}`),
      el('span', { class: `pill ${st === 'running' ? 'busy' : st === 'locked' ? 'on' : 'free'}` }, st === 'running' ? 'Running' : st === 'locked' ? 'Locked' : 'Ready'),
      el('span', { class: 'where' }, `${(d.rules || []).length} rule${(d.rules || []).length === 1 ? '' : 's'} · earned ${money(d.earned || 0)}`))
  }) : [el('div', { class: 'empty', style: 'grid-column:1/-1' }, 'No devices yet. Add one below.')]))
}

// ---------- spending: sweep and reject (signing happens on the signer) ----------
async function sweep (h, amount) {
  const w = wallets.find((x) => !x.error)
  try {
    if (example()) { h.toSign.push({ id: 'ex', description: `Send ${money(amount)} ${DOLLAR} from ${h.name} to your wallet`, amount }); render(); return }
    // the host's wallet makes an invoice for "any asset" (it may never have seen HUSD), the hub prepares the transfer
    const inv = await call(w.url + '/api/receive', { body: { amount, description: `Earnings from ${h.name}` } })
    await call(h.url + '/api/transfers', { key: h.key, body: { assetId: h.dollarId, amount, invoice: inv.invoice, description: `Sweep ${money(amount)} ${DOLLAR} from ${h.name} to ${w.label}` } })
    await refresh()
  } catch (e) { $('#hub-card').append(el('div', { class: 'notice bad' }, e.message)) }
}
async function reject (h, it) {
  try { if (!example()) await call(`${h.url}/api/to-sign/${encodeURIComponent(it.id)}/reject`, { key: h.key, body: {} }); else h.toSign = []; await refresh() } catch (e) { $('#to-sign').append(el('div', { class: 'notice bad' }, e.message)) }
}

// ---------- proposals: shown as differences, applied only by the host ----------
function proposal (cur, next, diffList, onApply) {
  return el('div', { class: 'card' },
    el('span', { class: 'label' }, cur ? 'Proposed changes' : 'Proposed configuration'),
    cur ? (diffList.length
      ? el('ul', { class: 'diff' }, ...diffList.map((c) => el('li', { class: c.from === undefined ? 'add' : c.to === undefined ? 'del' : 'mod' },
          c.field === 'rule' || c.field === 'rules' ? (c.to ? `+ rule: ${typeof c.to === 'string' ? c.to : ruleText(c.to)}` : `− rule: ${typeof c.from === 'string' ? c.from : ruleText(c.from)}`)
            : `${c.field}: ${c.field === 'price' ? money(c.from) : c.from} → ${c.field === 'price' ? money(c.to) : c.to}`)))
      : el('p', { class: 'small muted' }, 'No changes.'))
      : el('div', { class: 'stack' },
        el('div', { class: 'row' }, el('span', { style: 'font-size:32px' }, next.icon || '🧩'), el('div', { class: 'grow' }, el('strong', {}, next.name), el('div', { class: 'small muted' }, `${money(next.price)} ${DOLLAR} / ${next.unit}`))),
        (next.rules || []).length ? el('ul', { class: 'rules' }, ...next.rules.map((r) => el('li', {}, ruleText(r)))) : el('p', { class: 'small muted' }, 'No rules.')),
    el('button', { class: 'btn primary block', type: 'button', disabled: cur && !diffList.length, on: { click: onApply } }, 'Apply'))
}

// ---------- a device: details, edit with the AI, demo clock ----------
let current = null
function openDevice (d) { current = d; $('#device-title').textContent = d.name; $('#edit-text').value = ''; fill($('#edit-out'), ); renderDevice(); show('device') }
function renderDevice () {
  const d = current
  fill($('#device-body'), 
    el('div', { class: 'row' }, el('span', { style: 'font-size:40px', 'aria-hidden': 'true' }, d.icon || '🧩'),
      el('div', { class: 'grow' }, el('strong', {}, d.name), el('div', { class: 'small muted' }, `${money(d.price)} ${DOLLAR} / ${d.unit} · version ${d.version} · ${d.uses ?? 0} uses`))),
    el('span', { class: 'label' }, 'Rules'),
    (d.rules || []).length ? el('ul', { class: 'rules' }, ...d.rules.map((r) => el('li', {}, ruleText(r)))) : el('p', { class: 'small muted' }, 'No rules yet.'),
    el('a', { class: 'small', href: `${example() ? '' : hub().url}/device.html?id=${encodeURIComponent(d.id)}`, target: '_blank', rel: 'noopener' }, 'Open the device screen'),
    example() ? null : el('div', { class: 'row' }, el('span', { class: 'small muted grow' }, 'Demo clock (to show time rules)'),
      el('select', { class: 'input', 'aria-label': 'Pretend it is', on: { change: (e) => setClock(e.target.value) } },
        el('option', { value: '' }, 'real time'), ...Array.from({ length: 24 }, (_, i) => el('option', { value: String(i) }, `${i}:00`)))))
  const { state: _s, earned: _e, uses: _u, basePrice: _b, lastTriggered: _l, ...cfg } = d
  $('#device-json').textContent = JSON.stringify(cfg, null, 2)
}
async function setClock (v) {
  try { await call(hub().url + '/api/devices/clock', { key: hub().key, body: { hour: v === '' ? null : Number(v) } }); await refresh() } catch (e) { fill($('#edit-out'), el('div', { class: 'notice bad' }, e.message)) }
}
$('#edit-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const text = $('#edit-text').value.trim(); if (!text) return
  if (example()) { fill($('#edit-out'), el('div', { class: 'notice' }, 'This page is showing example data. Tap "+ Add hub" (address and owner key of your hub) to edit devices with the hub\'s AI.')); return }
  fill($('#edit-out'), el('p', { class: 'small muted' }, 'The hub\'s AI is thinking…'))
  try {
    const h = hub()
    const r = await call(`${h.url}/api/devices/${encodeURIComponent(current.id)}/edit`, { key: h.key, body: { text } })
    fill($('#edit-out'), proposal(current, r.proposed, r.diff || [], async () => {
      try {
        const saved = await call(`${h.url}/api/devices/${encodeURIComponent(current.id)}/apply`, { key: h.key, body: { config: r.proposed } })
        await refresh(); current = hub().devices.find((x) => x.id === saved.id) || current
        fill($('#edit-out'), el('div', { class: 'notice ok' }, `Saved as version ${saved.version}.`)); renderDevice()
      } catch (err) { fill($('#edit-out'), el('div', { class: 'notice bad' }, err.message)) }
    }))
  } catch (err) { fill($('#edit-out'), el('div', { class: 'notice bad' }, err.message)) }
})

// ---------- add a device: guided chat with the hub's AI ----------
let messages = []
function drawChat () {
  fill($('#dev-chat'), ...messages.map((m) => el('div', { class: `msg ${m.role === 'ai' ? 'ai' : 'me'}` }, el('span', { class: 'by' }, m.role === 'ai' ? 'Hub AI · local' : 'You'), m.text)))
  $('#dev-chat').scrollTop = $('#dev-chat').scrollHeight
}
$('#add-device').onclick = () => {
  messages = [{ role: 'ai', text: 'Hi! What device do you want to connect? For example "a dryer, 2 dollars per cycle".' }]
  fill($('#add-dev-out'), ); $('#dev-chat-text').value = ''
  drawChat(); show('add-dev'); $('#dev-chat-text').focus()
}
$('#dev-chat-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const text = $('#dev-chat-text').value.trim(); if (!text) return
  $('#dev-chat-text').value = ''
  messages.push({ role: 'host', text }); drawChat()
  if (example()) { messages.push({ role: 'ai', text: 'This page is showing example data. Tap "+ Add hub" (address and owner key of your hub) to add devices with the hub\'s AI.' }); drawChat(); return }
  messages.push({ role: 'ai', text: '…' }); drawChat()
  try {
    const h = hub()
    const r = await call(h.url + '/api/devices/chat', { key: h.key, body: { messages: messages.slice(0, -1) } })
    messages[messages.length - 1] = { role: 'ai', text: r.reply || 'Here is my proposal.' }; drawChat()
    if (r.proposed) {
      fill($('#add-dev-out'), proposal(null, r.proposed, [], async () => {
        try { await call(h.url + '/api/devices', { key: h.key, body: { config: r.proposed } }); show(null); await refresh() } catch (err) { $('#add-dev-out').append(el('div', { class: 'notice bad' }, err.message)) }
      }))
    }
  } catch (err) { messages[messages.length - 1] = { role: 'ai', text: `Sorry: ${err.message}` }; drawChat() }
})

// ---------- hubs and wallets ----------
$('#add-hub-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const url = normUrl($('#hub-url').value); const key = $('#hub-key').value.trim()
  if (!url || !key) { fill($('#add-hub-msg'), el('div', { class: 'notice bad' }, 'Enter the hub address (e.g. 192.168.7.246:8080) and its owner key.')); return }
  try {
    await call(url + '/api/wallet', { key }) // checks both the address and the owner key
    if (!hubCfg.some((x) => x.url === url)) hubCfg.push({ url, key })
    save_('hostHubs', hubCfg); hubIndex = hubCfg.findIndex((x) => x.url === url); save_('hostHubIndex', hubIndex)
    $('#hub-key').value = ''; show(null); await refresh()
  } catch (err) { fill($('#add-hub-msg'), el('div', { class: 'notice bad' }, `Could not open the hub: ${err.message}`)) }
})
function removeHub (i) { hubCfg.splice(i, 1); save_('hostHubs', hubCfg); hubIndex = 0; save_('hostHubIndex', 0); refresh() }
$('#add-wallet-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const url = normUrl($('#wallet-url').value)
  if (!url) { fill($('#add-wallet-msg'), el('div', { class: 'notice bad' }, 'Enter an address like http://127.0.0.1:8091.')); return }
  try {
    await call(url + '/api/me')
    if (!walletCfg.some((x) => x.url === url)) walletCfg.push({ url, label: walletCfg.length ? `Wallet ${walletCfg.length + 1}` : 'My wallet' })
    save_('hostWallets', walletCfg); show(null); await refresh()
  } catch (err) { fill($('#add-wallet-msg'), el('div', { class: 'notice bad' }, `No wallet answers at ${url}: ${err.message}`)) }
})

// ---------- sheets ----------
function show (id) { document.querySelectorAll('.sheet').forEach((s) => { s.hidden = s.id !== id }); $('#home').hidden = !!id }
document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) show(null) })
$('#wallets').addEventListener('scroll', () => { const c = $('#wallets'); const i = Math.round(c.scrollLeft / c.clientWidth); if (i !== walletIndex) { walletIndex = i; render() } }, { passive: true })

refresh()
setInterval(() => { if ($('#home').hidden === false) refresh() }, 10000)
