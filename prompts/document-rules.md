You read a document of a shared space (house rules, rental contract, appliance manual; any language) and find the rules that the hub's devices can apply BY THEMSELVES. Reply with JSON only: {"rules":[...]}, at most 8 rules.

Keep only rules a device can enforce with these triggers and actions:
- triggers: "after_hour" (after a time of day, 0-23), "weekday" (on some days; weekend = sat, sun), "use_count" (every N uses), "stock_below" (fewer than N items), "overdue" (a rental is late).
- actions: "lock", "unlock", "change_price" (pricePercent), "propose_purchase" (maintenance, restock, a part to replace), "notify" (tell the host), "keep_deposit".
Skip everything a machine cannot check (e.g. "do not wash shoes", "empty the machine within 15 minutes", "write to the manager"), and fixed prices (they are already in the service).
A closing time means "lock" at that hour AND "unlock" at the opening hour.
Write one rule per device: if a sentence is about "the machines", make one rule for each service it applies to.

The hub's services are listed below as `id: name (type)`. Each rule:
- serviceId: the service the rule is about.
- description: one short English sentence for the host, e.g. "Lock the washing machine after 10 pm".
- triggerKind, triggerNumber, triggerDays (only for "weekday", else []), actionKind,
- purchaseItem, purchaseQuantity, purchaseMaxDollars, pricePercent, depositDollars, message: only when needed, else null.
Copy numbers exactly as written in the document.

Example (services: washer: Washing machine (use), dryer: Dryer (use)), document "Open 8:00-20:00. Every 30 washes clean the washing machine filter.":
{"rules":[
{"serviceId":"washer","description":"Lock the washing machine after 8 pm","triggerKind":"after_hour","triggerNumber":20,"triggerDays":[],"actionKind":"lock","purchaseItem":null,"purchaseQuantity":null,"purchaseMaxDollars":null,"pricePercent":null,"depositDollars":null,"message":null},
{"serviceId":"washer","description":"Unlock the washing machine at 8 am","triggerKind":"after_hour","triggerNumber":8,"triggerDays":[],"actionKind":"unlock","purchaseItem":null,"purchaseQuantity":null,"purchaseMaxDollars":null,"pricePercent":null,"depositDollars":null,"message":null},
{"serviceId":"dryer","description":"Lock the dryer after 8 pm","triggerKind":"after_hour","triggerNumber":20,"triggerDays":[],"actionKind":"lock","purchaseItem":null,"purchaseQuantity":null,"purchaseMaxDollars":null,"pricePercent":null,"depositDollars":null,"message":null},
{"serviceId":"dryer","description":"Unlock the dryer at 8 am","triggerKind":"after_hour","triggerNumber":8,"triggerDays":[],"actionKind":"unlock","purchaseItem":null,"purchaseQuantity":null,"purchaseMaxDollars":null,"pricePercent":null,"depositDollars":null,"message":null},
{"serviceId":"washer","description":"Propose a filter cleaning every 30 washes","triggerKind":"use_count","triggerNumber":30,"triggerDays":[],"actionKind":"propose_purchase","purchaseItem":"filter cleaning","purchaseQuantity":null,"purchaseMaxDollars":null,"pricePercent":null,"depositDollars":null,"message":null}
]}
