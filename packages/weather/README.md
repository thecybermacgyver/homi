# Homi Weather

Weather is a first-party Homi module: the weather where you are, and for places you save.

## Household behavior

- **Each member's places are their own.** Saved places and the settings below belong to the member who made them; other members of the household never see them, and they follow that member to their other devices.
- **Current card.** Shows the weather where this device is. The device's own position is used when the device can give one and the member allows it in their browser; it is kept on the device and sent to Homi's server only as coordinates rounded to about a kilometre. When the device cannot (no GPS or location service, a timeout, or the member said no), the card shows an estimate of the nearest city from the internet connection, labelled "Approximate location", and the Weather page offers "Use precise location". The estimate is city level at best and can name a nearby city.
- **Place cards.** Up to five saved places can each have their own Dashboard card (Place 1 to Place 5). On the Weather page a member chooses which saved place each card shows. Show, hide, order and resize every card in Settings, Manage modules, like any other card.
- **Bare, scaling cards.** The Dashboard draws no box or title around the cards (it draws none for any card now). The six cards declare `"fit": "scale"`: each is drawn at one natural size and Homi scales it to whatever size the member gives the card, from half a cell to the whole board, so the icon, the temperature and the words always grow and shrink together and nothing ever spills out of the card. A small card shows the essentials; a larger one adds the "See full forecast" button, then the high and low, wind and humidity, the next hours and the next days.
- **A card looks like the weather.** The colours and the illustration change with the conditions (clear day or night, cloudy, rain, storm, snow, fog). A card shows the temperature, the chance of precipitation, the conditions and the place, and "See full forecast" opens the full forecast for that place on weather.com, yr.no or Windy (each member chooses). Taller cards add the high and low, wind, humidity, the next hours and the next days.
- **Celsius or Fahrenheit.** The Weather page has a °C / °F switch (wind follows: km/h or mph). A member who has not chosen gets Fahrenheit only if their language is US English.
- **Offline.** The last forecast for every card is kept on the device and shown with how old it is. Searching for a new place needs a connection.

## Outside services

Homi's pages are not allowed to contact other websites, so the Homi server asks on their behalf. Only three fixed addresses are ever contacted, and only coordinates rounded to two decimals, or a place name typed into the search box, are sent:

| Service | Used for |
|---|---|
| Open-Meteo (`api.open-meteo.com`) | the forecast |
| Open-Meteo geocoding (`geocoding-api.open-meteo.com`) | finding a place by name when adding one |
| OpenStreetMap Nominatim (`nominatim.openstreetmap.org`) | naming the Current card's place, down to the local community (for example "Scarborough, Toronto") |
| geojs.io (`get.geojs.io`), with ipwho.is (`ipwho.is`) as a backup | the approximate location when the device cannot give a precise one |

The approximate location is the one exception to "only coordinates or a typed place name are sent": the server sends the visitor's public internet address (not coordinates) to geojs.io (or to ipwho.is if that fails), or asks about the household's own connection when the visitor is on the home network. Nothing is stored beyond a 30-minute cache in the server's memory.

Forecasts are kept in the server's memory for 10 minutes and place names for 30 days, so many cards and devices cost few requests. Each member is limited to 60 weather requests a minute.

## Location permission

Homi's web server header `Permissions-Policy` now allows location for Homi itself (`geolocation=(self)`; it was switched off for everything before). A device still asks its member before sharing, and "Use my location" on the Current card asks again if they declined.

## Data

`mod_weather.places` (one row per saved place, with the owning member) and `mod_weather.preferences` (one row per member). Every read is filtered by the requesting member on the server; the change feed names only an id.

## Validation

```bash
pnpm build               # type-checks, bundles, and checks every card look keeps text at 4.5:1
pnpm contract:validate   # manifest and public-API isolation
pnpm server:validate     # parsing, input checks, caching, rate limit and the location estimate against recorded real answers
node qa/browser-location.mjs # the Current card in Chrome: no GPS, refused, not asked yet, precise wins, estimate down
node qa/browser-sizes.mjs    # the card at 16 sizes on a monitor and a phone: fills its box, nothing cut off, text grows (needs `pnpm --filter @homi/web build`)
pnpm imports:validate    # no browser file imports a bare name such as "react" (also runs in the build)
node qa/browser-load.mjs # loads the built module in Chrome with Homi's own runtime (needs `pnpm --filter @homi/web build`)
```
