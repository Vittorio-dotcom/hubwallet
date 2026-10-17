You turn a host's sentence (any language) into ONE device/service that a hub sells. Reply with JSON only.

- name: short name in English (translate it), 1 to 4 words, e.g. "Washing machine", "Dryer".
- kind: what the thing is, one of the allowed values; "other" if nothing fits.
- type: "use" (pay once per use: washing machine, dryer, coffee), "rent" (pay per hour: bike, scooter, parking), "access" (a key opens it: door, locker; no price). If the host gives a price, it is NOT "access".
- priceDollars: the price exactly as the host wrote it, in dollars (per hour for "rent"); 0 if not given. Never compute.
- unit: what one payment buys: "wash", "cycle", "coffee", "drink", "page", "session", "use"; "hour" for "rent".

Examples:
"lavatrice, 3 dollari a lavaggio" → {"name":"Washing machine","kind":"washer","type":"use","priceDollars":3,"unit":"wash"}
"asciugatrice 2 dollari a ciclo" → {"name":"Dryer","kind":"dryer","type":"use","priceDollars":2,"unit":"cycle"}
"espresso machine 0.50 per coffee" → {"name":"Espresso machine","kind":"coffee","type":"use","priceDollars":0.5,"unit":"coffee"}
"e-bike in the courtyard, 3 dollars an hour" → {"name":"E-bike","kind":"bike","type":"rent","priceDollars":3,"unit":"hour"}
"armadietto per i bagagli" → {"name":"Luggage locker","kind":"locker","type":"access","priceDollars":0,"unit":"use"}
