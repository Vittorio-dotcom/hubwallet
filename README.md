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

## Plan for the hackathon

**Core (must work live):**
1. The host issues a stay token on Mutinynet and sends it to the guest.
2. The guest transfers it to the lock, the hub verifies the asset and the lock opens.
3. The guest pays in USDT for a pay-per-use service (washing machine) and it starts.
4. The guest rents a time-based service (bike) and the rental expires after the paid time.

**AI layer:**
5. The host creates services and behaviours in plain language (three templates).
6. The guest asks for what they need and gets a bundle proposal to confirm.
7. A behaviour proposes a purchase (minibar restock), the host approves and the hub pays the supplier in USDT.

**Stretch:** voice, translation, consumption over Lightning, WDK wallet.

**Honest scope note:** the devices are simulated as web pages (stretch goal: a microcontroller driving a real lock or LED). Every token transfer and payment is a real RGB transaction on Mutinynet, and the AI runs locally.

## Stack

- RGB Protocol on Bitcoin via the KaleidoSwap builder kit: RGB Lightning Node (kaleido-cli), kaleido-mcp, Mutinynet faucets.
- QVAC through KaleidoMind (`@kaleidorg/mind` + `@qvac/sdk`), Qwen3.5 2B, with a custom `device-access` skill.
- Web interfaces for the guest, the host and the devices.
- WDK: optional stretch goal.

Third-party tooling and any forks will be listed here as we use them.

## Work done before the hackathon

No product code. Before the event we studied the documentation and tutorials, set up the development environment and planned the idea. To explain the idea to the team we made a clickable UI mockup (a single HTML page with simulated data, no RGB and no AI). If we reuse any of its layout, we will say so in the commit. All RGB and QVAC integration will be written during the hackathon, with dated commits.

## Vision (beyond the hackathon)

The same hub works wherever a device is shared: laundromats, coworking spaces, gyms, EV chargers. Commercial machines already have payment interfaces (MDB for vending, pulse inputs for laundry, OCPP for chargers) where the coin mechanism can be replaced. Home Assistant and Matter integration makes thousands of existing devices compatible.

Every service can sell (its template) and buy (its behaviours). When services belong to different owners, machines pay each other: a bike buys a charge from a neighbour's station, a washing machine runs when the building's solar energy is cheapest.
