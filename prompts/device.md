A new device was connected to a home hub (short-term rental home). It introduces itself with a descriptor (JSON: name, type, commands, sensors...). Propose how the host can offer it to guests. Reply with JSON only.

Service:
- name: short English name for guests, 1 to 4 words (not the model number).
- kind: what the device is, one of the allowed values; "other" if nothing fits.
- type: "access" (it opens: door, gate, locker), "use" (pay once per use: washing machine, dryer, coffee, minibar), "rent" (pay per hour: bike, scooter, parking, charger).
- priceDollars: a fair suggested price for a guest in an Italian holiday flat, in dollars (per hour for "rent"; 0 for "access").
  Typical prices: coffee 1, drink from the minibar 2.5, washing machine 3, dryer 2, bike or e-bike 3 per hour, scooter 4 per hour, parking 1 per hour, EV charger 5 per hour.
- maxHours: for "rent" a sensible maximum (e.g. 4 for a bike), otherwise null.

Behaviours: 0 to 3 useful rules for this device, only if the device can do them (look at its commands and sensors).
- Doors and locks ("access"): no rules (the guest's key already decides who enters, at any hour).
- Rentals ("rent"): a late return (overdue → keep_deposit or notify) and a weekend price (+20%) are the useful rules.
Each rule:
- description: one short English sentence for the host, e.g. "Lock the washing machine after 10 pm".
- triggerKind: "stock_below" (fewer than N items left; needs a stock sensor), "weekday" (on some days), "overdue" (a rental is late), "after_hour" (after a time of day, 0-23), "use_count" (every N uses, e.g. maintenance every 50 washes; needs a cycle counter).
- triggerNumber / triggerDays: the value for the trigger (triggerDays only for "weekday", else []).
- actionKind: "propose_purchase" (restock), "change_price", "notify", "lock" (needs a lock command), "unlock", "keep_deposit".
- the other fields only when needed by the action, else null: purchaseItem, purchaseQuantity, purchaseMaxDollars, pricePercent, depositDollars, message.

Example descriptor: {"name":"Bosch Serie 4 WAN28","type":"washing_machine","commands":["start","stop","lock","unlock"],"sensors":["door","cycle_count"]}
→ {"name":"Washing machine","kind":"washer","type":"use","priceDollars":3,"maxHours":null,"behaviours":[{"description":"Lock the washing machine after 10 pm","triggerKind":"after_hour","triggerNumber":22,"triggerDays":[],"actionKind":"lock","purchaseItem":null,"purchaseQuantity":null,"purchaseMaxDollars":null,"pricePercent":null,"depositDollars":null,"message":null},{"description":"Unlock it again at 8 am","triggerKind":"after_hour","triggerNumber":8,"triggerDays":[],"actionKind":"unlock","purchaseItem":null,"purchaseQuantity":null,"purchaseMaxDollars":null,"pricePercent":null,"depositDollars":null,"message":null}]}

Example descriptor: {"name":"Liebherr minibar 40L","type":"minibar","commands":["lock","unlock"],"sensors":["stock:beer","door"]}
→ {"name":"Minibar","kind":"fridge","type":"use","priceDollars":3,"maxHours":null,"behaviours":[{"description":"Propose a restock of 12 beers when fewer than 3 are left","triggerKind":"stock_below","triggerNumber":3,"triggerDays":[],"actionKind":"propose_purchase","purchaseItem":"beer","purchaseQuantity":12,"purchaseMaxDollars":null,"pricePercent":null,"depositDollars":null,"message":null}]}

Example descriptor: {"model":"Cowboy 4","category":"ebike","capabilities":["lock","unlock","gps"]}
→ {"name":"E-bike","kind":"bike","type":"rent","priceDollars":3,"maxHours":4,"behaviours":[{"description":"Tell me if the bike is more than 1 hour late","triggerKind":"overdue","triggerNumber":1,"triggerDays":[],"actionKind":"notify","purchaseItem":null,"purchaseQuantity":null,"purchaseMaxDollars":null,"pricePercent":null,"depositDollars":null,"message":"The e-bike is more than 1 hour late."},{"description":"Weekend price +20%","triggerKind":"weekday","triggerNumber":null,"triggerDays":["sat","sun"],"actionKind":"change_price","purchaseItem":null,"purchaseQuantity":null,"purchaseMaxDollars":null,"pricePercent":20,"depositDollars":null,"message":null}]}
