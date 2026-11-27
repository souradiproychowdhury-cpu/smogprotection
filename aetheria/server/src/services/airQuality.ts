import {
  mapUsAqiToSpectrum,
  pm25ToUsAqi,
  whoGuidelineMultiple,
  type AirQualityData,
  type HourlyAirPoint
} from '@aetheria/shared';
import { env } from '../config/env.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const airCache = new Map<string, CacheEntry<AirQualityData>>();
const geocodeCache = new Map<string, CacheEntry<GeocodedPlace[]>>();

export interface GeocodedPlace {
  name: string;
  country: string;
  admin1?: string;
  lat: number;
  lon: number;
  displayName: string;
  kind?: string;
}

function roundCoord(n: number): number {
  return Math.round(n * 100) / 100;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)) * 10) / 10;
}

function usAqiToApproxPm25(aqi: number): number {
  const breakpoints: Array<[number, number, number, number]> = [
    [0.0, 9.0, 0, 50],
    [9.1, 35.4, 51, 100],
    [35.5, 55.4, 101, 150],
    [55.5, 125.4, 151, 200],
    [125.5, 225.4, 201, 300],
    [225.5, 325.4, 301, 400],
    [325.5, 500.4, 401, 500]
  ];
  const clamped = Math.max(0, Math.min(500, aqi));
  for (const [cLow, cHigh, iLow, iHigh] of breakpoints) {
    if (clamped <= iHigh) {
      return Math.round((((clamped - iLow) * (cHigh - cLow)) / (iHigh - iLow) + cLow) * 10) / 10;
    }
  }
  return 325.4;
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 8000, headers?: Record<string, string>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AetheriaCleanAirAssistant/1.0',
        ...(headers || {})
      }
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function reverseGeocodeName(lat: number, lon: number): Promise<string | null> {
  try {
    const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&lang=en`;
    const data = await fetchJsonWithTimeout<{
      features?: Array<{
        properties?: {
          name?: string;
          street?: string;
          suburb?: string;
          district?: string;
          city?: string;
          state?: string;
        };
      }>;
    }>(url, 3500);
    const p = data.features?.[0]?.properties;
    if (p) {
      const label = [p.name || p.street || p.suburb || p.district, p.city || p.state].filter(Boolean).join(', ');
      if (label) return label;
    }
  } catch {
    // Fallback to Nominatim reverse
  }

  try {
    const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=16&addressdetails=1`;
    const nom = await fetchJsonWithTimeout<{
      name?: string;
      display_name?: string;
      address?: {
        road?: string;
        neighbourhood?: string;
        suburb?: string;
        city?: string;
        town?: string;
        state?: string;
      };
    }>(nomUrl, 3500, { 'Accept-Language': 'en' });
    const a = nom.address;
    if (a) {
      const primary = nom.name || a.road || a.neighbourhood || a.suburb;
      const city = a.city || a.town || a.state;
      const label = [primary, city && city !== primary ? city : undefined].filter(Boolean).join(', ');
      if (label) return label;
    }
    if (nom.display_name) {
      return nom.display_name.split(',').slice(0, 2).join(',').trim();
    }
  } catch {
    // ignore
  }
  return null;
}

