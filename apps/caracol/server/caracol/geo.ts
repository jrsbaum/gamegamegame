const EARTH_RADIUS_KM = 6_371;

export interface GeoPoint {
  lat: number;
  lon: number;
}

export function distanceKm(from: GeoPoint, to: GeoPoint): number {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const deltaLat = ((to.lat - from.lat) * Math.PI) / 180;
  const deltaLon = ((to.lon - from.lon) * Math.PI) / 180;
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

/**
 * Moves on the great-circle arc between two coordinates. For the game map
 * this is a visual straight route: there are no road or traffic calculations.
 */
export function moveTowards(from: GeoPoint, to: GeoPoint, distanceToMoveKm: number): GeoPoint {
  const totalDistance = distanceKm(from, to);
  if (totalDistance <= 0 || distanceToMoveKm >= totalDistance) return { ...to };
  const fraction = Math.max(0, Math.min(1, distanceToMoveKm / totalDistance));
  return {
    lat: from.lat + (to.lat - from.lat) * fraction,
    lon: from.lon + (to.lon - from.lon) * fraction,
  };
}
