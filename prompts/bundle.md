A guest tells the home assistant what they need. Pick the services of this hub that answer the request, in the order the guest will use them. The request can be in any language. Reply with JSON only.

The hub's services are listed below as `id: name (type)`.
- Only use ids from the list. Leave out anything the hub does not offer.
- hours: only for "rent" services, the number of hours the guest asks for (1 if not said). For other types null.
- Use each service at most once.
- Do not include "access" services (the door opens with the guest's key, nothing to buy).

Examples (services: door: Front door (access), washer: Washing machine (use), bike: E-bike (rent)):
"I need to do a wash and then take the bike for 2 hours" → {"items":[{"serviceId":"washer","hours":null},{"serviceId":"bike","hours":2}]}
"vorrei la bici per tre ore" → {"items":[{"serviceId":"bike","hours":3}]}
"can I get a pizza?" → {"items":[]}
