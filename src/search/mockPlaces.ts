/**
 * Sample Malaysian places served ONLY while the Photon URL is a `.invalid` placeholder.
 * Coordinates are approximate and good enough to exercise search, routing and the map.
 */
import type { Place } from '../routing/routeTypes';

export const MOCK_PLACES: readonly Place[] = [
  { id: 'mock-klcc', name: 'Suria KLCC', subtitle: 'Kuala Lumpur City Centre, Kuala Lumpur', lng: 101.7117, lat: 3.1579 },
  { id: 'mock-sunway-pyramid', name: 'Sunway Pyramid', subtitle: 'Bandar Sunway, Subang Jaya, Selangor', lng: 101.6071, lat: 3.0728 },
  {
    id: 'mock-sunway-pyramid-parking',
    name: 'Sunway Pyramid Parking Entrance (Lower Ground)',
    subtitle: 'Persiaran Lagoon, Bandar Sunway, Selangor',
    lng: 101.6063,
    lat: 3.0721,
  },
  { id: 'mock-putrajaya-sentral', name: 'Putrajaya Sentral', subtitle: 'Presint 7, Putrajaya', lng: 101.6667, lat: 2.9317 },
  { id: 'mock-gua-musang', name: 'Gua Musang', subtitle: 'Gua Musang, Kelantan', lng: 101.9667, lat: 4.8833 },
  { id: 'mock-kl-sentral', name: 'KL Sentral', subtitle: 'Brickfields, Kuala Lumpur', lng: 101.6869, lat: 3.1343 },
  { id: 'mock-mid-valley', name: 'Mid Valley Megamall', subtitle: 'Lingkaran Syed Putra, Kuala Lumpur', lng: 101.6770, lat: 3.1177 },
  { id: 'mock-pavilion', name: 'Pavilion Kuala Lumpur', subtitle: 'Bukit Bintang, Kuala Lumpur', lng: 101.7135, lat: 3.1490 },
  { id: 'mock-kampung-baru', name: 'Kampung Baru', subtitle: 'Mukim Kuala Lumpur, Kuala Lumpur', lng: 101.7060, lat: 3.1660 },
  { id: 'mock-kuala-lipis', name: 'Kuala Lipis', subtitle: 'Mukim Kuala Lipis, Pahang', lng: 102.0500, lat: 4.1850 },
  { id: 'mock-kampung-raja', name: 'Kampung Raja', subtitle: 'Mukim Ringlet, Cameron Highlands, Pahang', lng: 101.4000, lat: 4.5300 },
  { id: 'mock-pekan', name: 'Pekan', subtitle: 'Mukim Pekan, Pahang', lng: 103.3900, lat: 3.4938 },
  { id: 'mock-kk-airport', name: 'Kota Kinabalu International Airport', subtitle: 'Kota Kinabalu, Sabah', lng: 116.0510, lat: 5.9372 },
  { id: 'mock-kuching-sentral', name: 'Kuching Sentral', subtitle: 'Kota Samarahan Road, Kuching, Sarawak', lng: 110.3790, lat: 1.4960 },
];

/** Case-insensitive; every word in the query must appear in the name or subtitle. */
export function searchMockPlaces(query: string, limit = 8): Place[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return MOCK_PLACES.filter((place) => {
    const haystack = `${place.name} ${place.subtitle}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  }).slice(0, limit);
}
