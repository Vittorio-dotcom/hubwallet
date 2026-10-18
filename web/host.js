// HubWallet host app logic.
// Real APIs (API_usage.md, src/devices.js), all on the hub with the owner key (X-Hub-Key), kept on this device:
//   GET  /api/hub/info · GET /api/wallet · GET /api/services (dollarId) · GET /api/devices
//   POST /api/devices/chat {messages} → {reply, proposed?} · POST /api/devices {config}
//   POST /api/devices/:id/edit {text} → {proposed, diff} | {reply} · POST /api/devices/:id/apply {config}
//   POST /api/devices/documents {text} → [{deviceId, rule, text}] · DELETE /api/devices/:id
//   POST /api/devices/clock {hour|null} (demo clock) · GET /api/to-sign?status=pending · POST /api/to-sign/:id/reject
//   POST /api/transfers {assetId, amount, invoice, description} → To sign (sweep)
// Host wallet passes: payer wallet API of src/guest.js (WALLET=provider), GET /api/me, POST /api/receive.
// With no hub connected the page shows example data (marked) so it can be tried.
// The AI never saves anything: it proposes, the hub validates, the host applies. Spending waits for the signer.
import { el, fill, money, DOLLAR, icon, porthole, statusOf, clock, ruleText, ruleIcon, themeButton, lens } from './ui.js'
import { liquid, morphTopbar, morphOpen, morphClose } from './liquid.js'

const $ = (s) => document.querySelector(s)
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
const notice = (kind, text, ...extra) => el('div', { class: `notice ${kind}` }, icon(kind === 'ok' ? 'checkCircle' : kind === 'bad' ? 'alert' : 'info', { size: 18 }), el('div', { class: 'stack', style: 'gap:8px' }, text, ...extra))
const aiTag = () => [icon('spark', { size: 16 }), 'Local AI · runs on the hub']

// ---------- configuration kept on this device ----------
let hubCfg = load_('hostHubs', []) // [{ url, key }]  the owner key never leaves this device except to its hub
let walletCfg = load_('hostWallets', []) // [{ url, label }]  src/guest.js WALLET=provider
let hubIndex = Math.min(load_('hostHubIndex', 0), Math.max(0, hubCfg.length - 1))
let walletIndex = 0

