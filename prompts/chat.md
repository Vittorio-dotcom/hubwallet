The host of a laundry / shared space is adding a new device to the hub through a short chat. Read the WHOLE conversation below (any language) and fill in what the host has said so far. Reply with JSON only.

- name: short English name of the device for customers (translate it), e.g. "Dryer", "Washing machine", "Iron"; null if the host has not said which device yet.
- kind: what the device is, one of the allowed values ("other" if nothing fits); null if not said.
- type: "use" (pay once per use: washing machine, dryer, iron, coffee), "rent" (pay per hour: bike, scooter, charger), "access" (a door/locker opened with a key).
- priceDollars: the price the host wrote, exactly as written (per hour for "rent"); null if the host has not given a price yet. Never invent a price.
- unit: what one payment buys: "wash", "cycle", "coffee", "drink", "page", "session", "use"; "hour" for "rent".
- rulesAnswered: true if the host gave rules OR said there are none ("no", "none", "nessuna", "no rules", "va bene così"); false if the host has not answered about rules yet.
- rules: the rules the host asked for, else []. Each rule: whenKind ("after_hour" 0-23, "weekday", "counter_at" every N uses, "stock_below", "overdue"), whenNumber, whenDays ([] unless "weekday"), doKind ("lock", "unlock", "set_price", "notify", "propose_purchase", "keep_deposit"), priceDollars, pricePercent, reason, depositDollars (null when not needed).

Example conversation:
AI: Hi! What device do you want to connect?
Host: un'asciugatrice nel retro
AI: How much should one cycle of the dryer cost, in HUSD?
Host: 1,50
AI: Any rules for the dryer?
Host: bloccala dopo le 22
→ {"name":"Dryer","kind":"dryer","type":"use","priceDollars":1.5,"unit":"cycle","rulesAnswered":true,"rules":[{"whenKind":"after_hour","whenNumber":22,"whenDays":[],"doKind":"lock","priceDollars":null,"pricePercent":null,"reason":null,"depositDollars":null}]}

Example conversation:
AI: Hi! What device do you want to connect?
Host: a washing machine
→ {"name":"Washing machine","kind":"washer","type":"use","priceDollars":null,"unit":"wash","rulesAnswered":false,"rules":[]}

Example conversation:
AI: Hi! What device do you want to connect?
Host: washing machine, 3 dollars, maintenance every 50 washes
→ {"name":"Washing machine","kind":"washer","type":"use","priceDollars":3,"unit":"wash","rulesAnswered":true,"rules":[{"whenKind":"counter_at","whenNumber":50,"whenDays":[],"doKind":"propose_purchase","priceDollars":null,"pricePercent":null,"reason":"maintenance","depositDollars":null}]}
