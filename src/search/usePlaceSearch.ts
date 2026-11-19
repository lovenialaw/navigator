import { useCallback, useEffect, useState } from 'react';

import type { Place } from '../routing/routeTypes';
import { MIN_QUERY_LENGTH, searchPlaces } from './photonClient';

const DEBOUNCE_MS = 300;

interface Options {
  baseUrl: string;
  focus?: { lng: number; lat: number };
}

export interface PlaceSearchState {
  query: string;
  setQuery: (value: string) => void;
  places: Place[];
  loading: boolean;
  error: string | null;
  mock: boolean;
  /** True once a search for the current query has finished (distinguishes "no matches" from "not searched yet"). */
  settled: boolean;
  reset: () => void;
}

/** Debounced destination search. Only the latest query's result is ever shown. */
export function usePlaceSearch({ baseUrl, focus }: Options): PlaceSearchState {
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mock, setMock] = useState(false);
  const [settled, setSettled] = useState(false);

  const focusLng = focus?.lng;
  const focusLat = focus?.lat;

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setPlaces([]);
      setLoading(false);
      setError(null);
      setSettled(false);
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);
    setSettled(false);
    const timer = setTimeout(() => {
      searchPlaces({
        query: trimmed,
        baseUrl,
        focus: focusLng !== undefined && focusLat !== undefined ? { lng: focusLng, lat: focusLat } : undefined,
        signal: controller.signal,
      })
        .then((result) => {
          if (controller.signal.aborted) return;
          setPlaces(result.places);
          setMock(result.mock);
          setError(null);
          setLoading(false);
          setSettled(true);
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted) return;
          setPlaces([]);
          setError(e instanceof Error ? e.message : 'Search failed');
          setLoading(false);
          setSettled(true);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, baseUrl, focusLng, focusLat]);

  const reset = useCallback(() => {
    setQuery('');
  }, []);

  return { query, setQuery, places, loading, error, mock, settled, reset };
}
