# HubWallet

> Whoever offers a physical service (a laundromat, a coworking space, a short-term rental) puts a small box in the
> shop: the **hub**. A customer scans a QR, picks a service and pays in **dollars on Bitcoin with RGB** from their own
> wallet — no app to install, no card, no platform in between. The hub **sees and receives payments but cannot
> spend**: only the owner holds that key. A **local AI** helps the owner set up devices and rules in plain language,
> without sending the business's data to the cloud.

**Team:** AVL
**Event:** Agentic Dollars on Bitcoin, BLOX Turin, 17–18 October 2026
**Tracks:** Payments and checkout · Autonomous economic agents

## The problem

Paying a small amount to a shared machine today means a card reader with fees and minimums, or a platform app that
takes a cut and collects data. A washing machine or a vending machine cannot open a bank account, so it cannot be
paid directly or pay for its own restock.

## How it works

Three roles, two kinds of keys:

- **The hub** (`src/hub.js` + `src/hub-core.js` + `src/devices.js`) is the box in the shop. It holds only **public**
  keys (xpubs): it can create invoices and see what it received, but it **cannot sign a spend**. It is reachable on
  the local network; customers open its pages from a QR code.
- **The client** (`src/guest.js`) is the customer's own wallet. It decodes the hub's invoice itself, shows exactly
  what it is about to pay, and signs with its own seed — the hub never sees a private key.
- **The service provider's signer** (`src/signer.js`) holds the hub's seed (in the product, the owner's phone). The
  hub only ever *prepares* a transaction (a PSBT); the signer shows it in plain language and asks for a yes before
  signing. Receiving a payment needs no signature at all; only the owner's outgoing transfers do (restocks, moving
  earnings to a personal wallet).

This is a **watch-only wallet with an external signer over PSBT** (BIP-174) — the same pattern BTCPay Server uses for
custodying nothing. Every signature in the system — the customer paying, the owner approving a spend — goes through
**WDK** (`@utexo/wdk-wallet-rgb`); the hub itself uses `rgb-sdk` directly only because it must never hold a seed.

