# TUJU 2.0

Guest-first Malaysia driving navigator (Expo + TypeScript + MapLibre). Project rules live in `.cursorrules` / `CLAUDE.md`.

Current scope:

- Step 1: full-screen offline-first map and a **Regional Offline Packs** drawer. Details, config and test checklist: [docs/offline-maps.md](docs/offline-maps.md).
- Step 4: "Along Your Route" strip on the HUD: exact km to the next 3 R&Rs, petrol stations (brand badges), EV chargers and flood/landslide alerts, with one-tap stops that keep your destination. See [docs/along-your-route.md](docs/along-your-route.md).
- Step 3: turn-by-turn Navigation HUD (Malaysian road-sign banner, lane row, tolls ahead), route-only map matching that ignores flyovers and parallel roads, and guidance that survives dead zones. Defaults now use free public OpenFreeMap, Valhalla and Photon servers (dev only). See [docs/navigation.md](docs/navigation.md).
- Step 2: destination search (Photon), three route options (Valhalla), an offline RM toll estimate, and a route that survives offline restarts. Works with built-in demo data until real endpoints are set. See [docs/route-planner.md](docs/route-planner.md).

## Run it

MapLibre and MMKV are native modules, so **Expo Go will not work**. You need a development build.

```bash
npm install
cp .env.example .env        # optional, see docs/offline-maps.md

# Android emulator or USB phone (needs Android Studio / SDK)
npm run android

# iOS simulator or phone (macOS + Xcode only)
npm run ios

# afterwards, JS-only changes just need the dev server
npm start
```

No Mac or local SDK: `npx eas-cli build --profile development --platform android` (or `ios`) builds a dev client in the cloud; install it, then run `npm start` and open the app.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Jest tests for pack manager, config validation, style resolver |
