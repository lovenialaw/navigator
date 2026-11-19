import { z } from 'zod';

import type { KeyValueStore } from '../storage/keyValueStore';

export const NAV_SESSION_KEY = 'tuju.nav.session.v1';

const sessionSchema = z.object({
  routeId: z.string().min(1),
  startedAt: z.number().int().nonnegative(),
  /** Metres driven along the route when last saved. */
  alongM: z.number().nonnegative(),
});
export type NavSession = z.infer<typeof sessionSchema>;

/**
 * Remembers that a drive is in progress and how far along it is, so a killed app or a
 * phone restart resumes guidance on the cached route with no network and no login.
 */
export function saveNavSession(store: KeyValueStore, session: NavSession): void {
  store.set(NAV_SESSION_KEY, JSON.stringify(session));
}

export function loadNavSession(store: KeyValueStore): NavSession | null {
  const raw = store.getString(NAV_SESSION_KEY);
  if (!raw) return null;
  try {
    return sessionSchema.parse(JSON.parse(raw));
  } catch {
    store.remove(NAV_SESSION_KEY);
    return null;
  }
}

export function clearNavSession(store: KeyValueStore): void {
  store.remove(NAV_SESSION_KEY);
}