**Local AI (QVAC, Qwen3.5 2B).** The owner describes a device or a change in plain language ("a dryer, 2 dollars a
cycle, lock it after 22:00"); the model only fills a JSON schema, the code validates every field and computes every
number, and the owner presses Apply before anything is saved. The AI never moves money and never touches a key — a
small local model can be wrong, so its reach is deliberately narrow. It runs on a machine on the local network in the
demo (confirmed by the mentors as on-device); in the product it runs inside the hub, because prices, rules and usage
patterns are the business's own data.

**Privacy.** RGB puts only a 32-byte commitment inside an ordinary Bitcoin transaction: the asset, the amount and the
parties are known only to the two wallets involved, and the receiver validates the payment itself (client-side
validation). The hub keeps no name, email, phone or IP — only a payment id, what was sold, the amount, the txid and a
hash-chained log, enough to reconcile earnings and answer a dispute without identifying anyone.

## Demo scope

A laundromat (**Laundry**) whose washing machine sells three services — a 30°, a 40° and a 60° wash, each with its own
price and run time. Machines can also have rules (lock at night, weekend prices, maintenance every N uses) and services
offered only at some hours (a cappuccino 7–11).

1. **Host (desktop):** add the Laundry hub (address + owner key). "Add a machine" → tell the local AI "a dryer,
   2 dollars per cycle" → Add. Services can be listed the same way ("a coffee machine with espresso 1.20 and
   cappuccino 2"); prices, minutes and hours are read by code, never invented by the model.
2. **While the guest app picks up the new machine:** on the washing machine ask the AI for rules ("lock it after
   22:00", "weekend +10%") → the proposal shows the diff → Apply.
3. **Guest (phone):** the dryer appears → Pay → the wallet shows what it decoded from the hub's invoice → Confirm.
   About one Bitcoin block later the hub says "paid", the dryer starts and the guest keeps the hub's signed receipt.
   The payment stays visible even if the guest closes the screen.

The local AI only proposes. Requests about keys or seeds, guests' identities or moving money get a fixed answer from
the code before any model call; removals, percentages and prices count only when the host wrote them.

## Run it

```bash
npm install
node src/signer.js init hub-demo                              # once: the hub's seed stays here, the hub gets public keys
HUB_NAME=Laundry PORT=8080 WALLET=hub-demo DEMO_DEVICES=1 MINUTE_MS=1000 \
  DOLLAR_ASSET=<rgb:… id of the dollar asset> \
  QVAC_URL=http://<ai-host>:11434 QVAC_API_KEY=... npm run hub  # the hub (watch-only)
node src/signer.js watch hub-demo http://localhost:8080        # the owner's signer (approves spends with y/n)
PORT=8090 WALLET=guest-demo npm run guest                      # the customer's wallet, serves web/guest.html
```
- Host app: `http://localhost:8080/host.html` → "Add a hub": `http://localhost:8080` + the owner key printed by the hub
  (`data/<wallet>/owner-key.txt`, never committed). Device screen: `web/device.html?id=washer`.
- Guest app: `http://localhost:8090/guest.html`, or `guest.html?hubs=<hub url>` to be offered the hub.
- `MINUTE_MS=1000` makes one service minute last one second in the demo (a 30 min wash runs 30 s); `USE_MS` is the run
  time of a machine without services.
- Phone: the guest wallet behind a password tunnel (Pinggy `b:user:pass`), the hub behind a Cloudflare quick tunnel
  (no interstitial page); the phone opens `<wallet tunnel>/guest.html?hubs=<hub tunnel>`. The wallet server can spend:
  never expose it without a password.
- Wallets need sats for fees and free UTXOs; the wallet creates UTXOs itself when it runs out. rgb-lib is synchronous:
  balance reads use the local database and the indexer sync runs only when needed (`docs/PERF.md`).

See `API_usage.md` for the HTTP API and `CLAUDE.md` for the AI contract.

## Real vs simulated

- **Real:** every RGB transfer, on Mutinynet; the local AI; the hub holds no seed (its data folder has only public
  keys and the RGB stash — check it).
- **Simulated:** the machines are web pages, not a real relay; we issue our own test dollar **HUSD** instead of the
  event's USDT faucet, because WDK's RGB adapter runs on the `signet` network while that faucet is on `signetcustom` —
  confirmed by the mentors as fine for judging; every role runs as a separate process with its own data folder on one
  PC, standing in for separate devices in the product.

## Stack and third-party tools

- **RGB**: `@utexo/wdk-wallet-rgb` and `rgb-sdk` (watch-only wallet), RGB-Tools / `rgb-protocol` v0.11.1, Mutinynet.
- **QVAC**: `@qvac/sdk`, Qwen3.5 2B (4-bit), OpenAI-compatible local server.
- **UI**: plain HTML/CSS/JS (no build step); glass styling adapted from
  [LiquidGlassSkill](https://github.com/stormaref/LiquidGlassSkill) (MIT) and a from-scratch JavaScript port of the
  edge-refraction technique in [liquid-glass-js](https://github.com/dashersw/liquid-glass-js) (MIT, © Armagan
  Amcalar) — both license headers are kept in `web/liquid-glass.css` and `web/refraction.js`.
- Express for the HTTP servers.

## Work done before the hackathon

No product code. Before the event we studied the documentation, set up the environment, and ran a throwaway
feasibility spike the night before (WDK + RGB on Mutinynet, outside this repo, keys never copied in) to confirm the
watch-only / external-signer pattern would work — see `notes/spike-wdk.md` in the team's knowledge folder. We also
made a clickable UI mockup (a single HTML page, simulated data, no RGB, no AI) to explain an earlier version of the
idea to the team; none of its code is reused here. All RGB, QVAC and UI code in `src/` and `web/` was written during
the hackathon, with dated commits.

## Vision

The same hub works wherever a machine is shared: laundromats, coworking spaces, gyms, EV chargers — commercial
machines already have payment interfaces (MDB for vending, pulse inputs for laundry, OCPP for chargers) where the
coin mechanism can be replaced. Next steps: RGB over Lightning for instant payments, real hardware (a relay instead
of a web page), encrypted data at rest on the hub with a daily on-chain anchor for the log, and pre-authorised
signing limits so small recurring spends (a restock, a hub paying another hub) do not need a human every time.
