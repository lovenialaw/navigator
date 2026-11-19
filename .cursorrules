# TUJU 2.0 Mobile App Rules
- FRAMEWORK: React Native (Expo SDK 52+) with TypeScript. Strict mode enabled.
- MAP ENGINE: Use ONLY `@maplibre/maplibre-react-native` with local/CDN `.pmtiles` vector archives. NEVER install `react-native-maps`, Google Maps SDK, or commercial Mapbox SDKs.
- ROUTING: Query our self-hosted Valhalla REST endpoint (`/route`). Cache active route polylines and turn-by-turn steps in local storage (`react-native-mmkv`) immediately upon fetch so navigation survives 100% offline dead zones.
- UI & SAFETY: Never render raw HTML or unvalidated strings. Validate all API JSON responses using `zod`. Follow a high-contrast, dark-mode-ready dashboard UI with large touch targets (minimum 48x48dp) for driving safety.
- GUEST-FIRST: Map browsing and turn-by-turn navigation must work immediately on cold launch without requiring login or hitting an auth database.
