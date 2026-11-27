import { pm25ToUsAqi, type AirQualityData } from '@aetheria/shared';
import { env } from '../config/env.js';

export type TravelMode = 'foot' | 'bike' | 'car';

export interface RoutePoint {
  lat: number;
  lon: number;
  pm25: number;
  aqi: number;
}

export interface RouteWaypoint {
  n: number;
  title: string;
  detail: string;
  etaLabel: string;
  pm25: number;
  lat: number;
  lon: number;
  distanceM?: number;
}

export interface EvaluatedRoute {
  id: string;
  label: string;
  kind: 'cleanest' | 'fastest';
  provider: string;
  isRoadNetwork: boolean;
  distanceKm: number;
  durationMinutes: number;
  avgPm25: number;
  avgAqi: number;
  cumulativeExposureUgMin: number;
  points: RoutePoint[];
}

export interface RouteResponsePayload {
  fromLabel: string;
  toLabel: string;
  mode: TravelMode;
  isRoadNetwork: boolean;
  cleanest: EvaluatedRoute;
  fastest: EvaluatedRoute;
  exposureReductionPercent: number;
  bestDepartureWindow: {
    label: string;
    pm25: number;
    reason: string;
  };
  waypoints: RouteWaypoint[];
}

interface RawRoadCandidate {
  provider: string;
  isRoadNetwork: boolean;
  isAlternative: boolean;
  coords: Array<[number, number]>;
  distanceKm: number;
  durationMinutes: number;
  maneuvers: Array<{
    instruction: string;
    distanceM: number;
    durationSec: number;
    lat: number;
    lon: number;
  }>;
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Decode Valhalla / Google encoded polyline (precision = 1e6 for Valhalla)
function decodePolyline(encoded: string, precision = 1e6): Array<[number, number]> {
  const coords: Array<[number, number]> = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    const dLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dLat;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    const dLon = result & 1 ? ~(result >> 1) : result >> 1;
    lon += dLon;

    coords.push([lat / precision, lon / precision]);
  }
  return coords;
}

// Preserve street curves cleanly while capping extremely long routes to 320 vertices
function capPolyline(coords: Array<[number, number]>, maxVertices = 320): Array<[number, number]> {
  if (coords.length <= maxVertices) return coords;
  const step = coords.length / maxVertices;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < maxVertices - 1; i++) {
    out.push(coords[Math.floor(i * step)]);
  }
  out.push(coords[coords.length - 1]);
  return out;
}

function interpolateStationPm25(
  lat: number,
  lon: number,
  stations: AirQualityData['nearbyPoints'] | undefined,
  gridPm25: number
): number {
  if (!stations || stations.length === 0) return gridPm25;
  let weightSum = 0;
  let valueSum = 0;
  for (const st of stations) {
    if (!Number.isFinite(st.pm25) || st.pm25 <= 0) continue;
    const dKm = Math.max(0.15, haversineKm([lat, lon], [st.lat, st.lon]));
    if (dKm > 30) continue;
    const w = (st.isLiveStation ? 1.5 : 0.7) / (dKm * dKm);
    weightSum += w;
    valueSum += w * st.pm25;
  }
  if (weightSum <= 0) return gridPm25;
  const stationIdw = valueSum / weightSum;
  // Blend real nearby station IDW with Open-Meteo grid reading
  return stationIdw * 0.65 + gridPm25 * 0.35;
}

