# HubWallet

> The home has a wallet and an assistant. Every device has its own price, its own rules and its own balance: it grants access, gets paid and pays for its own restocks, in dollars on Bitcoin, with an AI that never leaves the house.

**Team:** AVL
**Event:** Agentic Dollars on Bitcoin, BLOX Turin, 17–18 October 2026
**Tracks:** Payments and checkout · Autonomous economic agents

## The problem

Short-term rental hosts manage access and extras with tools that do not fit:

- Door codes are sent by message and can be copied and shared.
- Extras (washing machine, minibar) are either not charged at all, run on trust, or need a different app or card for each device.
- Booking and smart-home platforms collect data on who comes in and when. Usage data reveals when a home is empty.
- A device cannot open a bank or Stripe account, so it cannot get paid or pay for anything by itself.

## Our solution

A home hub that lets a host sell or rent any shared service, with a local AI that turns plain language into working services.

- **Any service, three templates.** The host describes what they offer ("e-bike in the courtyard, 3 dollars an hour, max 4 hours, daytime only") and the AI turns it into a service: **access** (an RGB token you hand over to get in), **pay-per-use** (USDT per use) or **time-based rental** (an RGB token valid for a number of hours).
- **Behaviours.** Each service can also have behaviours, described in plain language and turned into rules: "if fewer than 3 beers are left, propose a restock", "weekend price +20%", "if the bike is not back after 4 hours, keep the deposit". Any action that spends money is proposed to the host, who approves it.
- **Access as an asset.** A stay is an RGB asset issued by the host and owned by the guest. The guest can pass it to a friend without asking anyone, and opens the door by transferring it to the lock.
- **Nearby services.** The guest scans a QR code on the device, or simply asks: "I need to do a wash and then take the bike for 2 hours". The AI proposes the bundle, the code computes the price, the guest confirms and pays in USDT on RGB.
- **The hub is the economic agent of the home.** Each device has its own account and rules; the hub's local AI manages them. Giving each device its own wallet is a later step.

## Why this stack

- **RGB:** access rights and dollars are assets the user actually owns, transfers privately and verifies client-side. There is no central database of guests and no intermediary.
- **QVAC:** microphones and usage data stay inside the home. There is no cost per request for small hosts, and it works offline.
- **Why not Stripe:** a fridge cannot open a Stripe account, and a card payment does not give the guest a key they own and can pass on.

## What works (built during the hackathon)

- **Hub** (`src/hub.js`, `src/hub-core.js`): one per place, with its own **watch-only RGB wallet** (no seed on the hub). It sells the services of its machines, creates RGB invoices, validates incoming payments client-side (rgb-lib) and starts the machine when the payment settles on Mutinynet. Every spend (e.g. moving earnings to the host) is prepared by the hub and **signed only by the host** with `src/signer.js`.
- **Guest wallet** (`src/guest.js`): a self-custodial **Tether WDK** wallet (`wdk-wallet-rgb`). It decodes the hub's invoice itself, shows what it will pay, pays in our test dollar HUSD and keeps the hub's signed receipt.
- **Machines with services** (`src/devices.js`): a washing machine with 30° / 40° / 60° washes, a coffee machine with espresso / cappuccino; each service has its price, its run time and the hours it is offered.
- **Local AI (QVAC, Qwen3.5 2B)** (`src/ai.js`): the host adds a machine or changes it in plain language ("add a dryer, 2 dollars a cycle", "lock it after 22:00", "weekend +10%", "add a 60° wash for 3.50, 90 minutes"). The AI only proposes; **code validates every number** (a price is kept only if the host wrote it) and the host presses Apply. Requests about keys, guests' identities or moving money get a fixed answer from code, before any model call.
- **Web apps** (`web/`): host app (desktop and phone), guest app (phone), device screen with QR.

Every payment shown is a real RGB transfer on Mutinynet. The machines are simulated web pages.

## Run it

