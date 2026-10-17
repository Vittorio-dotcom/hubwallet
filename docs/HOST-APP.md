# Host app and device configuration — proposal (Vittorio, Saturday afternoon)

Status: **proposal, to be confirmed by Alessandro (device layer on hub-core) and Lapo (AI edit function).**
Built on the real payment layer in `API_usage.md`; nothing here changes `hub-core.js` or the wallets.

## 1. What the host sees (from the team sketch)
1. **Wallet cards** (swipe, like the guest app): the host's personal wallet(s), i.e. `src/guest.js` with
   `WALLET=provider` (payer wallet API, §4 of `API_usage.md`). Last card: "+ Add wallet".
2. **Hubs**: list of the host's hubs, each with its earnings (hub `GET /api/wallet`, owner key) and a
   **"Sweep to my wallet"** button (hub `POST /api/transfers` → To sign). Last item: **"+ Add hub by address"**
   (hub URL + owner key, kept on the host's device).
3. **To sign**: banner with the pending items of the selected hub (`GET /api/to-sign?status=pending`), reject from the
   page (`POST /api/to-sign/:id/reject`). Approving happens on the signer (`src/signer.js watch`): the page says so.
4. **Your devices** of the selected hub: grid of devices, **"Add device"** (plug-and-play from a descriptor), and on each
   device **"Describe changes"**: plain language → the hub's AI proposes a new device JSON → the page shows the
   differences → **Apply**.

## 2. Device configuration: one JSON file per device
Stored on the hub, e.g. `data/<hub>/devices/<id>.json`, with previous versions kept (`<id>.v<n>.json`) for rollback.
```json
{
  "id": "washer",
  "name": "Washing machine",
  "icon": "🧺",
  "type": "use",
  "price": 250,
  "unit": "wash",
  "commands": ["start", "stop"],
  "rules": [
    { "when": { "kind": "after_hour", "value": 22 }, "do": { "kind": "lock" } },
    { "when": { "kind": "counter_at", "value": 50 }, "do": { "kind": "propose_purchase", "reason": "maintenance" } }
  ],
  "version": 3,
  "updatedAt": "2026-10-17T15:40:00Z"
}
```
- `type`: `use` (pay per use) for the laundry demo; `rent` and `access` stay possible later.
- `price`: integer, smallest unit of HUSD (250 = 2.50). Never computed by the AI.
- `rules[].when.kind`: `after_hour`, `weekday`, `stock_below`, `counter_at`, `overdue` · `rules[].do.kind`: `lock`, `unlock`,
  `set_price`, `notify`, `propose_purchase`, `keep_deposit` (same vocabulary as the behaviours engine, PLAN §4).
- Validation by code before saving: known fields only, `price` positive integer, rule kinds from the lists above,
  `id` unchanged, `version` incremented by the hub (not by the AI).

## 3. Editing a device with the AI
1. Host writes: "raise it to 2.50 and lock it after 22:00".
2. Hub → AI (Lapo): `editDevice(text, currentJson)` → proposed JSON (structured output, `reasoning_budget: false`).
3. Hub validates (§2), computes the diff and returns it **without saving**.
4. Page shows: `price 2.00 → 2.50`, `+ rule: lock after 22:00`. Host presses **Apply** → hub saves version n+1.

## 4. Routes needed (device layer on top of hub-core, mounted in `src/hub.js`)
Owner (`X-Hub-Key`):
| Method | Route | Body → Response |
|---|---|---|
| GET | `/api/devices` | → `[device JSON + state: { status: 'idle'|'running'|'locked', until? }, earned]` |
| POST | `/api/devices` | `{ descriptor }` → `{ proposed }` (AI plug-and-play, not saved) |
| POST | `/api/devices/:id/edit` | `{ text }` → `{ proposed, diff: [{ field, from, to }] }` (AI, not saved) |
| POST | `/api/devices/:id/apply` | `{ config }` → saved device JSON (validated, `version`+1) |
| POST | `/api/devices/:id/rollback` | `{ version }` → saved device JSON |

Public (guests), replacing the old service routes the guest app calls:
| Method | Route | Body → Response |
|---|---|---|
| GET | `/api/services` | → `{ name, dollar, dollarId, services: [{ id, name, icon, type, price, unit, state }] }` |
| POST | `/api/services/:id/order` | `{}` → `{ id: paymentId, ... }` via `hub.requestPayment` (amount from the device JSON) |

On `hub.on('paid')`: set the device of `p.meta.serviceId` to `running`; rules are evaluated by the behaviours engine.

## 5. Who does what (proposal)
| Who | What |
|---|---|
| Alessandro (or whoever he agrees) | device layer: files, validation, versions, routes §4, `paid` → device state |
| Lapo | `editDevice(text, json)` and `deviceToService(descriptor)` in `src/ai.js` |
| Vittorio | host app (`web/host.html`), guest app updated to `/api/check` + `/api/pay-request` |