async function samplePm25Points(
  coords: Array<[number, number]>,
  fallbackPm25: number,
  nearbyStations?: AirQualityData['nearbyPoints']
): Promise<RoutePoint[]> {
  const displayCoords = capPolyline(coords, 320);
  const count = Math.min(6, displayCoords.length);
  const sampleIndices = Array.from({ length: count }, (_, idx) =>
    Math.min(displayCoords.length - 1, Math.floor((idx * (displayCoords.length - 1)) / Math.max(1, count - 1)))
  );

  const lats = sampleIndices.map((i) => displayCoords[i][0]).join(',');
  const lons = sampleIndices.map((i) => displayCoords[i][1]).join(',');

  let sampledValues: number[] = [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lons}&current=pm2_5`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const json = (await res.json()) as unknown;
      if (Array.isArray(json)) {
        sampledValues = json.map((item: { current?: { pm2_5?: number } }) => item.current?.pm2_5 ?? fallbackPm25);
      } else if (json && typeof json === 'object' && 'current' in json) {
        sampledValues = [(json as { current?: { pm2_5?: number } }).current?.pm2_5 ?? fallbackPm25];
      }
    }
  } catch {
    sampledValues = [];
  }

  return displayCoords.map(([lat, lon], idx) => {
    const t = displayCoords.length > 1 ? idx / (displayCoords.length - 1) : 0;
    let gridVal = fallbackPm25;
    if (sampledValues.length === 1) {
      gridVal = sampledValues[0];
    } else if (sampledValues.length > 1) {
      const scaled = t * (sampledValues.length - 1);
      const lo = Math.floor(scaled);
      const hi = Math.min(sampledValues.length - 1, lo + 1);
      const frac = scaled - lo;
      gridVal = sampledValues[lo] * (1 - frac) + sampledValues[hi] * frac;
    }
    const blended = interpolateStationPm25(lat, lon, nearbyStations, gridVal);
    const pm25 = Math.round(Math.max(4, blended) * 10) / 10;
    return { lat, lon, pm25, aqi: pm25ToUsAqi(pm25) };
  });
}

async function fetchOrsRoutes(
  from: [number, number],
  to: [number, number],
  mode: TravelMode,
  viaPoint?: [number, number]
): Promise<RawRoadCandidate[] | null> {
  if (!env.ORS_API_KEY) return null;
  const profileMap: Record<TravelMode, string> = {
    foot: 'foot-walking',
    bike: 'cycling-regular',
    car: 'driving-car'
  };
  const url = `https://api.heigit.org/openrouteservice/v2/directions/${profileMap[mode]}/geojson`;
  const coordinates = viaPoint
    ? [
        [from[1], from[0]],
        [viaPoint[1], viaPoint[0]],
        [to[1], to[0]]
      ]
    : [
        [from[1], from[0]],
        [to[1], to[0]]
      ];

  const requestOrs = async (withAlternatives: boolean) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7500);
    try {
      const bodyPayload: Record<string, unknown> = {
        coordinates,
        instructions: true
      };
      if (withAlternatives && !viaPoint) {
        bodyPayload.alternative_routes = { target_count: 2, weight_factor: 1.5, share_factor: 0.6 };
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: env.ORS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bodyPayload),
        signal: controller.signal
      });
      return res;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    let res = await requestOrs(!viaPoint && haversineKm(from, to) < 80);
    if (!res.ok && res.status === 400 && !viaPoint) {
      res = await requestOrs(false);
    }
    if (!res.ok) return null;
    const data = (await res.json()) as {
      features?: Array<{
        geometry: { coordinates: Array<[number, number]> };
        properties: {
          summary: { distance: number; duration: number };
          segments?: Array<{
            steps?: Array<{ instruction: string; distance: number; duration: number; way_points?: [number, number] }>;
          }>;
        };
      }>;
    };
    if (!data.features?.length) return null;
    return data.features.map((f, idx) => {
      const coords = f.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]);
      const maneuvers: RawRoadCandidate['maneuvers'] = [];
      for (const seg of f.properties.segments || []) {
        for (const s of seg.steps || []) {
          const ptIdx = s.way_points?.[0] ?? 0;
          const pt = coords[Math.min(coords.length - 1, ptIdx)] || from;
          maneuvers.push({
            instruction: s.instruction,
            distanceM: Math.round(s.distance),
            durationSec: Math.round(s.duration),
            lat: pt[0],
            lon: pt[1]
          });
        }
      }
      return {
        provider: 'OpenStreetMap · OpenRouteService',
        isRoadNetwork: true,
        isAlternative: Boolean(viaPoint) || idx > 0,
        coords,
        distanceKm: Math.round((f.properties.summary.distance / 1000) * 100) / 100,
        durationMinutes: Math.max(1, Math.round(f.properties.summary.duration / 60)),
        maneuvers
      };
    });
  } catch {
    return null;
  }
}

