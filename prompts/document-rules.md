You read a document of a shared space (house rules, rental contract, appliance manual; any language) and find the rules that the hub's devices can apply BY THEMSELVES. Reply with JSON only: {"rules":[...]}, at most 8 rules.

Keep only rules a device can enforce:
- whenKind: "after_hour" (after a time of day, whenNumber 0-23), "weekday" (whenDays; weekend = sat, sun), "counter_at" (every N uses), "stock_below" (fewer than N items), "overdue" (a rental is late).
- doKind: "lock", "unlock", "set_price" (pricePercent for "+10%", or priceDollars), "propose_purchase" (reason: "maintenance", "filter replacement"…), "notify" (reason = message), "keep_deposit".
Skip everything a machine cannot check (e.g. "do not wash shoes", "empty the machine within 15 minutes", "write to the manager") and the normal prices (they are already in the device).
A closing time means "lock" at that hour AND "unlock" at the opening hour, for EACH device it applies to.
Write one rule per device: if a sentence is about "the machines", make one rule for each device.

Each rule: deviceId (from the list below), description (one short English sentence for the host), whenKind, whenNumber, whenDays ([] unless "weekday"), doKind, priceDollars, pricePercent, reason, depositDollars (null when not needed). Copy numbers exactly as written.

Example (devices: washer: Washing machine, dryer: Dryer), document "Open 8:00-20:00. Every 30 washes clean the washing machine filter. Drying costs 10% more on Sundays.":
{"rules":[
{"deviceId":"washer","description":"Lock the washing machine after 8 pm","whenKind":"after_hour","whenNumber":20,"whenDays":[],"doKind":"lock","priceDollars":null,"pricePercent":null,"reason":null,"depositDollars":null},
{"deviceId":"washer","description":"Unlock the washing machine at 8 am","whenKind":"after_hour","whenNumber":8,"whenDays":[],"doKind":"unlock","priceDollars":null,"pricePercent":null,"reason":null,"depositDollars":null},
{"deviceId":"dryer","description":"Lock the dryer after 8 pm","whenKind":"after_hour","whenNumber":20,"whenDays":[],"doKind":"lock","priceDollars":null,"pricePercent":null,"reason":null,"depositDollars":null},
{"deviceId":"dryer","description":"Unlock the dryer at 8 am","whenKind":"after_hour","whenNumber":8,"whenDays":[],"doKind":"unlock","priceDollars":null,"pricePercent":null,"reason":null,"depositDollars":null},
{"deviceId":"washer","description":"Propose a filter cleaning every 30 washes","whenKind":"counter_at","whenNumber":30,"whenDays":[],"doKind":"propose_purchase","priceDollars":null,"pricePercent":null,"reason":"filter cleaning","depositDollars":null},
{"deviceId":"dryer","description":"Sunday price +10%","whenKind":"weekday","whenNumber":null,"whenDays":["sun"],"doKind":"set_price","priceDollars":null,"pricePercent":10,"reason":null,"depositDollars":null}
]}