Requirements: Linux x86_64, **Node 22**, network access to Mutinynet (`esplora.signet.kaleidoswap.com`, `proxy.kaleidoswap.com`).

```bash
npm install
node src/signer.js init hub-demo            # host side, once: keeps the seed, writes data/hub-demo/hub-keys.json
# the hub (watch-only). QVAC_* = the OpenAI-compatible server of `qvac serve --openai` (optional: without it the AI is off)
QVAC_URL=http://<ai-pc>:11434 QVAC_API_KEY=<key> MINUTE_MS=1000 USE_MS=45000 \
HUB_NAME=Laundry PORT=8080 WALLET=hub-demo DOLLAR_ASSET=<rgb:… asset id of the dollar> node src/hub.js
PORT=8090 WALLET=guest-demo node src/guest.js     # the guest's wallet, localhost only
node src/signer.js watch hub-demo http://localhost:8080   # the host approves spends here
```

- Host app: `http://localhost:8080/host.html` → "Add a hub": `http://localhost:8080` + the owner key printed by the hub (`data/hub-demo/owner-key.txt`, never committed).
- Guest app: `http://localhost:8090/guest.html` → "Connect a hub", or open `guest.html?hubs=<hub url>`.
- `MINUTE_MS=1000` makes one service minute last one second (a 30 min wash runs 30 s in the demo).
- Wallets need sats for fees and free UTXOs: the guest app offers "Prepare my wallet", and the wallet creates UTXOs itself when it runs out.
- Phone demo: the guest wallet behind a password tunnel (Pinggy, `b:user:pass`) and the hub behind a Cloudflare quick tunnel; the guest opens `<wallet tunnel>/guest.html?hubs=<hub tunnel>`.

## Demo

1. Host (desktop): add the **Laundry** hub; it has a washing machine with 30° / 40° / 60° washes.
2. Host: "Add a machine" → tell the AI "a dryer, 2 dollars per cycle" → Add.
3. While the guest app picks it up: on the washing machine ask the AI for rules ("lock it after 22:00", "weekend +10%") → Apply.
4. Guest (phone): the dryer appears → Pay → the wallet shows what it checked → Confirm. About a minute later (one Bitcoin block) the hub says "paid" and the dryer starts; the receipt is signed by the hub.

## Stack (as built)

- RGB on Bitcoin (Mutinynet, rgb-lib `signet`) through UTEXO `rgb-sdk` / `@utexo/rgb-lib` 0.3; our own NIA test dollar **HUSD** (precision 2).
- Tether **WDK** `@utexo/wdk-wallet-rgb` for the guest and host wallets; watch-only rgb-sdk wallet + external PSBT signing for the hub.
- **QVAC** local AI (`qvac serve --openai`, Qwen3.5 2B) on a team member's PC, JSON schema output.
- Node 22 + Express, plain HTML/CSS/JS pages. Performance notes: `docs/PERF.md`.

## Work done before the hackathon

No product code in this repository. Before the event we ran a feasibility test of WDK on Mutinynet (issue a test asset and transfer it between two wallets, outside this repo), studied the documentation and tutorials, set up the development environment and planned the idea. To explain the idea to the team we made a clickable UI mockup (a single HTML page with simulated data, no RGB and no AI). If we reuse any of its layout, we will say so in the commit. All RGB and QVAC integration will be written during the hackathon, with dated commits.

## Vision (beyond the hackathon)

The same hub works wherever a device is shared: laundromats, coworking spaces, gyms, EV chargers. Commercial machines already have payment interfaces (MDB for vending, pulse inputs for laundry, OCPP for chargers) where the coin mechanism can be replaced. Home Assistant and Matter integration makes thousands of existing devices compatible.

Every service can sell (its template) and buy (its behaviours). When services belong to different owners, machines pay each other: a bike buys a charge from a neighbour's station, a washing machine runs when the building's solar energy is cheapest.
