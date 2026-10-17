// Guest app: talks to its own wallet (same origin) and to a hub (?hub=http://ip:port).
const qs = new URLSearchParams(location.search)
const HUB = (qs.get('hub') || localStorage.getItem('hub') || 'http://localhost:8080').replace(/\/$/, '')
const FOCUS = qs.get('service')
try { localStorage.setItem('hub', HUB) } catch {}

const $ = (s) => document.querySelector(s)
const money = (cents) => (cents / 100).toFixed(2)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

async function api (url, body) {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`)
  return j
}
const me = () => api('/api/me')
const hub = (path, body) => api(HUB + path, body)

let wallet = { assets: { nia: [] } }
let hubInfo = { services: [], dollar: 'HUSD' }
let busy = false

const dollarAsset = () => wallet.assets.nia.find((a) => a.ticker === hubInfo.dollar)
const myKeys = () => wallet.assets.nia.filter((a) => a.ticker.startsWith('STAY') && a.balance.spendable > 0)

function render () {
  $('#hub-name').textContent = hubInfo.name || 'Hub not reachable'
  $('#hub-url').textContent = HUB.replace(/^https?:\/\//, '')
  const d = dollarAsset()
  $('#dollars').textContent = d ? money(d.balance.spendable) : '0.00'
  $('#dollar-ticker').textContent = hubInfo.dollar
  $('#sats').textContent = (wallet.btc?.vanilla?.spendable ?? 0).toLocaleString('en')

  const keys = myKeys()
  $('#keys').innerHTML = keys.length
    ? keys.map((k) => `<div class="key"><span class="label">Your key</span><h2>${esc(k.name)}</h2><span class="mono">${esc(k.ticker)} · RGB asset</span></div>`).join('')
    : '<div class="empty">No key yet. The host sends it to your wallet when your stay is confirmed.</div>'

  const list = hubInfo.services.filter((x) => ['access', 'use', 'rent'].includes(x.type)).sort((a, b) => (b.id === FOCUS) - (a.id === FOCUS))
  $('#services').innerHTML = list.length ? list.map(serviceCard).join('') : '<div class="empty">This home has no services yet.</div>'
}

function deviceText (s) {
  const st = s.device?.state
  if (s.type === 'access') return st === 'open' ? '<span class="pill on">open</span>' : '<span class="pill off">locked</span>'
  if (s.type === 'use') return st === 'running' ? '<span class="pill on">running</span>' : '<span class="pill off">ready</span>'
  if (st === 'rented') return `<span class="pill on">rented · ${Math.max(0, Math.ceil((s.device.until - Date.now()) / 1000))} s left</span>`
  return '<span class="pill off">available</span>'
}

function serviceCard (s) {
  const kind = { access: 'Access', use: 'Pay per use', rent: 'Rental' }[s.type]
  let action = ''
  if (s.type === 'access') action = `<button class="primary" data-act="${esc(s.id)}" ${busy || !myKeys().length ? 'disabled' : ''}>Open with my key</button>`
  if (s.type === 'use') action = `<button class="primary" data-act="${esc(s.id)}" ${busy || s.device?.state === 'running' ? 'disabled' : ''}>Start · ${money(s.price)} ${esc(hubInfo.dollar)}</button>`
  if (s.type === 'rent') {
    const max = s.maxHours || 4
    action = `<select id="h-${esc(s.id)}" aria-label="Hours">${Array.from({ length: max }, (_, i) => `<option value="${i + 1}">${i + 1} h · ${money(s.price * (i + 1))}</option>`).join('')}</select>
      <button class="primary" data-act="${esc(s.id)}" ${busy || s.device?.state === 'rented' ? 'disabled' : ''}>Rent</button>`
  }
  const price = s.type === 'access' ? 'with your key' : `${money(s.price)} ${esc(hubInfo.dollar)} ${s.type === 'rent' ? 'per hour' : 'per use'}`
  return `<div class="svc ${s.id === FOCUS ? 'focus' : ''}">
    <span class="ic" aria-hidden="true">${esc(s.icon)}</span>
    <div class="row" style="flex-direction:column;align-items:stretch;gap:6px">
      <div class="row"><h3 class="grow">${esc(s.name)} <span class="pill ${s.type}">${kind}</span></h3>${deviceText(s)}</div>
      <span class="small muted">${price}</span>
      <div class="row">${action}</div>
    </div></div>`
}

// ---------- buying: order → pay from my wallet → follow until the hub sees it ----------
const STEPS = ['Invoice from the home', 'Payment sent from your wallet', 'Home received it, waiting for Bitcoin confirmation', 'Done']
function track (title, step, msg, cls, link) {
  $('#tracking').hidden = false
  $('#track-title').textContent = title
  $('#track-steps').innerHTML = STEPS.map((s, i) => `<li class="${i < step ? 'done' : i === step ? 'on' : ''}">${s}</li>`).join('')
  const box = $('#track-msg')
  box.replaceChildren()
  if (msg) {
    const div = document.createElement('div')
    div.className = 'notice ' + (cls || '')
    div.textContent = msg
    box.append(div)
  }
  if (link && /^https:\/\//.test(link)) {
    const a = document.createElement('a')
    a.href = link; a.target = '_blank'; a.rel = 'noopener'; a.className = 'small'
    a.textContent = 'See on the explorer'
    $('#track-link').replaceChildren(a)
  }
}

async function buy (s) {
  busy = true; render()
  const title = s.name
  try {
    let body = {}, assetId
    if (s.type === 'access') { assetId = myKeys()[0].assetId; body = { stayAssetId: assetId } }
    if (s.type === 'rent') body = { hours: Number($(`#h-${s.id}`).value) }
    track(title, 0, 'Asking the home for an invoice…')
    const order = await hub(`/api/services/${s.id}/order`, body)
    // Pay only what the button showed: the right asset and the right amount.
    const expected = s.type === 'access' ? { assetId, amount: 1 } : { assetId: dollarAsset()?.assetId, amount: s.price * (body.hours || 1) }
    if (!expected.assetId || order.assetId !== expected.assetId || order.amount !== expected.amount) {
      throw new Error('The home asked for a different amount or asset than shown. Nothing was paid.')
    }
    assetId = order.assetId
    track(title, 1, s.type === 'access' ? 'Handing your key to the door…' : `Paying ${money(order.amount)} ${hubInfo.dollar}…`)
    const paid = await api('/api/pay', { invoice: order.invoice, assetId, amount: order.amount })
    track(title, 2, 'Sent. The home checks it on Bitcoin: this takes about a minute.', '', paid.link)
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 4000))
      if (i % 3 === 0) api('/api/refresh', {}).catch(() => {})
      const o = await hub(`/api/orders/${order.id}`)
      if (o.status === 'paid') {
        const done = { access: 'The door is open. Welcome!', use: `${s.name} started.`, rent: `${s.name} is yours for ${o.hours} h.` }[s.type]
        track(title, 4, done, 'ok', paid.link)
        break
      }
      if (o.status === 'failed' || o.status === 'underpaid') { track(title, 2, 'The home did not accept this payment. Nothing was activated.', 'bad', paid.link); break }
    }
  } catch (e) {
    track(title, 0, e.message, 'bad')
  } finally {
    busy = false
    await load()
  }
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]')
  if (!b || b.disabled) return
  const s = hubInfo.services.find((x) => x.id === b.dataset.act)
  if (s) buy(s)
})
$('#refresh').onclick = async () => { await api('/api/refresh', {}).catch(() => {}); load() }

async function load () {
  try { hubInfo = await hub('/api/services') } catch { hubInfo = { services: [], dollar: hubInfo.dollar } }
  try { wallet = await me() } catch {}
  render()
}
load()
setInterval(() => { if (!busy) load() }, 5000)
