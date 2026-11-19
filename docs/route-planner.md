# Route planner (Prompt 2)

Destination search (Photon), up to three route alternatives (Valhalla), a bottom comparison sheet with an offline RM toll estimate, and the chosen route cached in MMKV.

## Endpoints

All config lives in `src/config/tujuConfig.ts` (not a separate `mapConfig.ts`), next to the `.pmtiles` URLs. Since Prompt 3 the defaults are free public servers, so real data works with no setup:

| Env var | Default | Used for |
| --- | --- | --- |
| `EXPO_PUBLIC_TUJU_STYLE_URL` | `https://tiles.openfreemap.org/styles/liberty` | Map style |
| `EXPO_PUBLIC_TUJU_VALHALLA_URL` | `https://valhalla1.openstreetmap.de` | `POST <base>/route` |
| `EXPO_PUBLIC_TUJU_PHOTON_URL` | `https://photon.komoot.io` | `GET <base>/api?q=...` (a trailing `/api` is accepted and stripped) |

Every Photon query carries `lat=3.0733&lon=101.6067` (Klang Valley) plus a Malaysia `bbox`, so results lean towards Malaysia. If the user has a GPS fix, the search focuses on that instead.

**These public servers are for development only.** They have fair-use limits, no uptime promise, and receive the user's search text and GPS-derived route endpoints (a privacy cost). The app limits its load by debouncing search, caching every Valhalla response in MMKV (rounded coordinates, 6 h TTL, 24 entries, and a stale copy is used when the phone is offline), and requesting only the driven profile when re-routing. Before a public release, self-host both and set the env vars. Keep the OpenStreetMap, OpenFreeMap and Photon attributions visible.

Restart Metro with `npm start -- --clear` after changing `.env`.

## Demo (mock) mode

Set either URL to an RFC 2606 `.invalid` host (for example `EXPO_PUBLIC_TUJU_VALHALLA_URL=https://valhalla.tuju.invalid`) and the matching service returns built-in sample data and makes **no network call**; a yellow "Demo data" chip shows on the map. Demo routes include sample lane data, which the real Malaysian Valhalla data lacks (see [navigation.md](navigation.md)).

- **Places:** Suria KLCC, Sunway Pyramid (and its parking entrance), Putrajaya Sentral, Gua Musang, KL Sentral, Mid Valley, Pavilion KL, Kampung Baru, Kuala Lipis, Pekan, Kota Kinabalu airport, Kuching Sentral. Try typing `klcc`, `sunway`, `putrajaya`, `gua musang`.
- **Routes inside the Klang Valley:** Fastest goes through the four LDP plazas, Trunk roads through the three MEX plazas, No tolls follows a toll-free corridor with sample flood and unpaved warnings. Elsewhere they are straight-ish lines and are priced like any real route.
- Sample route lines are straight segments between waypoints, not real roads.

## How routes are priced

`src/utils/tollCalculator.ts` reads `src/data/malaysiaTolls.json` (validated with zod) and prices the route polyline offline. Rates are **placeholders**, so amounts are always labelled "est." See the header of the calculator for the open/closed system rules.

**KESAS Awan Besar:** each plaza has a `chargeDirection` (East ≈ 090°, West ≈ 270°, ±75°). The calculator reads the route's travel bearing at the plaza and only charges the one matching the direction of travel, so a through trip pays one plaza (RM 2.00), not both (RM 4.00). Check which plaza is really charged each way against the real tariff before shipping; the coordinates in the starter data put the "West" plaza east of the "East" plaza.

## Persistence

`src/routing/routeStore.ts` writes to MMKV the moment routes arrive (candidates plus the active route) and again on every selection. On a cold launch the saved route is validated with zod, drawn on the map and shown in a "Routes / Clear" chip, with no network. Corrupt or outdated data is dropped, not crashed on.

## Valhalla request

One request per profile, sent in parallel:

| Profile | `costing_options.auto` |
| --- | --- |
| `fastest` | `use_highways: 1, use_tolls: 1` |
| `avoid_tolls` | `use_tolls: 0` |
| `trunk_roads` | `use_highways: 0, use_tolls: 0, use_trunk: 1` |

Identical results are merged into one card ("Also the no tolls route"). `use_trunk` needs Valhalla 3.5+; older versions ignore it, which makes `trunk_roads` behave like `avoid_tolls` plus fewer motorways.

## Known gaps

- Valhalla's `/route` response has no road-surface data, so real unpaved or flood warnings are not available yet; only the mock supplies them. Real surface data needs a `trace_attributes` call, and flood alerts come with Prompt 4's feed.
- The start point is the device location (asks permission only when you pick a destination) and falls back to KLCC when denied.

## Manual test checklist (no backend needed)

0. For demo data, set both URLs to `.invalid` hosts in `.env` first (the defaults are the live public servers).
1. Launch the dev build: map shows, a "Demo data" chip is visible, no login prompt.
2. Type `sunway`: sample places appear, rows are large and tappable.
3. Tap **Sunway Pyramid**: location prompt appears once; sheet shows three cards (LDP route with an RM est., MEX route with an RM est., a No tolls route with two warnings).
4. Tap each card: the cyan line on the map changes. Tap **Start navigation** to drive it (see [navigation.md](navigation.md)).
5. Force-close the app, turn on airplane mode, relaunch: the route line and the "To Sunway Pyramid" chip are still there.
6. **Clear** removes the line and the saved route.
