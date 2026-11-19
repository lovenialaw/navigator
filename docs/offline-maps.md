# Offline-first map and regional packs

## How it works

- `MapScreen` renders a full-screen MapLibre map on cold launch. No login, no auth database.
- With no pack selected, MapLibre is handed the hosted style URL directly and streams `malaysia.pmtiles` over HTTP range requests.
- **Offline Packs** drawer: download Klang Valley, Pahang / East Coast, Sabah or Sarawak `.pmtiles` extracts into the app document directory (`offline-packs/<id>.pmtiles`). Downloads go to a `.part` file, the first bytes are checked for the `PMTiles` magic number (so an HTML error page is never installed), then the file is moved into place.
- **Show on map** swaps the style's vector source for `pmtiles://file:///.../<id>.pmtiles`, so tiles come from the phone. The hosted style JSON is cached in MMKV on every successful fetch, so this also works with no signal.
- Installed packs, the active pack and the cached style live in `react-native-mmkv`; persisted JSON is zod-validated and reset if corrupt.

Code map: `src/config/tujuConfig.ts` (all URLs), `src/offline/packManager.ts` (download, validate, persist), `src/map/styleResolver.ts` (style swap and cache), `src/components/PackDrawer.tsx`, `src/screens/MapScreen.tsx`.

## Configuration (one module)

Everything configurable is in `src/config/tujuConfig.ts`. URLs ship as placeholders on the reserved `.invalid` host; the app still launches (blank dark map, and the drawer says "Download link not configured yet").

Override without code changes via Expo public env vars (`.env`, shell, or EAS profile `env`). See `.env.example`:

| Variable | Meaning |
| --- | --- |
| `EXPO_PUBLIC_TUJU_STYLE_URL` | MapLibre style JSON for the Malaysia archive |
| `EXPO_PUBLIC_TUJU_STYLE_SOURCE_ID` | Vector source id in that style that packs replace (default `malaysia`; falls back to the first vector source) |
| `EXPO_PUBLIC_TUJU_PACK_BASE_URL` | Folder hosting `klang-valley.pmtiles`, `pahang-east-coast.pmtiles`, `sabah.pmtiles`, `sarawak.pmtiles` |
| `EXPO_PUBLIC_TUJU_PACK_URL_<KLANG_VALLEY\|PAHANG_EAST_COAST\|SABAH\|SARAWAK>` | Full URL for a single pack (wins over base URL) |

Restart Metro with `npx expo start --dev-client --clear` after changing them. Invalid overrides (bad URL, non-http) are rejected by zod and the app falls back to defaults with an on-screen notice.

Pack requirements: each extract must use the **same tile schema/layers as `malaysia.pmtiles`** (the style's layers reference it), and the host must serve a plain `.pmtiles` file over HTTPS.

## Known limits (follow-ups)

- Glyphs and sprites referenced by the style are still fetched online. For truly zero-data labels, host them in a form MapLibre caches, or bundle them (not done yet).
- If a driver switches to an offline pack on a phone that has never fetched the style, there is nothing cached; the app shows "Could not load the map style". Bundling a copy of the final style in the app removes this.
- Only one pack can be shown at a time (one vector source). Overlapping regional extracts are not merged.
- Placeholder bounding boxes and `approxBytes` in the config are estimates; update them when real extracts exist.

## Run on a simulator or phone

Expo Go cannot run this app (native MapLibre + MMKV). Use a development build:

1. `npm install`
2. Android: `npm run android` (emulator or USB phone with debugging on). iOS: `npm run ios` (Mac + Xcode).
3. Or build a dev client in the cloud with `npx eas-cli build --profile development --platform android|ios`, install it, and run `npm start`.

## Manual test checklist (needs a device)

1. Cold launch with no account: map screen is the first screen, no login prompt.
2. With a real style URL set: the Malaysia map draws. With placeholders: blank dark map plus a "not configured" banner.
3. Offline Packs drawer opens; all buttons are comfortably tappable with a thumb (>= 48dp).
4. With real pack URLs: Download shows progress, Cancel works, a finished pack shows "On this phone".
5. Show on map: the camera flies to the region and the map keeps drawing after enabling airplane mode and force-quitting the app.
6. Delete a pack: file is removed, map returns to the online style.
7. System dark/light toggle changes the UI; text stays readable.
8. Confirm `pmtiles://file:///` local archives render on both Android and iOS (this is the main thing unit tests cannot cover).
