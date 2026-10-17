# HubWallet — implementation plan (agreed Saturday 17 October)

## What it is
HubWallet lets anyone who offers a service **connect their devices to a physical hub**, and lets users **use them by paying with RGB assets on Bitcoin**: access keys, pay-per-use, time-based rentals. No platform in the middle: money moves wallet to wallet, data stays in the home.

## 1. Wallets (WDK)
| Wallet | Lives on | Holds | Does |
|---|---|---|---|
| **User** | user's phone | seed + their assets | receives keys, pays for services |
| **Host signer** | host's phone | **the hubs' seeds** + the host's personal wallet | **signs** anything that spends; receives swept earnings |
| **Hub (watch-only)** | the physical hub | **public keys (xpubs) + RGB stash, no seed** | creates invoices, receives and validates payments, **prepares** transactions for the host to sign |

The hub never holds a private key: stealing it does not move funds or issue keys.
Verified on Saturday morning with a real transfer: watch-only hub prepares a PSBT, a separate signer signs, the hub broadcasts
(`rgb-sdk` `WalletManager` with xpubs only + `signPsbt(mnemonic, psbt)`; tx b57fc305…9563 on Mutinynet).
Note: the hub must keep the RGB stash (assets are not on-chain); only the seed moves to the signer.

## 2. Local AI (QVAC) on the hub
### a) Plug-and-play device setup
1. A new device introduces itself with a small descriptor (name, type, commands). In the product it comes from the device (Matter / Home Assistant); in the demo we paste it, or the host **photographs the device label** and the vision model reads it.
2. The AI proposes a service: template (access / use / rent), suggested price, sensible behaviours.
3. The host confirms or edits in plain language; code activates it.

### b) The home's documents (private)
The host uploads house rules, rental contract, appliance manuals. The AI:
1. **contract → rules**: check-out 11:00, 50 deposit, quiet after 22:00 → proposed behaviours;
2. **guest assistant grounded on the documents** (RAG): "how does the boiler work?", "when is check-out?";
3. **reports for the host**: earnings and incidents per device (Private financial intelligence track).
Why local: contracts, documents and usage patterns are private; nothing leaves the hub.

### c) Already done (Lapo)
Text → service, text → behaviour, text → bundle (`src/ai.js`).

## 2-bis. Device functions (behaviours)
Rules of the form *when X, do or propose Y*, created from the device descriptor, from the contract, or in plain language.

| Device | Function | Action |
|---|---|---|
| 🚪 Door | key valid only during the stay dates | open / refuse |
| 🧺 Washing machine | blocked after 22:00 · every 50 washes, maintenance | lock · **propose purchase** |
| 🚲 Bike | rental overdue · weekend price +20% | **keep deposit** · change price |
| 🍺 Minibar | stock below 3 | **propose restock** to the supplier |

Actions the code can execute (few and safe): **propose a purchase** (goes to "To sign" on the host's phone, approval = signature) · change price · lock/unlock · keep deposit · notify the host.
The AI writes rules, code executes them (`src/behaviours.js`), only the host authorises spending, by signing.

## 3. RGB
| Asset | Schema | Use |
|---|---|---|
| **HUSD** test dollar | NIA, precision 2 | pay-per-use, rentals, restocks, earnings |
| **Stay key** (one per booking) | NIA, quantity 1 | access: the guest hands it to the door |

Operations: issuance · blinded invoices (the hub never sees the guest's UTXOs) · transfers with client-side validation of the **contract id** (a fake key is refused) · prepare/sign split (PSBT) · sweeping hub earnings to the host wallet.

## 4. Who does what
| Who | Tasks |
|---|---|
| Vittorio's Claude (demo PC) | Architecture C: watch-only `wallet.js`, `src/signer.js` (host phone), spending in `hub.js` waits for a signature |
| Alessandro | `behaviours.js`, washing machine and bike end to end, hub B, final README |
| Lapo | plug-and-play (descriptor or photo → service), house documents (contract → rules, RAG assistant), `/api/ai/*` routes |
| Vittorio | pages: host app (with **"To sign"**), guest app, device pages |

## 5. Priorities
1. **Core, by Saturday evening:** two watch-only hubs, host signer, guest enters with the key, pays the washing machine, rents the bike. All real.
2. **AI, by Sunday morning:** plug-and-play from descriptor, contract → rules, one assistant question.
3. **Stretch:** label photo with vision, host reports, automatic sweeping.
Internal deadline: full demo rehearsed **Sunday 11:00**; submission 13:00.
