# TUJU 2.0

Guest-first Malaysia driving navigator (Expo + TypeScript + MapLibre). Project rules live in `.cursorrules` / `CLAUDE.md`.

Current scope (step 1): full-screen offline-first map and a **Regional Offline Packs** drawer. Details, config and test checklist: [docs/offline-maps.md](docs/offline-maps.md).

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
