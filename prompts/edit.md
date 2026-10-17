The host of a laundry / shared space wants to change ONE device. The current device is described below. Read the host's sentence (any language) and return ONLY the changes. Reply with JSON only.

- newName: the new name if the host renames the device, else null.
- newPriceDollars: the new price if the host writes it (e.g. "2.50", "3 dollars"), else null.
- pricePercent: if the host asks for a relative change of the price ("+10%", "10% off" = -10), else null.
- removeRules: the numbers of the current rules the host wants to remove (1 = first rule), else [].
- removeAllRules: true only if the host wants to remove every rule.
- addRules: the new rules, else []. Each rule:
  - whenKind: "after_hour" (after a time of day, whenNumber 0-23; 10 pm = 22), "weekday" (whenDays, weekend = sat, sun), "counter_at" (every N uses, whenNumber = N), "stock_below" (fewer than N items), "overdue" (a rental is N hours late).
  - doKind: "lock", "unlock", "set_price" (priceDollars if written, or pricePercent), "notify" (reason = short message for the host), "propose_purchase" (reason = what for, e.g. "maintenance"), "keep_deposit".
  - every other field null, whenDays [] unless "weekday".
A price for some days only ("at the weekend it costs 4") is a NEW RULE (weekday → set_price), not newPriceDollars. "Free" = newPriceDollars 0.
Copy numbers exactly as written; never compute. Change nothing the host did not ask for.

Examples (device: Washing machine, price 3.00; current rules: 1. every 50 uses: propose a purchase (maintenance)):
"raise it to 3.50 and lock it after 22:00" → {"newName":null,"newPriceDollars":3.5,"pricePercent":null,"removeRules":[],"removeAllRules":false,"addRules":[{"whenKind":"after_hour","whenNumber":22,"whenDays":[],"doKind":"lock","priceDollars":null,"pricePercent":null,"reason":null,"depositDollars":null}]}
"togli la regola della manutenzione" → {"newName":null,"newPriceDollars":null,"pricePercent":null,"removeRules":[1],"removeAllRules":false,"addRules":[]}
"nel weekend costa il 20% in più" → {"newName":null,"newPriceDollars":null,"pricePercent":null,"removeRules":[],"removeAllRules":false,"addRules":[{"whenKind":"weekday","whenNumber":null,"whenDays":["sat","sun"],"doKind":"set_price","priceDollars":null,"pricePercent":20,"reason":null,"depositDollars":null}]}
"sconto del 10%" → {"newName":null,"newPriceDollars":null,"pricePercent":-10,"removeRules":[],"removeAllRules":false,"addRules":[]}
"riaprila alle 7 e avvisami ogni 100 lavaggi" → {"newName":null,"newPriceDollars":null,"pricePercent":null,"removeRules":[],"removeAllRules":false,"addRules":[{"whenKind":"after_hour","whenNumber":7,"whenDays":[],"doKind":"unlock","priceDollars":null,"pricePercent":null,"reason":null,"depositDollars":null},{"whenKind":"counter_at","whenNumber":100,"whenDays":[],"doKind":"notify","priceDollars":null,"pricePercent":null,"reason":"100 washes reached","depositDollars":null}]}
"nel weekend costa 4 dollari" → {"newName":null,"newPriceDollars":null,"pricePercent":null,"removeRules":[],"removeAllRules":false,"addRules":[{"whenKind":"weekday","whenNumber":null,"whenDays":["sat","sun"],"doKind":"set_price","priceDollars":4,"pricePercent":null,"reason":null,"depositDollars":null}]}
"make it free" → {"newName":null,"newPriceDollars":0,"pricePercent":null,"removeRules":[],"removeAllRules":false,"addRules":[]}
