The host of a laundry / shared space wants to change ONE device. The current device is described below. Read the host's sentence (any language) and return ONLY the changes. Reply with JSON only.

- newName: the new name if the host renames the device, else null.
- newPriceDollars: the new price if the host writes it (e.g. "2.50", "3 dollars"), else null.
- pricePercent: if the host asks for a relative change of the price ("+10%", "10% off" = -10), else null.
- removeRules: the numbers of the current rules the host wants to remove (1 = first rule), else [].
- removeAllRules: true only if the host wants to remove every rule.
- askedPriceChange: true if the host wants to change the base price (even without saying how much, e.g. "raise the price"), else false.
- addRules: the new rules, else []. Each rule:
  - whenKind: "after_hour" (after a time of day, whenNumber 0-23; 10 pm = 22), "weekday" (whenDays, weekend = sat, sun), "counter_at" (every N uses, whenNumber = N), "stock_below" (fewer than N items), "overdue" (a rental is N hours late).
  - doKind: "lock", "unlock", "set_price" (priceDollars if written, or pricePercent), "notify" (reason = short message for the host), "propose_purchase" (reason = what for, e.g. "maintenance"), "keep_deposit".
  - every other field null, whenDays [] unless "weekday".
- addOptions: the SERVICES (options) the host adds to this machine, else []. A machine can sell several things, each with its own price:
  a coffee machine sells espresso, macchiato, cappuccino; a washing machine sells a 30° wash and a 60° wash. Each: name (short, e.g. "cappuccino", "30°"),
  priceDollars (as written), minutes (how long it runs, if written), fromHour/toHour (hours it is offered, if written, e.g. "only 7-11"), else null.
  "also / anche / add / aggiungi / with / con / oppure" + a product + a price = a new option, NOT a new price of the machine (newPriceDollars stays null).
- removeOptions: the names of the options the host removes ("togli il cappuccino" → ["cappuccino"]), else [].
A price for some days or hours only ("at the weekend it costs 4", "after 20:00 it costs 2.50") is a NEW RULE (weekday or after_hour → set_price), not newPriceDollars. "Free" = newPriceDollars 0.
Copy numbers exactly as written; never compute. Change nothing the host did not ask for.

Examples (device: Washing machine, price 3.00; current rules: 1. every 50 uses: propose a purchase (maintenance)):
"raise it to 3.50 and lock it after 22:00" → {"newName":null,"newPriceDollars":3.5,"pricePercent":null,"removeRules":[],"removeAllRules":false,"addRules":[{"whenKind":"after_hour","whenNumber":22,"whenDays":[],"doKind":"lock","priceDollars":null,"pricePercent":null,"reason":null,"depositDollars":null}],"askedPriceChange":true,"addOptions":[],"removeOptions":[]}
"togli la regola della manutenzione" → {"newName":null,"newPriceDollars":null,"pricePercent":null,"removeRules":[1],"removeAllRules":false,"addRules":[],"askedPriceChange":true,"addOptions":[],"removeOptions":[]}
"nel weekend costa il 20% in più" → {"newName":null,"newPriceDollars":null,"pricePercent":null,"removeRules":[],"removeAllRules":false,"addRules":[{"whenKind":"weekday","whenNumber":null,"whenDays":["sat","sun"],"doKind":"set_price","priceDollars":null,"pricePercent":20,"reason":null,"depositDollars":null}],"askedPriceChange":true,"addOptions":[],"removeOptions":[]}
"sconto del 10%" → {"newName":null,"newPriceDollars":null,"pricePercent":-10,"removeRules":[],"removeAllRules":false,"addRules":[],"askedPriceChange":true,"addOptions":[],"removeOptions":[]}
"riaprila alle 7 e avvisami ogni 100 lavaggi" → {"newName":null,"newPriceDollars":null,"pricePercent":null,"removeRules":[],"removeAllRules":false,"addRules":[{"whenKind":"after_hour","whenNumber":7,"whenDays":[],"doKind":"unlock","priceDollars":null,"pricePercent":null,"reason":null,"depositDollars":null},{"whenKind":"counter_at","whenNumber":100,"whenDays":[],"doKind":"notify","priceDollars":null,"pricePercent":null,"reason":"100 washes reached","depositDollars":null}],"askedPriceChange":true,"addOptions":[],"removeOptions":[]}
"nel weekend costa 4 dollari" → {"newName":null,"newPriceDollars":null,"pricePercent":null,"removeRules":[],"removeAllRules":false,"addRules":[{"whenKind":"weekday","whenNumber":null,"whenDays":["sat","sun"],"doKind":"set_price","priceDollars":4,"pricePercent":null,"reason":null,"depositDollars":null}],"askedPriceChange":true,"addOptions":[],"removeOptions":[]}
"make it free" → {"newName":null,"newPriceDollars":0,"pricePercent":null,"removeRules":[],"removeAllRules":false,"addRules":[],"askedPriceChange":true,"addOptions":[],"removeOptions":[]}
"alza il prezzo" → {"newName":null,"newPriceDollars":null,"pricePercent":null,"removeRules":[],"removeAllRules":false,"addRules":[],"askedPriceChange":true,"addOptions":[],"removeOptions":[]}
"dopo le 20 costa 2,50" → {"newName":null,"newPriceDollars":null,"pricePercent":null,"removeRules":[],"removeAllRules":false,"addRules":[{"whenKind":"after_hour","whenNumber":20,"whenDays":[],"doKind":"set_price","priceDollars":2.5,"pricePercent":null,"reason":null,"depositDollars":null}],"askedPriceChange":false,"addOptions":[],"removeOptions":[]}
"voglio anche il cappuccino a 2 euro e il macchiato a 1,40" → {"newName":null,"newPriceDollars":null,"pricePercent":null,"removeRules":[],"removeAllRules":false,"addRules":[],"askedPriceChange":false,"addOptions":[{"name":"cappuccino","priceDollars":2,"minutes":null,"fromHour":null,"toHour":null},{"name":"macchiato","priceDollars":1.4,"minutes":null,"fromHour":null,"toHour":null}],"removeOptions":[]}
"add a 60 degree wash for 3.50 that takes 90 minutes, only from 8 to 20" → {"newName":null,"newPriceDollars":null,"pricePercent":null,"removeRules":[],"removeAllRules":false,"addRules":[],"askedPriceChange":false,"addOptions":[{"name":"60°","priceDollars":3.5,"minutes":90,"fromHour":8,"toHour":20}],"removeOptions":[]}
"togli il cappuccino" → {"newName":null,"newPriceDollars":null,"pricePercent":null,"removeRules":[],"removeAllRules":false,"addRules":[],"askedPriceChange":false,"addOptions":[],"removeOptions":["cappuccino"]}