export async function searchLocations(
  query: string,
  biasLat?: number,
  biasLon?: number
): Promise<GeocodedPlace[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const biasKey = typeof biasLat === 'number' && typeof biasLon === 'number'
    ? `@${roundCoord(biasLat)},${roundCoord(biasLon)}`
    : '';
  const cacheKey = `${q.toLowerCase()}${biasKey}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const photonUrl =
    `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en` +
    (typeof biasLat === 'number' && typeof biasLon === 'number'
      ? `&lat=${encodeURIComponent(biasLat)}&lon=${encodeURIComponent(biasLon)}`
      : '');

  const nominatimUrl =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(q)}` +
    (typeof biasLat === 'number' && typeof biasLon === 'number'
      ? `&viewbox=${biasLon - 0.35},${biasLat + 0.35},${biasLon + 0.35},${biasLat - 0.35}&bounded=0`
      : '');

  const openMeteoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;

  const [photonRes, nominatimRes, omRes] = await Promise.allSettled([
    fetchJsonWithTimeout<{
      features?: Array<{
        geometry: { coordinates: [number, number] };
        properties: {
          name?: string;
          street?: string;
          housenumber?: string;
          district?: string;
          city?: string;
          state?: string;
          country?: string;
          osm_value?: string;
        };
      }>;
    }>(photonUrl, 4500),
    fetchJsonWithTimeout<
      Array<{
        lat: string;
        lon: string;
        name?: string;
        display_name: string;
        type?: string;
        address?: {
          road?: string;
          suburb?: string;
          city?: string;
          town?: string;
          state?: string;
          country?: string;
        };
      }>
    >(nominatimUrl, 4500, { 'Accept-Language': 'en' }),
    fetchJsonWithTimeout<{
      results?: Array<{
        name: string;
        country?: string;
        admin1?: string;
        latitude: number;
        longitude: number;
      }>;
    }>(openMeteoUrl, 4500)
  ]);

  const combined: GeocodedPlace[] = [];

  if (photonRes.status === 'fulfilled' && photonRes.value.features) {
    for (const f of photonRes.value.features) {
      const [lon, lat] = f.geometry.coordinates;
      const p = f.properties;
      const primary = p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.district || p.city || q;
      const displayName = [primary, p.district, p.city !== primary ? p.city : undefined, p.state, p.country]
        .filter(Boolean)
        .join(', ');
      combined.push({
        name: primary,
        country: p.country || '',
        admin1: p.state || p.city,
        lat,
        lon,
        displayName: displayName || primary,
        kind: p.osm_value
      });
    }
  }

  if (nominatimRes.status === 'fulfilled' && Array.isArray(nominatimRes.value)) {
    for (const item of nominatimRes.value) {
      const lat = Number(item.lat);
      const lon = Number(item.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const primary = item.name || item.address?.road || item.address?.suburb || item.display_name.split(',')[0];
      combined.push({
        name: primary,
        country: item.address?.country || '',
        admin1: item.address?.state || item.address?.city || item.address?.town,
        lat,
        lon,
        displayName: item.display_name.split(',').slice(0, 4).join(',').trim(),
        kind: item.type
      });
    }
  }

  if (omRes.status === 'fulfilled' && omRes.value.results) {
    for (const r of omRes.value.results) {
      combined.push({
        name: r.name,
        country: r.country || '',
        admin1: r.admin1,
        lat: r.latitude,
        lon: r.longitude,
        displayName: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
        kind: 'city'
      });
    }
  }

  // Deduplicate entries within ~250m of each other
  const deduped: GeocodedPlace[] = [];
  for (const item of combined) {
    const duplicate = deduped.some(
      (existing) => Math.abs(existing.lat - item.lat) < 0.0025 && Math.abs(existing.lon - item.lon) < 0.0025
    );
    if (!duplicate) {
      deduped.push(item);
    }
    if (deduped.length >= 8) break;
  }

  if (deduped.length === 0 && photonRes.status === 'rejected' && nominatimRes.status === 'rejected' && omRes.status === 'rejected') {
    throw new Error('Geocoding providers unreachable');
  }

  geocodeCache.set(cacheKey, { value: deduped, expiresAt: Date.now() + CACHE_TTL_MS });
  return deduped;
}

export async function findNearbyLandmarks(lat: number, lon: number): Promise<GeocodedPlace[]> {
  const queries = ['garden', 'metro', 'park', 'school', 'hospital', 'market'];
  const responses = await Promise.allSettled(
    queries.map((q) =>
      fetchJsonWithTimeout<{
        features?: Array<{
          geometry: { coordinates: [number, number] };
          properties: { name?: string; district?: string; city?: string; country?: string; osm_value?: string };
        }>;
      }>(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${lat}&lon=${lon}&limit=6&lang=en`, 4000)
    )
  );

  const genericNames = new Set(['park', 'station', 'school', 'hospital', 'garden', 'market', 'metro', 'bus stop', 'stop']);
  const candidates: Array<GeocodedPlace & { dist: number }> = [];

  for (const r of responses) {
    if (r.status !== 'fulfilled') continue;
    for (const f of r.value.features || []) {
      const [pLon, pLat] = f.geometry.coordinates;
      const dist = haversineKm(lat, lon, pLat, pLon);
      if (dist < 0.35 || dist > 8) continue;
      const p = f.properties;
      const cleanName = (p.name || '').trim();
      if (!cleanName || genericNames.has(cleanName.toLowerCase())) continue;

      const norm = cleanName.toLowerCase().replace(/centre/g, 'center').replace(/[^a-z0-9]+/g, ' ').trim();
      const dup = candidates.some(
        (x) =>
          (Math.abs(x.lat - pLat) < 0.0025 && Math.abs(x.lon - pLon) < 0.0025) ||
          x.name.toLowerCase().replace(/centre/g, 'center').replace(/[^a-z0-9]+/g, ' ').trim() === norm
      );
      if (dup) continue;

      candidates.push({
        name: cleanName,
        country: p.country || '',
        admin1: p.city || p.district,
        lat: pLat,
        lon: pLon,
        displayName: [cleanName, p.district || p.city].filter(Boolean).join(', '),
        kind: p.osm_value,
        dist
      });
    }
  }

  candidates.sort((a, b) => {
    const aIdeal = a.dist >= 0.5 && a.dist <= 3.5 ? 0 : 1;
    const bIdeal = b.dist >= 0.5 && b.dist <= 3.5 ? 0 : 1;
    if (aIdeal !== bIdeal) return aIdeal - bIdeal;
    return a.dist - b.dist;
  });

  return candidates.slice(0, 6).map(({ dist: _d, ...place }) => place);
}

interface WaqiResponse {
  status: string;
  data?: {
    aqi?: number | string;
    city?: { name?: string; geo?: [number, number] };
    iaqi?: {
      pm25?: { v?: number };
      pm10?: { v?: number };
      no2?: { v?: number };
      o3?: { v?: number };
      t?: { v?: number };
      h?: { v?: number };
      w?: { v?: number };
    };
  };
}

interface WaqiBoundsResponse {
  status: string;
  data?: Array<{
    lat: number;
    lon: number;
    uid: number;
    aqi: string;
    station?: { name?: string; time?: string };
  }>;
}

interface OpenMeteoAirResponse {
  utc_offset_seconds?: number;
  current?: {
    us_aqi?: number;
    pm2_5?: number;
    pm10?: number;
    nitrogen_dioxide?: number;
    ozone?: number;
  };
  hourly?: {
    time: string[];
    pm2_5: Array<number | null>;
    pm10: Array<number | null>;
    nitrogen_dioxide: Array<number | null>;
    us_aqi: Array<number | null>;
  };
}

interface OpenMeteoWeatherResponse {
  utc_offset_seconds?: number;
  current?: {
    temperature_2m?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
  };
  hourly?: {
    time: string[];
    temperature_2m: Array<number | null>;
    wind_speed_10m: Array<number | null>;
    boundary_layer_height: Array<number | null>;
  };
}

export async function getLiveAirQuality(
  lat: number,
  lon: number,
  locationName?: string
): Promise<AirQualityData> {
  const key = `${roundCoord(lat)},${roundCoord(lon)}`;
  const cached = airCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return locationName ? { ...cached.value, locationName } : cached.value;
  }

  const airUrl =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
    `&current=us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone` +
    `&hourly=pm2_5,pm10,nitrogen_dioxide,us_aqi&forecast_days=2&timezone=auto`;

  const weatherUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m` +
    `&hourly=temperature_2m,wind_speed_10m,boundary_layer_height&forecast_days=2&timezone=auto`;

  const waqiUrl = env.WAQI_TOKEN
    ? `https://api.waqi.info/feed/geo:${lat};${lon}/?token=${encodeURIComponent(env.WAQI_TOKEN)}`
    : null;

  const waqiBoundsUrl = env.WAQI_TOKEN
    ? `https://api.waqi.info/map/bounds/?latlng=${lat - 0.25},${lon - 0.25},${lat + 0.25},${lon + 0.25}&token=${encodeURIComponent(env.WAQI_TOKEN)}`
    : null;

  const [omAirRes, omWeatherRes, waqiRes, waqiBoundsRes] = await Promise.allSettled([
    fetchJsonWithTimeout<OpenMeteoAirResponse>(airUrl),
    fetchJsonWithTimeout<OpenMeteoWeatherResponse>(weatherUrl),
    waqiUrl ? fetchJsonWithTimeout<WaqiResponse>(waqiUrl, 5000) : Promise.resolve(null),
    waqiBoundsUrl ? fetchJsonWithTimeout<WaqiBoundsResponse>(waqiBoundsUrl, 5000) : Promise.resolve(null)
  ]);

  const omAir = omAirRes.status === 'fulfilled' ? omAirRes.value : null;
  const omWeather = omWeatherRes.status === 'fulfilled' ? omWeatherRes.value : null;
  const waqi = waqiRes.status === 'fulfilled' ? waqiRes.value : null;
  const waqiBounds = waqiBoundsRes.status === 'fulfilled' ? waqiBoundsRes.value : null;

  if (!omAir && (!waqi || waqi.status !== 'ok')) {
    throw new Error('Unable to reach live air quality providers (Open-Meteo / WAQI).');
  }

  const rawWaqiAqi = waqi?.data?.aqi;
  const waqiAqiNum =
    typeof rawWaqiAqi === 'number'
      ? rawWaqiAqi
      : typeof rawWaqiAqi === 'string' && rawWaqiAqi.trim() !== '' && rawWaqiAqi.trim() !== '-'
      ? Number(rawWaqiAqi)
      : NaN;
  const waqiValid = Boolean(waqi && waqi.status === 'ok' && waqi.data && Number.isFinite(waqiAqiNum) && waqiAqiNum > 0);

  const omPm25 =
    omAir?.current?.pm2_5 ??
    omAir?.hourly?.pm2_5?.[0] ??
    (waqiValid ? usAqiToApproxPm25(waqiAqiNum) : 0);
  const omAqi = omAir?.current?.us_aqi ?? pm25ToUsAqi(omPm25);

  const pm25 = Math.round(((waqiValid ? waqi?.data?.iaqi?.pm25?.v : undefined) ?? omPm25) * 10) / 10;
  const pm10 = Math.round(((waqiValid ? waqi?.data?.iaqi?.pm10?.v : undefined) ?? omAir?.current?.pm10 ?? pm25 * 1.4) * 10) / 10;
  const no2 = Math.round(((waqiValid ? waqi?.data?.iaqi?.no2?.v : undefined) ?? omAir?.current?.nitrogen_dioxide ?? 0) * 10) / 10;
  const o3 = Math.round(((waqiValid ? waqi?.data?.iaqi?.o3?.v : undefined) ?? omAir?.current?.ozone ?? 0) * 10) / 10;

  const aqi = Math.round((waqiValid ? waqiAqiNum : omAqi) || pm25ToUsAqi(pm25));

  // Open-Meteo wind_speed_10m defaults to km/h -> convert to m/s
  const windKmh = omWeather?.current?.wind_speed_10m ?? 6;
  const windSpeed = Math.round(((waqiValid && waqi?.data?.iaqi?.w?.v) ? waqi.data.iaqi.w.v : windKmh / 3.6) * 10) / 10;
  const windDirection = Math.round(omWeather?.current?.wind_direction_10m ?? 270);
  const temperature = Math.round(((waqiValid ? waqi?.data?.iaqi?.t?.v : undefined) ?? omWeather?.current?.temperature_2m ?? 16) * 10) / 10;
  const humidity = Math.round((waqiValid ? waqi?.data?.iaqi?.h?.v : undefined) ?? omWeather?.current?.relative_humidity_2m ?? 62);

  // Build next 24h hourly forecast aligned from location's actual current local hour
  const utcOffsetSec = omAir?.utc_offset_seconds ?? omWeather?.utc_offset_seconds ?? 0;
  const nowLocalIsoHour = new Date(Date.now() + utcOffsetSec * 1000).toISOString().slice(0, 13);
  const times = omAir?.hourly?.time ?? [];
  let startIdx = times.findIndex((t) => t.slice(0, 13) >= nowLocalIsoHour);
  if (startIdx < 0) startIdx = 0;

  const hourly: HourlyAirPoint[] = [];
  for (let i = startIdx; i < Math.min(times.length, startIdx + 24); i++) {
    const hPm25 = omAir?.hourly?.pm2_5?.[i] ?? pm25;
    const hAqi = omAir?.hourly?.us_aqi?.[i] ?? pm25ToUsAqi(hPm25);
    const hWind = ((omWeather?.hourly?.wind_speed_10m?.[i] ?? windKmh) / 3.6);
    const hBlh = omWeather?.hourly?.boundary_layer_height?.[i] ?? 420;
    hourly.push({
      time: times[i],
      pm25: Math.round(hPm25 * 10) / 10,
      pm10: Math.round((omAir?.hourly?.pm10?.[i] ?? hPm25 * 1.35) * 10) / 10,
      no2: Math.round((omAir?.hourly?.nitrogen_dioxide?.[i] ?? no2) * 10) / 10,
      aqi: Math.round(hAqi),
      windSpeed: Math.round(hWind * 10) / 10,
      temperature: Math.round((omWeather?.hourly?.temperature_2m?.[i] ?? temperature) * 10) / 10,
      boundaryLayerHeight: Math.round(hBlh)
    });
  }

  const currentBlh = hourly[0]?.boundaryLayerHeight ?? 420;
  const inversionDetected = (currentBlh < 250 && windSpeed < 2.5) || (windSpeed < 1.5 && pm25 >= 55);
  const inversionReason = inversionDetected
    ? `Shallow boundary layer (~${currentBlh}m) with low wind dispersion (${windSpeed} m/s) is trapping surface particulates.`
    : `Boundary layer height (~${currentBlh}m) and ${windSpeed} m/s wind allow normal vertical mixing.`;

  const category = mapUsAqiToSpectrum(aqi);
  const resolvedName = locationName || (waqiValid && waqi?.data?.city?.name ? waqi.data.city.name : `${roundCoord(lat)}, ${roundCoord(lon)}`);
  const source = waqiValid
    ? `WAQI (${waqi?.data?.city?.name || 'Station'}) + Open-Meteo`
    : 'Open-Meteo Air Quality & Weather';

  // Prefer real WAQI monitoring stations in bounding box
  const realStations: AirQualityData['nearbyPoints'] = [];
  if (waqiBounds && waqiBounds.status === 'ok' && Array.isArray(waqiBounds.data)) {
    const validStations = waqiBounds.data
      .map((st) => {
        const raw = typeof st.aqi === 'string' ? st.aqi.trim() : String(st.aqi ?? '');
        if (!raw || raw === '-') return null;
        const parsedAqi = Number(raw);
        if (!Number.isFinite(parsedAqi) || parsedAqi <= 0) return null;
        const dist = haversineKm(lat, lon, st.lat, st.lon);
        return {
          name: st.station?.name || `Station #${st.uid}`,
          lat: st.lat,
          lon: st.lon,
          aqi: Math.round(parsedAqi),
          pm25: usAqiToApproxPm25(parsedAqi),
          isLiveStation: true,
          distanceKm: dist,
          updatedTime: st.station?.time
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999))
      .slice(0, 8);

    realStations.push(...validStations);
  }

  // If WAQI returned fewer than 3 nearby stations, supplement with real Open-Meteo grid points + reverse-geocoded locality names
  if (realStations.length < 3) {
    const offsets = [
      { fallbackName: 'North Sector', dLat: 0.03, dLon: 0.0 },
      { fallbackName: 'South Sector', dLat: -0.03, dLon: 0.01 },
      { fallbackName: 'East Sector', dLat: 0.008, dLon: 0.032 },
      { fallbackName: 'West Sector', dLat: -0.008, dLon: -0.032 }
    ];

    const nearbyResults = await Promise.allSettled(
      offsets.map(async (o) => {
        const pLat = lat + o.dLat;
        const pLon = lon + o.dLon;
        const pUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${pLat}&longitude=${pLon}&current=us_aqi,pm2_5`;
        const [res, placeName] = await Promise.all([
          fetchJsonWithTimeout<OpenMeteoAirResponse>(pUrl, 4500),
          reverseGeocodeName(pLat, pLon)
        ]);
        const pPm25 = Math.round((res.current?.pm2_5 ?? pm25) * 10) / 10;
        return {
          name: placeName || o.fallbackName,
          lat: pLat,
          lon: pLon,
          pm25: pPm25,
          aqi: Math.round(res.current?.us_aqi ?? pm25ToUsAqi(pPm25)),
          isLiveStation: false,
          distanceKm: haversineKm(lat, lon, pLat, pLon)
        };
      })
    );

    for (const r of nearbyResults) {
      if (r.status === 'fulfilled') {
        realStations.push(r.value);
      }
    }
  }

  const primaryLat = (waqiValid && waqi?.data?.city?.geo?.[0]) || lat;
  const primaryLon = (waqiValid && waqi?.data?.city?.geo?.[1]) || lon;
  const primaryStationName = waqiValid && waqi?.data?.city?.name ? waqi.data.city.name.trim() : '';

  const nearbyPoints: AirQualityData['nearbyPoints'] = [
    {
      name: primaryStationName ? `${primaryStationName} (Primary)` : resolvedName,
      lat: primaryLat,
      lon: primaryLon,
      aqi,
      pm25,
      isLiveStation: Boolean(waqiValid),
      distanceKm: haversineKm(lat, lon, primaryLat, primaryLon)
    },
    ...realStations.filter((st) => {
      const sameCoords = Math.abs(st.lat - primaryLat) < 0.002 && Math.abs(st.lon - primaryLon) < 0.002;
      const sameName = primaryStationName && st.name.trim().toLowerCase() === primaryStationName.toLowerCase();
      return !sameCoords && !sameName;
    })
  ].slice(0, 8);

  const payload: AirQualityData = {
    locationName: resolvedName,
    lat,
    lon,
    aqi,
    categoryKey: category.key,
    categoryLabel: category.label,
    accentWord: category.accentWord,
    pm25,
    pm10,
    no2,
    o3,
    windSpeed,
    windDirection,
    temperature,
    humidity,
    boundaryLayerHeight: currentBlh,
    inversionDetected,
    inversionReason,
    whoMultiple: whoGuidelineMultiple(pm25),
    source,
    updatedAt: new Date().toISOString(),
    hourly,
    nearbyPoints
  };

  airCache.set(key, { value: payload, expiresAt: Date.now() + CACHE_TTL_MS });
  return payload;
}