// ---------- example data (only when no hub is connected) ----------
const EXAMPLE = {
  wallets: [{ label: 'My wallet', me: { address: 'tb1p…host', btc: { vanilla: { spendable: 61200 } }, assets: { nia: [{ ticker: DOLLAR, assetId: 'rgb:example', balance: { spendable: 4250 } }] } } }],
  hubs: [{ url: 'example', name: 'Lavanderia', dollarId: 'rgb:example', wallet: { btc: { vanilla: { spendable: 8800 } }, freeColorableUtxos: 4, assets: { nia: [{ assetId: 'rgb:example', balance: { spendable: 1150 } }] } },
    toSign: [],
    devices: [
      { id: 'washer', name: 'Washing machine', icon: 'washer', type: 'use', price: 300, unit: 'wash', commands: ['start', 'stop'], rules: [{ when: { kind: 'counter_at', value: 50 }, do: { kind: 'propose_purchase', reason: 'maintenance' } }], version: 1, state: { status: 'idle' }, earned: 900, uses: 3 },
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

// ---------- rendering ----------
const husdOf = (assets, id) => (assets?.nia || []).find((a) => (id ? a.assetId === id : a.ticker === DOLLAR))?.balance?.spendable || 0
const stateText = (d) => { const st = statusOf(d); return st.key === 'busy' ? (st.until ? `In use · ${clock(st.until)}` : 'In use') : st.key === 'locked' ? 'Locked' : 'Available' }
function render () {
  $('#demo-tag').hidden = !example()

  // host wallet passes
  const cards = wallets.map((w) => w.error
    ? el('div', { class: 'pass off' }, el('div', { class: 'pass-top' }, icon('alert', { size: 18 }), w.label),
      el('div', { class: 'stack', style: 'gap:4px' }, el('strong', {}, 'Not reachable'), el('span', { class: 'footnote mono' }, w.url)),
      el('button', { class: 'btn small danger', type: 'button', on: { click: () => { walletCfg = walletCfg.filter((x) => x.url !== w.url); save_('hostWallets', walletCfg); refresh() } } }, 'Remove'))
    : el('div', { class: 'pass', role: 'group', 'aria-label': `${w.label}, ${money(husdOf(w.me.assets))} ${DOLLAR}` },
      el('div', { class: 'pass-top' }, icon('wallet', { size: 18 }), el('span', { class: 'grow' }, w.label), 'WDK'),
      el('div', { class: 'amount' }, money(husdOf(w.me.assets)), el('small', {}, DOLLAR)),
      el('div', { class: 'pass-foot' }, el('span', {}, 'Your earnings land here'), el('span', {}, `${(w.me.btc?.vanilla?.spendable ?? 0).toLocaleString('en')} sats`))))
  cards.push(el('button', { class: 'pass add', type: 'button', on: { click: () => show('add-wallet') } },
    el('span', { class: 'plus' }, icon('plus', { size: 24 })), el('h3', {}, wallets.length ? 'Add another wallet' : 'Connect your wallet'),
    el('span', { class: 'footnote' }, 'Where your earnings go')))
  fill($('#wallets'), cards)
  fill($('#dots'), cards.map((_, i) => el('span', { class: i === walletIndex ? 'on' : '' })))
  lens([...$('#wallets').querySelectorAll('.pass:not(.add)')])

  // hubs
  fill($('#hub-list'), hubs.map((h, i) => el('button', { class: 'cell', type: 'button', 'aria-pressed': String(i === hubIndex), on: { click: () => { hubIndex = i; save_('hostHubIndex', i); render() } } },
      el('span', { class: `cell-icon ${h.error ? 'red' : 'gray'}` }, icon(h.error ? 'alert' : 'hub', { size: 16 })),
      el('div', { class: 'grow' }, el('div', { class: 'title' }, h.name), el('div', { class: 'sub' }, h.error ? 'Not reachable' : `${h.devices.length} machine${h.devices.length === 1 ? '' : 's'}`)),
      i === hubIndex ? el('span', { style: 'color:var(--blue)' }, icon('check', { size: 18 })) : null)),
    el('button', { class: 'cell', type: 'button', on: { click: () => show('add-hub') } }, el('span', { class: 'cell-icon' }, icon('plus', { size: 16 })), el('span', { class: 'grow', style: 'color:var(--blue)' }, 'Add a hub')))

  const h = hub()
  $('#hub-name').textContent = h?.name || 'Your hub'
  if (!h) { fill($('#hub-card')); $('#to-sign').hidden = true; fill($('#devices')); return }
  if (h.error) {
    fill($('#hub-card'), notice('bad', `This hub does not answer (${h.error}).`, el('button', { class: 'btn small danger', type: 'button', on: { click: () => removeHub(hubIndex) } }, 'Remove this hub')))
    fill($('#to-sign')); fill($('#devices')); return
  }

  // to sign
  $('#to-sign').hidden = !h.toSign.length
  fill($('#to-sign'), h.toSign.map((it) => el('div', { class: 'sign-banner' },
    el('span', { class: 'cell-icon' }, icon('pen', { size: 16 })),
    el('div', { class: 'grow' }, el('div', { class: 'title' }, it.description || it.summary || it.kind),
      el('div', { class: 'sub' }, `${it.amount ? money(it.amount) + ' ' + DOLLAR + ' · ' : ''}Approve it on your phone (signer)`)),
    el('button', { class: 'btn small', type: 'button', on: { click: () => reject(h, it) } }, 'Reject'))))

  // earnings
  const earned = husdOf(h.wallet?.assets, h.dollarId)
  const canSweep = earned > 0 && h.toSign.length === 0 && wallets.some((w) => !w.error)
  fill($('#hub-card'), el('div', { class: 'overview' },
    el('div', { class: 'stat' }, el('span', { class: 'footnote' }, 'Earned on this hub'), el('div', { class: 'big' }, money(earned), el('small', {}, DOLLAR)),
      el('span', { class: 'footnote' }, `${(h.wallet?.btc?.vanilla?.spendable ?? 0).toLocaleString('en')} sats for fees · ${h.wallet?.freeColorableUtxos ?? 0} free slots`)),
    el('button', { class: 'btn primary', type: 'button', disabled: !canSweep, on: { click: () => sweep(h, earned) } }, icon('arrowDown', { size: 18 }), 'Move to my wallet')))

  // machines
  fill($('#devices'), h.devices.map((d) => el('button', { class: 'device-card', type: 'button', on: { click: (e) => openDevice(d, e.currentTarget) }, 'aria-label': `${d.name}, ${stateText(d)}` },
      el('div', { class: 'row', style: 'align-items:flex-start' }, porthole(d, { size: 64 }), el('span', { class: 'grow' }), el('span', { class: `badge ${statusOf(d).key}` }, stateText(d))),
      el('div', { class: 'stack', style: 'gap:2px' }, el('h3', {}, d.name), el('span', { class: 'sub muted' }, priceLine(d))),
      el('div', { class: 'meta footnote' }, el('span', {}, `${(d.rules || []).length} rule${(d.rules || []).length === 1 ? '' : 's'}`), el('span', { class: 'num' }, `${money(d.earned || 0)} earned`)))),
    el('button', { class: 'device-card add', type: 'button', on: { click: () => $('#add-device').click() } }, icon('plus', { size: 28 }), 'Add a machine'))
}

// ---------- spending: sweep and reject (signing happens on the signer) ----------
async function sweep (h, amount) {
  const w = wallets.find((x) => !x.error)
  try {
    if (example()) { h.toSign.push({ id: 'ex', description: `Move ${money(amount)} ${DOLLAR} from ${h.name} to your wallet`, amount }); render(); return }
    // the host's wallet makes an invoice for "any asset" (it may never have seen HUSD), the hub prepares the transfer
    const inv = await call(w.url + '/api/receive', { body: { amount, witness: true, description: `Earnings from ${h.name}` } }) // witness: the host's wallet needs no UTXO of its own
    await call(h.url + '/api/transfers', { key: h.key, body: { assetId: h.dollarId, amount, invoice: inv.invoice, description: `Move ${money(amount)} ${DOLLAR} from ${h.name} to ${w.label}` } })
    await refresh()
  } catch (e) { $('#hub-card').append(notice('bad', e.message)) }
}
async function reject (h, it) {
  try { if (!example()) await call(`${h.url}/api/to-sign/${encodeURIComponent(it.id)}/reject`, { key: h.key, body: {} }); else h.toSign = []; await refresh() } catch (e) { $('#to-sign').append(notice('bad', e.message)) }
}

// ---------- proposals: shown as before → after, applied only by the host ----------
const fieldName = { name: 'Name', icon: 'Icon', type: 'Type', price: 'Price', unit: 'Unit' }
function proposal (cur, next, diffList, onApply) {
  const rows = cur ? diffList.map((c) => {
    if (c.field === 'rule' || c.field === 'rules') {
      const add = c.to !== undefined
      const txt = add ? (typeof c.to === 'string' ? c.to : ruleText(c.to)) : (typeof c.from === 'string' ? c.from : ruleText(c.from))
      return el('li', { class: add ? 'add' : 'del' }, el('span', { class: 'mark' }, add ? '+' : '−'), el('span', { class: add ? 'now' : 'was' }, txt[0].toUpperCase() + txt.slice(1)))
    }
    const show = (v) => c.field === 'price' ? `${money(v)} ${DOLLAR}` : String(v)
    return el('li', { class: 'mod' }, el('span', { class: 'mark' }, icon('chevronRight', { size: 14 })), el('span', { class: 'grow' }, fieldName[c.field] || c.field),
      el('span', { class: 'was' }, show(c.from)), el('span', { class: 'now' }, show(c.to)))
  }) : []
  return el('div', { class: 'proposal' },
    el('div', { class: 'row' }, el('h3', { class: 'grow' }, cur ? 'Proposed changes' : 'New machine'), el('span', { class: 'ai-tag' }, aiTag())),
    cur ? (rows.length ? el('ul', { class: 'diff' }, rows) : el('p', { class: 'muted' }, 'Nothing would change.'))
      : el('div', { class: 'stack' },
        el('div', { class: 'row' }, porthole({ ...next, state: { status: 'idle' } }, { size: 56 }),
          el('div', { class: 'grow' }, el('h3', {}, next.name), el('div', { class: 'sub muted' }, priceLine(next)))),
        (next.rules || []).length ? el('div', { class: 'group' }, next.rules.map((r) => el('div', { class: 'cell' }, el('span', { class: 'cell-icon gray' }, icon(ruleIcon(r), { size: 16 })), el('span', { class: 'grow' }, ruleText(r)))))
          : el('p', { class: 'footnote' }, 'No rules.')),
    el('button', { class: 'btn primary block', type: 'button', disabled: cur && !diffList.length, on: { click: onApply } }, cur ? 'Apply' : 'Add machine'))
}

// ---------- a machine: details, edit with the AI, demo clock ----------
let current = null
function openDevice (d, from) {
  current = d; $('#device-title').textContent = d.name; $('#edit-text').value = ''; fill($('#edit-out'))
  editChat = [{ role: 'ai', text: `What do you want to change on the ${d.name.toLowerCase()}?` }]; pendingEdit = []; editProposal = null
  drawEditChat(); renderDevice(); show('device', from)
}
// "1.50 HUSD per coffee", or with options "Espresso 1.50 · Cappuccino 2.00"
const priceLine = (d) => d.options?.length ? d.options.map((o) => `${o.name} ${money(o.price)}`).join(' · ') : `${money(d.price)} ${DOLLAR} per ${d.unit}`
const optionsGroup = (d) => d.options?.length
  ? el('div', { class: 'stack' }, el('h3', {}, 'Options'), el('div', { class: 'group' }, d.options.map((o) => el('div', { class: 'cell' },
      el('div', { class: 'grow' }, el('div', { class: 'title' }, o.name), (o.minutes || o.from != null) ? el('div', { class: 'sub' }, [o.minutes ? `${o.minutes} min` : '', o.from != null ? `${o.from}:00–${o.to}:00` : ''].filter(Boolean).join(' · ')) : null),
      el('span', { class: 'num' }, `${money(o.price)} ${DOLLAR}`)))))
  : null
function renderDevice () {
  const d = current
  const st = statusOf(d)
  fill($('#device-body'),
    el('div', { class: 'row' }, porthole(d, { size: 84 }),
      el('div', { class: 'grow stack', style: 'gap:4px' }, el('div', { class: 'price-big', style: 'font-size:32px' }, money(d.price), el('small', {}, `${DOLLAR} per ${d.unit}`)),
        el('div', {}, el('span', { class: `badge ${st.key}` }, stateText(d))))),
    el('div', { class: 'group' },
      el('div', { class: 'cell' }, el('span', { class: 'grow muted' }, 'Earned'), el('span', { class: 'num' }, `${money(d.earned || 0)} ${DOLLAR}`)),
      el('div', { class: 'cell' }, el('span', { class: 'grow muted' }, 'Uses'), el('span', { class: 'num' }, String(d.uses ?? 0))),
      el('div', { class: 'cell' }, el('span', { class: 'grow muted' }, 'Version'), el('span', { class: 'num' }, String(d.version)))),
    optionsGroup(d),
    el('div', { class: 'stack' }, el('h3', {}, 'Rules'),
      (d.rules || []).length
        ? el('div', { class: 'group' }, d.rules.map((r, i) => el('div', { class: 'cell' }, el('span', { class: 'cell-icon gray' }, icon(ruleIcon(r), { size: 16 })), el('span', { class: 'grow' }, ruleText(r)), el('span', { class: 'value' }, `#${i + 1}`))))
        : el('p', { class: 'footnote' }, 'No rules yet. Ask below, for example “lock it after 22:00”.')))
  fill($('#edit-suggest'), ['Price 3.50', 'Options: 30° 2.00 40 min, 60° 3.50 90 min', 'Add cappuccino 2.00 7-11', 'Lock it after 22:00', 'Unlock it at 7:00', 'Weekend +10%', 'Maintenance every 50 uses']
    .map((t) => el('button', { type: 'button', on: { click: () => { $('#edit-text').value = t; $('#edit-text').focus() } } }, t)))
  fill($('#device-tools'),
    el('div', { class: 'group' },
      el('a', { class: 'cell', href: `${example() ? '' : hub().url}/device.html?id=${encodeURIComponent(d.id)}`, target: '_blank', rel: 'noopener' },
        el('span', { class: 'cell-icon' }, icon('qr', { size: 16 })), el('span', { class: 'grow' }, 'Open the machine screen'), el('span', { class: 'chev' }, icon('external', { size: 16 }))),
      example() ? null : el('label', { class: 'cell' }, el('span', { class: 'cell-icon gray' }, icon('clock', { size: 16 })), el('span', { class: 'grow' }, 'Demo clock'),
        el('select', { class: 'field', style: 'width:auto;min-height:36px', 'aria-label': 'Pretend it is', on: { change: (e) => setClock(e.target.value) } },
          el('option', { value: '' }, 'Real time'), Array.from({ length: 24 }, (_, i) => el('option', { value: String(i) }, `${i}:00`))))),
    example() ? null : el('div', { id: 'remove-box' }, el('button', { class: 'btn danger block', type: 'button', on: { click: askRemove } }, icon('trash', { size: 18 }), 'Remove machine')))
  const { state: _s, earned: _e, uses: _u, basePrice: _b, lastTriggered: _l, ...cfg } = d
  $('#device-json').textContent = JSON.stringify(cfg, null, 2)
}
// Remove a machine (DELETE /api/devices/:id), with an in-page confirmation. Earnings already received stay in the hub wallet.
function askRemove () {
  const d = current
  if (statusOf(d).key === 'busy') { fill($('#remove-box'), notice('bad', 'This machine is running. Wait until it finishes, then remove it.')); return }
  fill($('#remove-box'), el('div', { class: 'confirm' },
    el('h3', {}, `Remove ${d.name} from ${hub().name}?`),
    el('p', { class: 'footnote' }, 'Customers will no longer see it. Its configuration is deleted; money already received stays on the hub.'),
    el('div', { class: 'form-row' },
      el('button', { class: 'btn danger grow', type: 'button', on: { click: removeDevice } }, 'Remove'),
      el('button', { class: 'btn grow', type: 'button', on: { click: renderDevice } }, 'Cancel'))))
}
async function removeDevice () {
  try {
    await call(`${hub().url}/api/devices/${encodeURIComponent(current.id)}`, { key: hub().key, method: 'DELETE' })
    show(null); await refresh()
  } catch (e) { fill($('#remove-box'), notice('bad', e.message)) }
}
async function setClock (v) {
  try { await call(hub().url + '/api/devices/clock', { key: hub().key, body: { hour: v === '' ? null : Number(v) } }); await refresh(); current = hub().devices.find((x) => x.id === current.id) || current; renderDevice() } catch (e) { fill($('#edit-out'), notice('bad', e.message)) }
}

// Edit as a conversation. The hub's AI takes all the host's requests since the last apply (POST /api/devices/:id/edit
// { text }); when something is missing it answers { reply } ("How much?") and the next message completes it.
let editChat = []; let pendingEdit = []
let editProposal = null // the proposal on screen: the next request changes it, so changes add up
const bubbles = (list) => list.map((m) => el('div', { class: `msg ${m.role === 'ai' ? 'ai' : 'me'}${m.text === '…' ? ' typing' : ''}` }, m.text))
function drawEditChat () { fill($('#edit-chat'), bubbles(editChat)); $('#edit-chat').scrollTop = $('#edit-chat').scrollHeight }
function followUp (text) { // what to ask when an older hub could not tell what to change
  const t = text.toLowerCase()
  if (/(price|prezzo|cost|expensive|cheap|caro|economic|raise|lower|alza|abbassa)/.test(t)) return 'How much? Write a price (e.g. 3.50) or a percentage (e.g. +10%).'
  if (/(lock|blocc|night|notte|close|chiud)/.test(t)) return 'From what time? For example “after 22:00”.'
  if (/(rule|regol|remove|togli)/.test(t)) return 'Which rule? For example “remove rule 1” or “lock it after 22:00”.'
  return 'You can change the price (“price 2.50”, “+10%”), add a rule (“lock it after 22:00”, “maintenance every 50 uses”) or remove one (“remove rule 1”).'
}
$('#edit-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const text = $('#edit-text').value.trim(); if (!text) return
  $('#edit-text').value = ''
  editChat.push({ role: 'host', text }); drawEditChat()
  if (example()) { editChat.push({ role: 'ai', text: 'This page shows example data. Add your hub (address and owner key) to change machines with its AI.' }); drawEditChat(); return }
  pendingEdit.push(text)
  const request = pendingEdit.join('. ')
  editChat.push({ role: 'ai', text: '…' }); drawEditChat()
  const h = hub()
  try {
    const r = await call(`${h.url}/api/devices/${encodeURIComponent(current.id)}/edit`, { key: h.key, body: { text: request, messages: editChat.slice(0, -1), base: editProposal || undefined } })
    if (r.reply && !r.proposed) { // the AI asks something ("How much?"): keep the request; not understood: start clean
      if (/did not get|cannot|never/i.test(r.reply)) pendingEdit = []
      editChat[editChat.length - 1] = { role: 'ai', text: r.reply }; drawEditChat(); return
    }
    pendingEdit = []; editProposal = r.proposed
    editChat[editChat.length - 1] = { role: 'ai', text: (r.diff || []).length ? 'Here is what would change. Apply it, or tell me what to adjust.' : 'Nothing would change.' }; drawEditChat()
    fill($('#edit-out'), proposal(current, r.proposed, r.diff || [], async () => {
      try {
        const saved = await call(`${h.url}/api/devices/${encodeURIComponent(current.id)}/apply`, { key: h.key, body: { config: r.proposed } })
        editProposal = null
        await refresh(); current = hub().devices.find((x) => x.id === saved.id) || current
        fill($('#edit-out'), notice('ok', `Saved as version ${saved.version}.`)); renderDevice()
        editChat.push({ role: 'ai', text: `Saved as version ${saved.version}. Anything else?` }); drawEditChat()
      } catch (err) { fill($('#edit-out'), notice('bad', err.message)) }
    }))
  } catch (err) {
    // not understood by an older hub: keep the request, ask for the missing part
    editChat[editChat.length - 1] = { role: 'ai', text: /did not understand/i.test(err.message) ? followUp(request) : err.message }
    if (!/did not understand/i.test(err.message)) pendingEdit = []
    drawEditChat()
  }
})

// ---------- add a machine: guided chat with the hub's AI ----------
let messages = []
let addProposal = null; let pendingAdd = [] // once a proposal is on screen, the host's messages change it
function drawChat () { fill($('#dev-chat'), bubbles(messages)); $('#dev-chat').scrollTop = $('#dev-chat').scrollHeight }
$('#add-device').onclick = () => {
  messages = [{ role: 'ai', text: 'Which machine do you want to connect? For example “a dryer, 2 dollars per cycle”. You can also paste its descriptor.' }]
  addProposal = null; pendingAdd = []
  fill($('#add-dev-out')); $('#dev-chat-text').value = ''
  drawChat(); show('add-dev'); $('#dev-chat-text').focus()
}
$('#dev-chat-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const text = $('#dev-chat-text').value.trim(); if (!text) return
  $('#dev-chat-text').value = ''
  messages.push({ role: 'host', text }); drawChat()
  if (example()) { messages.push({ role: 'ai', text: 'This page shows example data. Add your hub (address and owner key) to add machines with its AI.' }); drawChat(); return }
  messages.push({ role: 'ai', text: '…' }); drawChat()
  try {
    const h = hub()
    if (addProposal) pendingAdd.push(text)
    const body = addProposal ? { base: addProposal, text: pendingAdd.join('. ') } : { messages: messages.slice(0, -1) }
    const r = await call(h.url + '/api/devices/chat', { key: h.key, body })
    messages[messages.length - 1] = { role: 'ai', text: r.reply || 'Here is my proposal.' }; drawChat()
    if (!r.proposed && /did not get|cannot|never/i.test(r.reply || '')) pendingAdd = [] // not understood: start the next request clean
    if (r.proposed) {
      addProposal = r.proposed; pendingAdd = []
      fill($('#add-dev-out'), proposal(null, r.proposed, [], async () => {
        try { await call(h.url + '/api/devices', { key: h.key, body: { config: r.proposed } }); show(null); await refresh() } catch (err) { $('#add-dev-out').append(notice('bad', err.message)) }
      }))
    }
  } catch (err) { messages[messages.length - 1] = { role: 'ai', text: err.message }; drawChat() }
})

// ---------- house documents → proposed rules (POST /api/devices/documents) ----------
// The hub's AI reads the document and proposes { deviceId, rule, text }; the host ticks the ones to keep;
// each machine gets its new rules through /apply (validated by the hub, new version).
$('#open-docs').onclick = () => { fill($('#doc-out')); show('docs') }
$('#doc-file').addEventListener('change', async (e) => { const f = e.target.files?.[0]; if (f && f.size < 200_000) $('#doc-text').value = await f.text() })
$('#doc-read').onclick = async () => {
  const text = $('#doc-text').value.trim(); if (!text) return
  if (example()) { fill($('#doc-out'), notice('info', 'This page shows example data. Add your hub to read documents with its AI.')); return }
  fill($('#doc-out'), el('div', { class: 'row footnote' }, icon('spark', { size: 16 }), 'The hub’s AI is reading the document…'))
  const h = hub()
  try {
    const props = await call(h.url + '/api/devices/documents', { key: h.key, body: { text } })
    if (!props.length) { fill($('#doc-out'), notice('info', 'No rule found for your machines in this document.')); return }
    const boxes = props.map((p, i) => {
      const d = h.devices.find((x) => x.id === p.deviceId)
      const same = (r) => JSON.stringify({ when: r.when, do: r.do }) === JSON.stringify({ when: p.rule.when, do: p.rule.do })
      const already = !!d && (d.rules || []).some(same)
      return { p, d, already, input: el('input', { type: 'checkbox', id: `doc-r${i}`, checked: !already, disabled: already, style: 'width:22px;height:22px;accent-color:var(--blue)' }) }
    }).filter((b) => b.d)
    fill($('#doc-out'), el('div', { class: 'proposal' },
      el('div', { class: 'row' }, el('h3', { class: 'grow' }, 'Proposed rules'), el('span', { class: 'ai-tag' }, aiTag())),
      el('div', { class: 'group' }, boxes.map((b, i) => el('label', { class: 'cell', for: `doc-r${i}` }, b.input, porthole({ ...b.d, state: { status: 'idle' } }, { size: 40 }),
        el('div', { class: 'grow' }, el('div', { class: 'title' }, ruleText(b.p.rule)), el('div', { class: 'sub' }, b.already ? `${b.d.name} · already set` : b.d.name))))),
      el('button', { class: 'btn primary block', type: 'button', on: { click: async () => {
        const chosen = boxes.filter((b) => b.input.checked && !b.already)
        if (!chosen.length) return
        try {
          for (const d of [...new Set(chosen.map((b) => b.d))]) {
            const { state: _s, earned: _e, uses: _u, basePrice: _b, lastTriggered: _l, ...cfg } = d
            const rules = [...(cfg.rules || []), ...chosen.filter((b) => b.d === d).map((b) => b.p.rule)]
            await call(`${h.url}/api/devices/${encodeURIComponent(d.id)}/apply`, { key: h.key, body: { config: { ...cfg, rules } } })
          }
          fill($('#doc-out'), notice('ok', `${chosen.length} rule${chosen.length === 1 ? '' : 's'} added.`)); await refresh()
        } catch (err) { $('#doc-out').append(notice('bad', err.message)) }
      } } }, 'Add selected rules')))
  } catch (err) { fill($('#doc-out'), notice('bad', err.message)) }
}

// ---------- hubs and wallets ----------
$('#add-hub-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const url = normUrl($('#hub-url').value); const key = $('#hub-key').value.trim()
  if (!url || !key) { fill($('#add-hub-msg'), notice('bad', 'Enter the hub address (e.g. 192.168.7.246:8080) and its owner key.')); return }
  try {
    await call(url + '/api/wallet', { key }) // checks both the address and the owner key
    if (!hubCfg.some((x) => x.url === url)) hubCfg.push({ url, key })
    save_('hostHubs', hubCfg); hubIndex = hubCfg.findIndex((x) => x.url === url); save_('hostHubIndex', hubIndex)
    $('#hub-key').value = ''; show(null); await refresh()
  } catch (err) { fill($('#add-hub-msg'), notice('bad', `Could not open the hub: ${err.message}`)) }
})
function removeHub (i) { hubCfg.splice(i, 1); save_('hostHubs', hubCfg); hubIndex = 0; save_('hostHubIndex', 0); refresh() }
$('#add-wallet-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const url = normUrl($('#wallet-url').value)
  if (!url) { fill($('#add-wallet-msg'), notice('bad', 'Enter an address like http://127.0.0.1:8091.')); return }
  try {
    await call(url + '/api/me')
    if (!walletCfg.some((x) => x.url === url)) walletCfg.push({ url, label: walletCfg.length ? `Wallet ${walletCfg.length + 1}` : 'My wallet' })
    save_('hostWallets', walletCfg); show(null); await refresh()
  } catch (err) { fill($('#add-wallet-msg'), notice('bad', `No wallet answers at ${url}: ${err.message}`)) }
})