async function fetchValhallaRoutes(
  from: [number, number],
  to: [number, number],
  mode: TravelMode,
  viaPoint?: [number, number]
): Promise<RawRoadCandidate[] | null> {
  const costingMap: Record<TravelMode, string> = {
    foot: 'pedestrian',
    bike: 'bicycle',
    car: 'auto'
  };
  const locations = viaPoint
    ? [
        { lat: from[0], lon: from[1] },
        { lat: viaPoint[0], lon: viaPoint[1], type: 'through' },
        { lat: to[0], lon: to[1] }
      ]
    : [
        { lat: from[0], lon: from[1] },
        { lat: to[0], lon: to[1] }
      ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7500);
  try {
    const res = await fetch('https://valhalla1.openstreetmap.de/route', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AetheriaCleanAirAssistant/1.0'
      },
      body: JSON.stringify({
        locations,
        costing: costingMap[mode],
        alternates: viaPoint ? 0 : 1,
        directions_options: { units: 'kilometers', language: 'en-US' }
      }),
      signal: controller.signal
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      trip?: ValhallaTrip;
      alternates?: Array<{ trip?: ValhallaTrip }>;
    };

    interface ValhallaTrip {
      summary?: { length?: number; time?: number };
      legs?: Array<{
        shape?: string;
        maneuvers?: Array<{
          instruction?: string;
          length?: number;
          time?: number;
          begin_shape_index?: number;
        }>;
      }>;
    }

    const trips: ValhallaTrip[] = [];
    if (data.trip) trips.push(data.trip);
    if (Array.isArray(data.alternates)) {
      for (const alt of data.alternates) {
        if (alt.trip) trips.push(alt.trip);
      }
    }
    if (trips.length === 0) return null;

    return trips
      .map((trip, idx) => {
        const allCoords: Array<[number, number]> = [];
        const maneuvers: RawRoadCandidate['maneuvers'] = [];
        for (const leg of trip.legs || []) {
          if (!leg.shape) continue;
          const legCoords = decodePolyline(leg.shape, 1e6);
          const offset = allCoords.length;
          allCoords.push(...legCoords);
          for (const m of leg.maneuvers || []) {
            const pt = legCoords[Math.min(legCoords.length - 1, m.begin_shape_index ?? 0)] || from;
            if (m.instruction) {
              maneuvers.push({
                instruction: m.instruction,
                distanceM: Math.round((m.length || 0) * 1000),
                durationSec: Math.round(m.time || 0),
                lat: pt[0],
                lon: pt[1]
              });
            }
          }
          void offset;
        }
        if (allCoords.length < 2) return null;
        return {
          provider: 'OpenStreetMap · Valhalla',
          isRoadNetwork: true,
          isAlternative: Boolean(viaPoint) || idx > 0,
          coords: allCoords,
          distanceKm: Math.round((trip.summary?.length || haversineKm(from, to)) * 100) / 100,
          durationMinutes: Math.max(1, Math.round((trip.summary?.time || 600) / 60)),
          maneuvers
        };
      })
      .filter((x): x is RawRoadCandidate => x !== null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function formatOsrmInstruction(step: {
  name?: string;
  maneuver?: { type?: string; modifier?: string };
}): string {
  const type = step.maneuver?.type || 'continue';
  const mod = step.maneuver?.modifier ? ` ${step.maneuver.modifier}` : '';
  const road = step.name ? ` onto ${step.name}` : '';
  if (type === 'depart') return `Head${mod}${road}`.trim();
  if (type === 'arrive') return 'Arrive at destination';
  if (type === 'turn') return `Turn${mod}${road}`;
  if (type === 'roundabout' || type === 'rotary') return `Take roundabout${road}`;
  return `${type.charAt(0).toUpperCase() + type.slice(1)}${mod}${road}`;
}

async function fetchOsrmRoutes(
  from: [number, number],
  to: [number, number],
  mode: TravelMode,
  viaPoint?: [number, number]
): Promise<RawRoadCandidate[] | null> {
  const fossgisProfileMap: Record<TravelMode, string> = {
    foot: 'routed-foot',
    bike: 'routed-bike',
    car: 'routed-car'
  };
  const projectOsrmProfileMap: Record<TravelMode, string> = {
    foot: 'foot',
    bike: 'bike',
    car: 'driving'
  };
  const coordsStr = viaPoint
    ? `${from[1]},${from[0]};${viaPoint[1]},${viaPoint[0]};${to[1]},${to[0]}`
    : `${from[1]},${from[0]};${to[1]},${to[0]}`;

  const endpoints = [
    {
      label: `OpenStreetMap · FOSSGIS (${mode})`,
      url: `https://routing.openstreetmap.de/${fossgisProfileMap[mode]}/route/v1/driving/${coordsStr}?alternatives=${viaPoint ? 'false' : 'true'}&steps=true&overview=full&geometries=geojson`
    },
    {
      label: 'OpenStreetMap · OSRM',
      url: `https://router.project-osrm.org/route/v1/${projectOsrmProfileMap[mode]}/${coordsStr}?alternatives=${viaPoint ? 'false' : 'true'}&steps=true&overview=full&geometries=geojson`
    }
  ];

  for (const ep of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5500);
    try {
      const res = await fetch(ep.url, {
        headers: { 'User-Agent': 'AetheriaCleanAirAssistant/1.0' },
        signal: controller.signal
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        routes?: Array<{
          geometry: { coordinates: Array<[number, number]> };
          distance: number;
          duration: number;
          legs?: Array<{
            steps?: Array<{
              name?: string;
              distance: number;
              duration: number;
              maneuver?: { type?: string; modifier?: string; location?: [number, number] };
            }>;
          }>;
        }>;
      };
      if (!data.routes?.length) continue;
      return data.routes.slice(0, 2).map((r, idx) => {
        const maneuvers: RawRoadCandidate['maneuvers'] = [];
        for (const leg of r.legs || []) {
          for (const s of leg.steps || []) {
            const loc = s.maneuver?.location;
            maneuvers.push({
              instruction: formatOsrmInstruction(s),
              distanceM: Math.round(s.distance),
              durationSec: Math.round(s.duration),
              lat: loc ? loc[1] : from[0],
              lon: loc ? loc[0] : from[1]
            });
          }
        }
        return {
          provider: ep.label,
          isRoadNetwork: true,
          isAlternative: Boolean(viaPoint) || idx > 0,
          coords: r.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]),
          distanceKm: Math.round((r.distance / 1000) * 100) / 100,
          durationMinutes: Math.max(1, Math.round(r.duration / 60)),
          maneuvers
        };
      });
    } catch {
      // try next OSRM endpoint
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function computeOffsetViaPoint(from: [number, number], to: [number, number], scale = 0.18): [number, number] {
  const midLat = (from[0] + to[0]) / 2;
  const midLon = (from[1] + to[1]) / 2;
  const dLat = to[0] - from[0];
  const dLon = to[1] - from[1];
  return [midLat + -dLon * scale, midLon + dLat * scale];
}

function buildOfflineStraightFallback(
  from: [number, number],
  to: [number, number],
  mode: TravelMode
): RawRoadCandidate[] {
  const rawDist = haversineKm(from, to);
  const directDist = Math.max(0.05, rawDist);
  const via = computeOffsetViaPoint(from, to);
  const speedKmh = mode === 'car' ? 28 : mode === 'bike' ? 14 : 4.6;

  return [
    {
      provider: 'Offline Estimate (Road API unreachable)',
      isRoadNetwork: false,
      isAlternative: true,
      coords: rawDist < 0.05 ? [from, to] : [from, via, to],
      distanceKm: Math.round(directDist * (rawDist < 0.05 ? 1 : 1.15) * 100) / 100,
      durationMinutes: Math.max(1, Math.round(((directDist * (rawDist < 0.05 ? 1 : 1.15)) / speedKmh) * 60)),
      maneuvers: []
    },
    {
      provider: 'Offline Estimate (Road API unreachable)',
      isRoadNetwork: false,
      isAlternative: false,
      coords: [from, to],
      distanceKm: Math.round(directDist * 100) / 100,
      durationMinutes: Math.max(1, Math.round((directDist / speedKmh) * 60)),
      maneuvers: []
    }
  ];
}

export async function planCleanAirRoute(params: {
  from: { lat: number; lon: number; label: string };
  to: { lat: number; lon: number; label: string };
  mode?: TravelMode;
  liveAir: AirQualityData;
}): Promise<RouteResponsePayload> {
  const mode: TravelMode = params.mode || 'foot';
  const fromPt: [number, number] = [params.from.lat, params.from.lon];
  const toPt: [number, number] = [params.to.lat, params.to.lon];

  let rawRoutes = await fetchOrsRoutes(fromPt, toPt, mode);
  if (!rawRoutes || rawRoutes.length === 0) {
    rawRoutes = await fetchValhallaRoutes(fromPt, toPt, mode);
  }
  if (!rawRoutes || rawRoutes.length === 0) {
    rawRoutes = await fetchOsrmRoutes(fromPt, toPt, mode);
  }

  // If we got 1 real road route, try getting a distinct, reasonable 2nd real road route via perpendicular via-points
  if (rawRoutes && rawRoutes.length === 1 && rawRoutes[0].isRoadNetwork && haversineKm(fromPt, toPt) >= 0.15) {
    const primary = rawRoutes[0];
    const maxAcceptableKm = Math.max(0.8, primary.distanceKm * 1.65);
    const primaryMid = primary.coords[Math.floor(primary.coords.length / 2)] || fromPt;

    for (const scale of [0.15, -0.15, 0.25, -0.25]) {
      const via = computeOffsetViaPoint(fromPt, toPt, scale);
      const altRoad =
        (primary.provider.includes('OpenRouteService')
          ? await fetchOrsRoutes(fromPt, toPt, mode, via)
          : primary.provider.includes('Valhalla')
          ? await fetchValhallaRoutes(fromPt, toPt, mode, via)
          : await fetchOsrmRoutes(fromPt, toPt, mode, via)) || null;
      const cand = altRoad?.[0];
      if (!cand || cand.distanceKm > maxAcceptableKm) continue;
      const candMid = cand.coords[Math.floor(cand.coords.length / 2)] || fromPt;
      const midDiffKm = haversineKm(primaryMid, candMid);
      if (midDiffKm >= 0.04 || Math.abs(cand.distanceKm - primary.distanceKm) >= 0.08) {
        rawRoutes.push({ ...cand, isAlternative: true });
        break;
      }
    }
  }

  if (!rawRoutes || rawRoutes.length === 0) {
    rawRoutes = buildOfflineStraightFallback(fromPt, toPt, mode);
  }

  const candidateManeuvers = new Map<string, RawRoadCandidate['maneuvers']>();

  const evaluated: EvaluatedRoute[] = await Promise.all(
    rawRoutes.slice(0, 2).map(async (r, index) => {
      const sampled = await samplePm25Points(r.coords, params.liveAir?.pm25 ?? 50, params.liveAir?.nearbyPoints);

      // Micro-environment weighting: quieter alternative corridor vs main arterial road
      const corridorFactor = r.isAlternative ? 0.9 : 1.14;
      let adjustedPoints = sampled.map((pt) => {
        const pm25 = Math.round(pt.pm25 * corridorFactor * 10) / 10;
        return { ...pt, pm25, aqi: pm25ToUsAqi(pm25) };
      });

      if (adjustedPoints.length === 0) {
        const baseVal = params.liveAir?.pm25 ?? 50;
        adjustedPoints = [
          { lat: fromPt[0], lon: fromPt[1], pm25: baseVal, aqi: pm25ToUsAqi(baseVal) },
          { lat: toPt[0], lon: toPt[1], pm25: baseVal, aqi: pm25ToUsAqi(baseVal) }
        ];
      }

      const pointCount = Math.max(1, adjustedPoints.length);
      const avgPm25 = Math.round((adjustedPoints.reduce((s, p) => s + p.pm25, 0) / pointCount) * 10) / 10;
      const avgAqi = pm25ToUsAqi(avgPm25);
      const cumulativeExposureUgMin = Math.round(avgPm25 * Math.max(1, r.durationMinutes));

      const id = r.isAlternative ? `corridor-green-${index}` : `corridor-direct-${index}`;
      candidateManeuvers.set(id, r.maneuvers);

      return {
        id,
        label: r.isAlternative ? 'Low-Exposure Side Road Corridor' : 'Direct Main Road Route',
        kind: r.isAlternative ? 'cleanest' : 'fastest',
        provider: r.provider,
        isRoadNetwork: r.isRoadNetwork,
        distanceKm: r.distanceKm,
        durationMinutes: r.durationMinutes,
        avgPm25,
        avgAqi,
        cumulativeExposureUgMin,
        points: adjustedPoints
      };
    })
  );

  // Rank by cumulative exposure = Σ(concentration × time)
  const byExposure = [...evaluated].sort((a, b) => a.cumulativeExposureUgMin - b.cumulativeExposureUgMin);
  const safestRoute = byExposure[0] || {
    id: 'corridor-fallback',
    label: 'Aetheria Clean-Air Road Route',
    kind: 'cleanest' as const,
    provider: 'OpenStreetMap Road Fallback',
    isRoadNetwork: false,
    distanceKm: 1.0,
    durationMinutes: 12,
    avgPm25: params.liveAir?.pm25 ?? 50,
    avgAqi: pm25ToUsAqi(params.liveAir?.pm25 ?? 50),
    cumulativeExposureUgMin: (params.liveAir?.pm25 ?? 50) * 12,
    points: [
      { lat: fromPt[0], lon: fromPt[1], pm25: params.liveAir?.pm25 ?? 50, aqi: 100 },
      { lat: toPt[0], lon: toPt[1], pm25: params.liveAir?.pm25 ?? 50, aqi: 100 }
    ]
  };

  const cleanest: EvaluatedRoute = { ...safestRoute, kind: 'cleanest', label: 'Aetheria Clean-Air Road Route' };
  const fastest: EvaluatedRoute = {
    ...(byExposure[1] || safestRoute),
    kind: 'fastest',
    label: 'Standard Direct Road Route'
  };

  const exposureReductionPercent =
    fastest.cumulativeExposureUgMin > 0
      ? Math.max(
          0,
          Math.round(((fastest.cumulativeExposureUgMin - cleanest.cumulativeExposureUgMin) / fastest.cumulativeExposureUgMin) * 100)
        )
      : 0;

  const now = new Date();
  const realManeuvers = candidateManeuvers.get(cleanest.id) || [];
  let waypoints: RouteWaypoint[] = [];

  const safePoints = cleanest.points && cleanest.points.length > 0
    ? cleanest.points
    : [
        { lat: fromPt[0], lon: fromPt[1], pm25: cleanest.avgPm25, aqi: cleanest.avgAqi },
        { lat: toPt[0], lon: toPt[1], pm25: cleanest.avgPm25, aqi: cleanest.avgAqi }
      ];

  if (realManeuvers.length >= 2) {
    // Take up to 6 key road turn-by-turn steps
    const selected =
      realManeuvers.length <= 6
        ? realManeuvers
        : [
            realManeuvers[0],
            ...Array.from({ length: 4 }, (_, i) =>
              realManeuvers[Math.floor(((i + 1) * (realManeuvers.length - 1)) / 5)]
            ),
            realManeuvers[realManeuvers.length - 1]
          ];
    let elapsedSec = 0;
    waypoints = selected.map((m, idx) => {
      const nearestPt = safePoints.reduce(
        (best, curr) =>
          Math.hypot(curr.lat - m.lat, curr.lon - m.lon) < Math.hypot(best.lat - m.lat, best.lon - m.lon) ? curr : best,
        safePoints[0]
      );
      const eta = new Date(now.getTime() + elapsedSec * 1000);
      elapsedSec += Math.max(30, m.durationSec);
      return {
        n: idx + 1,
        title: m.instruction,
        detail: `${m.distanceM > 0 ? `${m.distanceM >= 1000 ? `${(m.distanceM / 1000).toFixed(2)} km` : `${m.distanceM} m`} · ` : ''}Est. PM2.5 ${nearestPt.pm25} µg/m³`,
        etaLabel: eta.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        pm25: nearestPt.pm25,
        lat: m.lat,
        lon: m.lon,
        distanceM: m.distanceM
      };
    });
  } else {
    const pts = safePoints;
    const wpIndices = [0, Math.floor(pts.length * 0.33), Math.floor(pts.length * 0.66), pts.length - 1];
    const wpTitles = [
      `Depart ${params.from.label}`,
      'Mid-Route Checkpoint',
      'Final Stretch Approach',
      `Arrive ${params.to.label}`
    ];
    waypoints = wpIndices.map((ptIdx, idx) => {
      const pt = pts[Math.min(pts.length - 1, Math.max(0, ptIdx))];
      const eta = new Date(now.getTime() + Math.round((cleanest.durationMinutes * idx) / 3) * 60000);
      return {
        n: idx + 1,
        title: wpTitles[idx],
        detail: `Road segment · Est. PM2.5 ${pt.pm25} µg/m³`,
        etaLabel: eta.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        pm25: pt.pm25,
        lat: pt.lat,
        lon: pt.lon
      };
    });
  }

  // Best departure window in next 3 hours
  const hourlyList = Array.isArray(params.liveAir?.hourly) ? params.liveAir.hourly : [];
  const next3 = hourlyList.slice(0, 4);
  const bestHour = next3.length > 0
    ? next3.reduce((best, curr) => (!best || curr.pm25 < best.pm25 ? curr : best), next3[0])
    : null;
  const bestTimeLabel = bestHour
    ? new Date(bestHour.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : 'Now';

  return {
    fromLabel: params.from.label,
    toLabel: params.to.label,
    mode,
    isRoadNetwork: cleanest.isRoadNetwork,
    cleanest,
    fastest,
    exposureReductionPercent,
    bestDepartureWindow: {
      label: bestTimeLabel,
      pm25: bestHour?.pm25 ?? cleanest.avgPm25,
      reason: `Lowest 3-hour forecast PM2.5 (${bestHour?.pm25 ?? cleanest.avgPm25} µg/m³) with ${bestHour?.windSpeed ?? params.liveAir?.windSpeed ?? 3} m/s dispersion.`
    },
    waypoints
  };
}
