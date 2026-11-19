# Navigation HUD, lane guidance and map-matching (Prompt 3)

Turn-by-turn guidance that keeps working with no mobile signal. Start it from **Start navigation** in the route sheet or **Start** on the route chip. A drive in progress resumes automatically on a cold launch.

## Pieces

| File | Job |
| --- | --- |
| `src/schemas/valhallaSchema.ts` | zod schema for `/route` (`trip.legs[].maneuvers[]`): `instruction`, `length` (km), `time` (s), `type`, `street_names`, `begin/end_shape_index`, optional `lanes`, `sign.exit_number_elements`, `sign.exit_branch_elements`. Text is stripped of HTML and control characters. |
| `src/utils/mapMatcher.ts` | Snaps GPS onto the route polyline (below). Pure and unit-tested. |
| `src/navigation/guidance.ts` | Progress (next maneuver, distance, ETA, tolls ahead) and the HUD view-model. |
| `src/navigation/roadSign.ts` | Decides green (expressway) or blue (federal/municipal) banner. |
| `src/navigation/useNavigation.ts` | GPS listener, matcher, dead reckoning, off-route re-route, session save. |
| `src/components/NavigationHUD.tsx` | The overlay. |

## HUD

- **Banner:** green `#006B3F` when the road names or route refs look like an expressway (PLUS, LDP, KESAS, MEX, DUKE, AKLEH, `E` routes), royal blue `#003DA5` otherwise. Shows the maneuver arrow, a distance countdown, the road ref badge, the next street, an exit badge such as `EXIT 1107`, and "toward" text.
- **Lane row:** one cell per lane with left, through, right, slight-left and slight-right arrows. Active lanes are bright cyan `#00E5FF`; others are dimmed.
- **Bottom bar:** arrival time, remaining distance, tolls still ahead (from `malaysiaTolls.json`, so plazas already passed are not counted) and a 64dp **End Route** button.

**Lane data is not guaranteed.** The real `valhalla1.openstreetmap.de` responses for Malaysian routes (see `__tests__/fixtures/valhalla-klcc-seremban.json`) contain no `lanes`, because OpenStreetMap lane tagging is sparse here. The lane row only appears when Valhalla sends lanes (the parser accepts string arrays and bitmasks); demo mode includes sample lanes so you can see it.

## Map matching

The matcher never snaps to the road network. It only snaps to the **active route**, so a parallel flyover, service road or opposite carriageway cannot capture the puck.

1. Perpendicular projection onto route segments, searching only from the current maneuver to the next one (a wider forward search only to re-acquire after a gap).
2. A segment is accepted only if the device heading is within **±35°** of the segment bearing. This is skipped when speed is under 2.5 m/s or the phone gives no heading, since heading is then noise.
3. Progress along the route only moves **forward**.
4. More than **60 m** off the route for more than **5 s** gives status `reroute`: a background Valhalla request from the current position for the profile being driven, at most one every 20 s. If it fails (no signal) the saved route keeps guiding.

## Offline behaviour

- The route, its maneuvers and lanes are in MMKV from the moment they arrive (`tuju.route.active.v1`), so guidance needs no network.
- GPS itself needs no mobile data. If fixes stop for 3 s (tunnel), the HUD keeps advancing along the route at the last known speed for up to 2 minutes, and shows "GPS signal lost". After that it stops guessing and waits for a fix.
- Progress is saved every 3 s (`tuju.nav.session.v1`) and restored after a restart.

## Limits

- Not tested on a real device or in a real tunnel yet. Run the checklist below on a drive.
- The screen is not kept awake and there is no voice guidance. Both are better added as their own step.
- Dead reckoning assumes the last speed; it cannot know about a stop inside a tunnel.

## Manual checklist

1. Plan a route with the public servers, tap **Start navigation**. Allow location.
2. The green or blue banner, distance and street update as you move. The camera follows, heading-up.
3. Drive past a flyover or parallel road: the puck stays on your carriageway.
4. Turn on airplane mode mid-drive: guidance continues. Kill GPS (indoors): "GPS signal lost" appears and the countdown keeps moving.
5. Leave the route for over 5 s: "Off route. Re-routing…" appears. In airplane mode it says it is following the saved route.
6. Force-close and relaunch mid-drive: navigation resumes. **End Route** clears everything.