// ---------- sheets ----------
// Sheets grow out of the element that opened them and sink back when closed (web/liquid.js).
async function show (id, from) {
  const open = [...document.querySelectorAll('.sheet')].find((s) => !s.hidden)
  if (open && open.id !== id) { await morphClose(open); open.hidden = true }
  if (id) {
    const sheet = document.getElementById(id); sheet.hidden = false
    const panel = sheet.querySelector('.sheet-panel'); panel.focus({ preventScroll: true }); morphOpen(panel, from || null)
  }
  document.body.style.overflow = id ? 'hidden' : ''
}
const sheetOpen = () => [...document.querySelectorAll('.sheet')].some((s) => !s.hidden)
document.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target.classList?.contains('sheet')) show(null) })
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') show(null) })
$('#wallets').addEventListener('scroll', () => { const c = $('#wallets'); const i = Math.round(c.scrollLeft / c.clientWidth); if (i !== walletIndex) { walletIndex = i; render() } }, { passive: true })

// static icons in the markup
fill($('#brand-mark'), icon('hub', { size: 16 }))
$('#demo-tag').after(themeButton())
liquid(); morphTopbar($('.topbar'), $('#hub-name'))
lens($('.topbar'))
fill($('#ico-add'), icon('plus', { size: 16 }))
fill($('#ico-doc'), icon('doc', { size: 16 }))
document.querySelectorAll('[data-chev]').forEach((n) => fill(n, icon('chevronRight', { size: 18 })))
document.querySelectorAll('[data-close]').forEach((b) => fill(b, icon('close', { size: 18 })))
document.querySelectorAll('[data-send]').forEach((b) => fill(b, icon('send', { size: 18 })))
fill($('#ai-tag-1'), aiTag()); fill($('#ai-tag-2'), aiTag())

refresh()
setInterval(() => { if (!sheetOpen() && hubs.some((h) => (h.devices || []).some((d) => statusOf(d).until > Date.now()))) render() }, 1000) // countdowns tick locally
setInterval(() => { if (!sheetOpen()) refresh() }, 30000) // the hub blocks while rgb-lib syncs: poll gently
