# Along Your Route (Prompt 4)

A collapsible strip on the right of the navigation HUD. It shows the **exact distance in km** to the next three R&R rest areas, petrol stations, EV chargers, and active flood or landslide alerts. One tap on a stop adds it to the trip. The final destination never changes.

Open it with the **Along** tab on the right edge. If an alert is within 10 km, a red or amber `⚠ 4.2 km` chip shows even while the strip is collapsed.

## How to read it

Four tabs: **R&R**, **Fuel**, **EV**, **Alerts**. Each lists up to three rows. Nearest sits at the bottom, next to a "You" dot, and the farthest at the top, so the strip reads like the road ahead.

- Fuel rows have a brand badge: Petronas, Shell, Petron, Caltex, BHPetrol or a generic pump. These are coloured letter badges, **not company logos** (we don't ship or have the right to use them).
- Tap a row to add the stop. The row shows "Stop added" and a white-ringed dot appears on the map. Tap it again to remove it.
- At most 3 stops. The route is re-requested from your current position through the stops, **ending at the original destination**. Stops you have already passed are not sent back to.
- Alerts are information only; you can't add one as a stop.

## Where the data comes from

| Data | Source | Notes |
| --- | --- | --- |
| R&R, petrol, EV | OpenStreetMap via the public **Overpass API** (`EXPO_PUBLIC_TUJU_OVERPASS_URL`) | One request per route, only after you press Start, searching within 1.5 km of the route. Cached in MMKV (`tuju.poi.route.v1`) so it works offline afterwards. A re-route or added stop that stays on the same road reuses the cache and sends no request. |
| Flood / landslide alerts | A JSON feed you provide (`EXPO_PUBLIC_TUJU_ALERTS_URL`) | **No public JPS or LLM feed has been verified, so none is configured by default.** The Alerts tab says "No alert feed connected yet." Cached 15 minutes, last-known alerts shown offline. |
| Demo | Built in | If the Overpass URL is a `.invalid` host, "Sample ..." stops and two sample alerts are placed on the route. They are not real. |

Alert feed format (`{ "alerts": [...] }` or a bare array); each alert is validated alone and a bad one is dropped:

```json
{ "alerts": [{
  "id": "jps-123", "kind": "flood", "title": "Banjir Sungai Pahang",
  "severity": "danger", "source": "JPS",
  "lng": 102.4, "lat": 3.5, "radiusM": 3000, "expiresAt": 1800000000000
}] }
```

`kind` is `flood` or `landslide`; `severity` is `watch`, `warning` or `danger` (unknown values become `warning` so a hazard is never hidden); `source` is `JPS`, `LLM` or `other`; `radiusM` defaults to 2000 and is capped at 50 km. All text is stripped of HTML.

## Code map

| File | Job |
| --- | --- |
| `src/poi/overpassClient.ts` | Corridor query, response parsing (per-element zod), fetch |
| `src/poi/alongRoute.ts` | Projects POIs and alerts onto the route; "next three ahead" |
| `src/poi/poiStore.ts`, `src/alerts/alertFeed.ts` | MMKV caches |
| `src/poi/useRouteCompanion.ts` | Loads and caches data while navigating |
| `src/navigation/stops.ts`, `useNavigation.ts` | Add / remove a stop and re-route; re-routes keep unreached stops |
| `src/components/AlongRoutePanel.tsx` | The strip |

## Limits

- **Public Overpass is for development.** It has fair-use limits and sends your route's rough path to a third party. Self-host or use a mirror before release.
- **OpenStreetMap coverage varies.** Names, brands and R&Rs can be missing or wrong. Many expressway R&Rs are tagged once per direction, and the matcher can't tell which side is yours (it only requires them to be within 800 m of the route; fuel and EV within 1.5 km).
- **Distances are along the route to the closest point**, not including a detour off an exit.
- **Adding a stop needs a connection** (it asks the routing server). Offline, you get "Cannot add the stop right now" and keep your saved route.
- **Not tested on a real drive.**
