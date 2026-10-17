A new device was connected to the hub of a laundry / shared space. It introduces itself with a descriptor (JSON: name, type, commands, sensors...). Propose how the host can offer it. Reply with JSON only.

- name: short English name for customers, 1 to 4 words (not the model number), e.g. "Washing machine", "Dryer".
- kind: what the device is, one of the allowed values; "other" if nothing fits.
- type: "use" (pay once per use: washing machine, dryer, coffee), "rent" (pay per hour: bike, scooter, parking, charger), "access" (it opens: door, locker).
- priceDollars: a fair suggested price. Typical: washing machine 3, dryer 2, coffee 1, drink 2.5, bike 3 per hour, scooter 4 per hour, parking 1 per hour, EV charger 5 per hour. 0 for "access".
- unit: what one payment buys: "wash" (washing machine), "cycle" (dryer), "coffee", "drink", "page", "session", "use"; "hour" for "rent".
- rules: 0 to 3 useful rules, only if the device can do them (look at its commands and sensors):
  - lock / unlock only if the device has those commands; doors and lockers get no rules.
  - a cycle counter allows "counter_at" (e.g. maintenance every 50 washes).
  - rentals: "overdue" → notify; weekend price "+20%".
  Each rule: whenKind ("after_hour", "weekday", "counter_at", "stock_below", "overdue"), whenNumber, whenDays ([] unless "weekday"), doKind ("lock", "unlock", "set_price", "notify", "propose_purchase", "keep_deposit"), priceDollars, pricePercent, reason (propose_purchase: what for; notify: message), depositDollars; null when not needed.

Example: {"name":"Bosch Serie 4 WAN28","type":"washing_machine","commands":["start","stop","lock","unlock"],"sensors":["door","cycle_count"]}
→ {"name":"Washing machine","kind":"washer","type":"use","priceDollars":3,"unit":"wash","rules":[{"whenKind":"after_hour","whenNumber":22,"whenDays":[],"doKind":"lock","priceDollars":null,"pricePercent":null,"reason":null,"depositDollars":null},{"whenKind":"after_hour","whenNumber":7,"whenDays":[],"doKind":"unlock","priceDollars":null,"pricePercent":null,"reason":null,"depositDollars":null},{"whenKind":"counter_at","whenNumber":50,"whenDays":[],"doKind":"propose_purchase","priceDollars":null,"pricePercent":null,"reason":"maintenance","depositDollars":null}]}

Example: {"model":"Cowboy 4","category":"ebike","capabilities":["lock","unlock","gps"]}
→ {"name":"E-bike","kind":"bike","type":"rent","priceDollars":3,"unit":"hour","rules":[{"whenKind":"overdue","whenNumber":1,"whenDays":[],"doKind":"notify","priceDollars":null,"pricePercent":null,"reason":"The e-bike is more than 1 hour late.","depositDollars":null},{"whenKind":"weekday","whenNumber":null,"whenDays":["sat","sun"],"doKind":"set_price","priceDollars":null,"pricePercent":20,"reason":null,"depositDollars":null}]}

Example: {"name":"Nespresso Vertuo","type":"coffee_machine","commands":["brew"],"sensors":["capsules_left"]}
→ {"name":"Coffee machine","kind":"coffee","type":"use","priceDollars":1,"unit":"coffee","rules":[{"whenKind":"stock_below","whenNumber":5,"whenDays":[],"doKind":"propose_purchase","priceDollars":null,"pricePercent":null,"reason":"capsules","depositDollars":null}]}
