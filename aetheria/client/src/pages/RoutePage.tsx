import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import { mapUsAqiToSpectrum } from '@aetheria/shared';
import { ErrorRetryCard, GlassSkeleton } from '../components/LoadingSkeleton';
import { ShareModal } from '../components/ShareModal';
import { api, type GeocodedPlace, type RoutePlanResponse } from '../lib/api';
import { tryNativeShare } from '../lib/share';
import { useAppStore } from '../store/useAppStore';
import { useTranslation } from '../i18n/useTranslation';
import { useVoice } from '../voice/useVoice';

export const RoutePage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const { speakText, stopSpeaking } = useVoice();

  const air = useAppStore((s) => s.air);
  const profile = useAppStore((s) => s.profile);
  const savedRoutes = useAppStore((s) => s.savedRoutes);
  const saveRoute = useAppStore((s) => s.saveRoute);
  const pushToast = useAppStore((s) => s.pushToast);

  const originLat = air?.lat ?? profile.location?.lat ?? 28.6139;
  const originLon = air?.lon ?? profile.location?.lon ?? 77.209;
  const originName = air?.locationName || profile.location?.name || 'My Location';

  const [fromQuery, setFromQuery] = useState(originName);
  const [fromPoint, setFromPoint] = useState({ lat: originLat, lon: originLon, label: originName });
  const [fromResults, setFromResults] = useState<GeocodedPlace[]>([]);

  const [toQuery, setToQuery] = useState(searchParams.get('to') || '');
  const [toPoint, setToPoint] = useState({
    lat: originLat + 0.012,
    lon: originLon + 0.014,
    label: searchParams.get('to') || 'Nearby Destination'
  });
  const [toResults, setToResults] = useState<GeocodedPlace[]>([]);
  const [nearbyChoices, setNearbyChoices] = useState<GeocodedPlace[]>([]);

  const [travelMode, setTravelMode] = useState<'foot' | 'bike' | 'car'>('foot');
  const [mapStyle, setMapStyle] = useState<'road' | 'dark'>('road');
  const [mapPickMode, setMapPickMode] = useState<'to' | 'from'>('to');
  const [tileError, setTileError] = useState(false);

  const [routeData, setRouteData] = useState<RoutePlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [navActive, setNavActive] = useState(false);
  const [activeWaypointIdx, setActiveWaypointIdx] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const gpsMarkerRef = useRef<L.CircleMarker | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const routeReqIdRef = useRef(0);
  const clickCtxRef = useRef({ fromPoint, toPoint, mapPickMode, travelMode });
  clickCtxRef.current = { fromPoint, toPoint, mapPickMode, travelMode };

  const runRouteSearch = async (
    destOverride?: { lat: number; lon: number; label: string },
    origOverride?: { lat: number; lon: number; label: string },
    modeOverride?: 'foot' | 'bike' | 'car'
  ) => {
    if (!destOverride && toQuery.trim().length < 2 && toPoint.label === 'Nearby Destination') {
      pushToast('Enter a destination or tap anywhere on the road map to set one.', 'info');
      return;
    }
    const reqId = ++routeReqIdRef.current;
    setLoading(true);
    setError(null);
    let targetOrig = origOverride || fromPoint;
    let targetDest = destOverride || toPoint;
    const modeToUse = modeOverride || travelMode;

    if (!origOverride && fromQuery.trim().length >= 2 && fromQuery.trim() !== fromPoint.label) {
      try {
        const geo = await api.geocode(fromQuery.trim(), originLat, originLon);
        if (reqId !== routeReqIdRef.current) return;
        if (geo.results.length > 0) {
          const best = geo.results[0];
          targetOrig = { lat: best.lat, lon: best.lon, label: best.displayName };
          setFromPoint(targetOrig);
          setFromQuery(best.displayName);
          setFromResults([]);
        } else {
          setError(`Could not find starting place "${fromQuery.trim()}". Pick a suggestion or click the map.`);
          setLoading(false);
          return;
        }
      } catch {
        if (reqId !== routeReqIdRef.current) return;
        setError(`Geocoding unavailable for "${fromQuery.trim()}". Select a nearby place or tap the map.`);
        setLoading(false);
        return;
      }
    }

    if (!destOverride && toQuery.trim().length >= 2 && toQuery.trim() !== toPoint.label) {
      try {
        const geo = await api.geocode(toQuery.trim(), targetOrig.lat, targetOrig.lon);
        if (reqId !== routeReqIdRef.current) return;
        if (geo.results.length > 0) {
          const best = geo.results[0];
          targetDest = { lat: best.lat, lon: best.lon, label: best.displayName };
          setToPoint(targetDest);
          setToQuery(best.displayName);
          setToResults([]);
        } else {
          setError(`Could not find destination "${toQuery.trim()}". Pick a suggestion or click the map.`);
          setLoading(false);
          return;
        }
      } catch {
        if (reqId !== routeReqIdRef.current) return;
        setError(`Geocoding unavailable for "${toQuery.trim()}". Select a nearby place or tap the map.`);
        setLoading(false);
        return;
      }
    }

    try {
      const res = await api.planRoute({
        from: { ...targetOrig, label: targetOrig.label.slice(0, 220) },
        to: { ...targetDest, label: targetDest.label.slice(0, 220) },
        mode: modeToUse
      });
      if (reqId !== routeReqIdRef.current) return;
      setRouteData(res);
      setActiveWaypointIdx(0);
    } catch (err) {
      if (reqId !== routeReqIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Unable to plan route');
    } finally {
      if (reqId === routeReqIdRef.current) {
        setLoading(false);
      }
    }
  };

  // Initialize origin, nearby real landmarks, and initial road route
  useEffect(() => {
    let cancelled = false;
    const startOrigin = { lat: originLat, lon: originLon, label: originName };
    setFromPoint(startOrigin);
    setFromQuery(originName);
    const paramTo = searchParams.get('to')?.trim();

    const initDest = async () => {
      if (paramTo && paramTo.length >= 2) {
        try {
          const geo = await api.geocode(paramTo, originLat, originLon);
          if (cancelled) return;
          if (geo.results.length > 0) {
            const best = geo.results[0];
            const resolved = { lat: best.lat, lon: best.lon, label: best.displayName };
            setToPoint(resolved);
            setToQuery(best.displayName);
            await runRouteSearch(resolved, startOrigin);
            return;
          }
        } catch {
          // continue below
        }
      }

      // Discover real nearby parks/stations around user's location
      try {
        const nearby = await api.nearbyLandmarks(originLat, originLon);
        if (cancelled) return;
        if (nearby.results.length > 0) {
          setNearbyChoices(nearby.results);
          const first = nearby.results[0];
          const resolved = { lat: first.lat, lon: first.lon, label: first.displayName };
          setToPoint(resolved);
          setToQuery(first.displayName);
          await runRouteSearch(resolved, startOrigin);
          return;
        }
      } catch {
        // fallback below
      }

      if (cancelled) return;
      const fallbackLat = originLat + 0.012;
      const fallbackLon = originLon + 0.014;
      let fallbackLabel = paramTo || `Nearby Point (${fallbackLat.toFixed(3)}, ${fallbackLon.toFixed(3)})`;
      if (!paramTo) {
        try {
          const rev = await api.reverseGeocode(fallbackLat, fallbackLon);
          if (rev.name) fallbackLabel = rev.name;
        } catch {
          // keep coordinate fallback
        }
      }
      if (cancelled) return;
      const defaultDest = {
        lat: fallbackLat,
        lon: fallbackLon,
        label: fallbackLabel
      };
      setToPoint(defaultDest);
      setToQuery(defaultDest.label);
      await runRouteSearch(defaultDest, startOrigin);
    };
    initDest();
    return () => {
      cancelled = true;
    };
  }, [originLat, originLon]);

  // Autocomplete Origin
  useEffect(() => {
    if (fromQuery.trim().length < 2 || fromQuery.trim() === fromPoint.label) {
      setFromResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.geocode(fromQuery, originLat, originLon);
        setFromResults(res.results);
      } catch {
        setFromResults([]);
      }
    }, 320);
    return () => clearTimeout(timer);
  }, [fromQuery, fromPoint.label, originLat, originLon]);

  // Autocomplete Destination
  useEffect(() => {
    if (toQuery.trim().length < 2 || toQuery.trim() === toPoint.label) {
      setToResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.geocode(toQuery, fromPoint.lat, fromPoint.lon);
        setToResults(res.results);
      } catch {
        setToResults([]);
      }
    }, 320);
    return () => clearTimeout(timer);
  }, [toQuery, toPoint.label, fromPoint.lat, fromPoint.lon]);

  // 1. Initialize Leaflet real OpenStreetMap road map immediately & switch tile layers with 3-tier fallback
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (!mapRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [clickCtxRef.current.fromPoint.lat, clickCtxRef.current.fromPoint.lon],
        zoom: 14,
        zoomControl: true,
        attributionControl: true
      });
      map.on('click', async (ev: L.LeafletMouseEvent) => {
        const lat = Math.round(ev.latlng.lat * 100000) / 100000;
        const lon = Math.round(ev.latlng.lng * 100000) / 100000;
        let label = `Pinned (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
        try {
          const rev = await api.reverseGeocode(lat, lon);
          if (rev.name) label = rev.name;
        } catch {
          // keep coordinate fallback
        }
        const clicked = { lat, lon, label };
        const ctx = clickCtxRef.current;
        if (ctx.mapPickMode === 'from') {
          setFromPoint(clicked);
          setFromQuery(clicked.label);
          setFromResults([]);
          runRouteSearch(ctx.toPoint, clicked, ctx.travelMode);
        } else {
          setToPoint(clicked);
          setToQuery(clicked.label);
          setToResults([]);
          runRouteSearch(clicked, ctx.fromPoint, ctx.travelMode);
        }
      });
      mapRef.current = map;
    }

    const map = mapRef.current;

    const tileFallbacks =
      mapStyle === 'road'
        ? [
            {
              url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
              attr: 'Tiles © Esri · Source: Esri, DeLorme, NAVTEQ',
              subdomains: ''
            },
            {
              url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
              attr: 'Tiles © Esri · Source: USGS, Esri',
              subdomains: ''
            }
          ]
        : [
            {
              url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
              attr: 'Tiles © Esri · Esri, DeLorme, NAVTEQ',
              subdomains: ''
            },
            {
              url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
              attr: 'Tiles © Esri · Source: Esri, DeLorme, NAVTEQ',
              subdomains: ''
            }
          ];

    const attachTileLayer = (idx: number) => {
      const cfg = tileFallbacks[idx];
      if (!cfg) {
        setTileError(true);
        return;
      }
      if (tileLayerRef.current) {
        map.removeLayer(tileLayerRef.current);
      }
      let loadedCount = 0;
      let errCount = 0;
      let switched = false;
      const layer = L.tileLayer(cfg.url, {
        attribution: cfg.attr,
        maxZoom: 19,
        subdomains: cfg.subdomains || 'abcd'
      });
      layer.on('tileload', () => {
        loadedCount += 1;
        setTileError(false);
      });
      layer.on('tileerror', () => {
        errCount += 1;
        if (!switched && loadedCount === 0 && errCount >= 3) {
          switched = true;
          if (idx + 1 < tileFallbacks.length) {
            attachTileLayer(idx + 1);
          } else {
            setTileError(true);
          }
        }
      });
      layer.addTo(map);
      tileLayerRef.current = layer;
    };

    setTileError(false);
    attachTileLayer(0);

    const resizeTimer = setTimeout(() => {
      map.invalidateSize();
    }, 100);

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => map.invalidateSize())
        : null;
    if (observer && mapContainerRef.current) {
      observer.observe(mapContainerRef.current);
    }

    return () => {
      clearTimeout(resizeTimer);
      observer?.disconnect();
    };
  }, [mapStyle]);

  // 2. Plot real road polylines, live station pins & markers whenever routeData or air updates
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    map.eachLayer((layer) => {
      if (layer instanceof L.Polyline || layer instanceof L.CircleMarker) {
        if (layer !== gpsMarkerRef.current) {
          map.removeLayer(layer);
        }
      }
    });

    // Plot live surrounding AQI monitoring stations subtly on the road map
    (air?.nearbyPoints || []).forEach((st) => {
      const cat = mapUsAqiToSpectrum(st.aqi);
      L.circleMarker([st.lat, st.lon], {
        radius: 5,
        color: '#0d1322',
        fillColor: cat.color,
        fillOpacity: 0.75,
        weight: 1.5
      })
        .bindPopup(
          `<strong>${st.name}</strong><br/>${st.isLiveStation ? 'Live WAQI Station' : 'Live Open-Meteo Grid'}<br/>AQI ${st.aqi} · PM2.5 ${st.pm25} µg/m³`
        )
        .addTo(map);
    });

    if (!routeData) {
      map.setView([fromPoint.lat, fromPoint.lon], 13);
      map.invalidateSize();
      return;
    }

    const fastLatLngs = routeData.fastest.points.map((p) => [p.lat, p.lon] as [number, number]);
    L.polyline(fastLatLngs, { color: '#ef4444', weight: 4.5, dashArray: '7 7', opacity: 0.8 })
      .bindPopup(`<strong>${routeData.fastest.label}</strong><br/>${routeData.fastest.distanceKm} km · ${routeData.fastest.durationMinutes} min<br/>Avg PM2.5: ${routeData.fastest.avgPm25} µg/m³`)
      .addTo(map);

    const cleanPts = routeData.cleanest.points;
    const cleanAllLatLngs = cleanPts.map((p) => [p.lat, p.lon] as [number, number]);
    // Dark outline casing so colored route pops crisply against bright real road tiles
    L.polyline(cleanAllLatLngs, { color: '#0d1322', weight: 9.5, opacity: 0.72 }).addTo(map);

    // Draw cleanly chunked color-coded segments for the real road polyline
    const chunkSize = Math.max(1, Math.floor(cleanPts.length / 28));
    for (let i = 0; i < cleanPts.length - 1; i += chunkSize) {
      const end = Math.min(cleanPts.length - 1, i + chunkSize);
      const segCoords = cleanPts.slice(i, end + 1).map((p) => [p.lat, p.lon] as [number, number]);
      const segColor = mapUsAqiToSpectrum(cleanPts[i].aqi).color;
      L.polyline(segCoords, { color: segColor, weight: 6, opacity: 0.96 })
        .bindPopup(
          `<strong>${routeData.cleanest.label}</strong><br/>Segment PM2.5: ${cleanPts[i].pm25} µg/m³ (AQI ${cleanPts[i].aqi})`
        )
        .addTo(map);
    }

    // Start & End markers
    const startPt = cleanPts[0] || fromPoint;
    const endPt = cleanPts[cleanPts.length - 1] || toPoint;
    L.circleMarker([startPt.lat, startPt.lon], {
      radius: 9,
      color: '#ffffff',
      fillColor: '#10b981',
      fillOpacity: 1,
      weight: 3
    })
      .bindPopup(`<strong>Start:</strong> ${routeData.fromLabel}`)
      .addTo(map);

    L.circleMarker([endPt.lat, endPt.lon], {
      radius: 9,
      color: '#ffffff',
      fillColor: '#f59e0b',
      fillOpacity: 1,
      weight: 3
    })
      .bindPopup(`<strong>Destination:</strong> ${routeData.toLabel}`)
      .addTo(map);

    // Key waypoint pins
    routeData.waypoints.slice(1, -1).forEach((wp) => {
      L.circleMarker([wp.lat, wp.lon], {
        radius: 6,
        color: '#1e293b',
        fillColor: '#ffc174',
        fillOpacity: 1,
        weight: 2
      })
        .bindPopup(`<strong>${wp.n}. ${wp.title}</strong><br/>${wp.detail}`)
        .addTo(map);
    });

    const bounds = L.latLngBounds([...cleanAllLatLngs, ...fastLatLngs]);
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });
    map.invalidateSize();
  }, [routeData, air, fromPoint.lat, fromPoint.lon]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      mapRef.current?.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
    };
  }, []);

  const handleUseMyGps = () => {
    if (!navigator.geolocation) {
      pushToast('GPS unavailable in this browser', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        let label = `My GPS (${lat.toFixed(3)}, ${lon.toFixed(3)})`;
        try {
          const rev = await api.reverseGeocode(lat, lon);
          if (rev.name) label = rev.name;
        } catch {
          // keep coordinate fallback
        }
        const updated = { lat, lon, label };
        setFromPoint(updated);
        setFromQuery(label);
        pushToast(`Origin updated to ${label}`, 'success');
        runRouteSearch(toPoint, updated);
      },
      () => pushToast('Location permission denied', 'error')
    );
  };

  const handleToggleNav = () => {
    if (!routeData) return;
    if (navActive) {
      setNavActive(false);
      stopSpeaking();
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      pushToast('Voice-guided navigation paused', 'info');
      return;
    }
    setNavActive(true);
    const wp = routeData.waypoints[activeWaypointIdx] || routeData.waypoints[0];
    if (wp) {
      speakText(`Starting clean-air route. Step ${wp.n}: ${wp.title}. ${wp.detail}`);
    }
    if (navigator.geolocation) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const map = mapRef.current;
          if (!map) return;
          const latLng: [number, number] = [pos.coords.latitude, pos.coords.longitude];
          if (gpsMarkerRef.current) {
            gpsMarkerRef.current.setLatLng(latLng);
          } else {
            gpsMarkerRef.current = L.circleMarker(latLng, {
              radius: 7,
              color: '#38bdf8',
              fillColor: '#38bdf8',
              fillOpacity: 0.9,
              weight: 2
            })
              .bindPopup('Your live GPS position')
              .addTo(map);
          }
        },
        () => undefined,
        { enableHighAccuracy: true, maximumAge: 5000 }
      );
    }
  };

  const handleNextWaypoint = () => {
    if (!routeData || routeData.waypoints.length === 0) return;
    const nextIdx = Math.min(routeData.waypoints.length - 1, activeWaypointIdx + 1);
    setActiveWaypointIdx(nextIdx);
    const wp = routeData.waypoints[nextIdx];
    speakText(`Step ${wp.n}: ${wp.title}. ${wp.detail}`);
    if (nextIdx === routeData.waypoints.length - 1) {
      pushToast('Final arrival waypoint reached!', 'success');
    }
  };

  const etaShareText = routeData
    ? `Travelling via Aetheria Clean-Air Route from ${routeData.fromLabel} to ${routeData.toLabel} (${routeData.cleanest.durationMinutes} mins, avg PM2.5 ${routeData.cleanest.avgPm25} µg/m³, ${routeData.exposureReductionPercent}% lower exposure).`
    : 'Travelling via Aetheria Clean-Air Route.';

  const handleShareEta = async () => {
    const res = await tryNativeShare({ title: 'Live Clean-Air Route ETA', text: etaShareText });
    if (res === 'fallback') setShareOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Route Planner Inputs */}
      <section data-tour="route-planner" className="rounded-2xl bg-surface-container-high/85 p-5 shadow-xl space-y-4 gilded-rim">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-label-sm uppercase tracking-widest text-primary font-bold">
              Real OpenStreetMap Roads · Exposure = Σ(Concentration × Time)
            </span>
            <h1 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
              {t('route.title')}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            {/* Travel Mode Switcher */}
            <div className="flex items-center gap-1 bg-surface-container rounded-xl p-1 text-xs">
              {(
                [
                  { id: 'foot', label: 'Walk', icon: 'directions_walk' },
                  { id: 'bike', label: 'Cycle', icon: 'directions_bike' },
                  { id: 'car', label: 'Drive', icon: 'directions_car' }
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setTravelMode(m.id);
                    runRouteSearch(toPoint, fromPoint, m.id);
                  }}
                  className={`px-2.5 py-1 rounded-lg font-semibold flex items-center gap-1 transition ${
                    travelMode === m.id ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-[15px]">{m.icon}</span>
                  <span>{m.label}</span>
                </button>
              ))}
            </div>

            {routeData && (
              <span className="px-3 py-1 rounded-full bg-secondary/20 text-secondary font-label-sm font-bold">
                -{routeData.exposureReductionPercent}% Exposure
              </span>
            )}
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            runRouteSearch();
          }}
          className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
        >
          <div className="md:col-span-5 relative">
            <label htmlFor="route-from" className="block text-xs text-on-surface-variant mb-1">From (Street, Landmark, or City)</label>
            <div className="flex gap-2">
              <input
                id="route-from"
                type="text"
                value={fromQuery}
                onChange={(e) => setFromQuery(e.target.value)}
                placeholder="Search starting street or landmark..."
                className="flex-1 px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
              />
              <button
                type="button"
                onClick={handleUseMyGps}
                aria-label="Use my GPS location"
                title="Use my GPS location"
                className="px-3 py-2 rounded-xl bg-surface-container text-primary hover:bg-surface-bright"
              >
                <span className="material-symbols-outlined text-[18px]">my_location</span>
              </button>
            </div>
            {fromResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-xl bg-surface-container-low border border-outline-variant/50 shadow-2xl max-h-48 overflow-y-auto">
                {fromResults.map((place) => (
                  <button
                    key={`from-${place.lat}-${place.lon}-${place.displayName}`}
                    type="button"
                    onClick={() => {
                      const nextFrom = { lat: place.lat, lon: place.lon, label: place.displayName };
                      setFromQuery(place.displayName);
                      setFromPoint(nextFrom);
                      setFromResults([]);
                      runRouteSearch(toPoint, nextFrom);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-surface-container-high text-sm text-on-surface"
                  >
                    {place.displayName}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="md:col-span-5 relative">
            <label htmlFor="route-to" className="block text-xs text-on-surface-variant mb-1">Destination (Park, School, Station, Street)</label>
            <div className="flex gap-2">
              <input
                id="route-to"
                type="text"
                value={toQuery}
                onChange={(e) => setToQuery(e.target.value)}
                placeholder="Search destination address or landmark..."
                className="flex-1 px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
              />
              <button
                type="button"
                onClick={() => {
                  const prevFrom = fromPoint;
                  const prevTo = toPoint;
                  setFromPoint(prevTo);
                  setFromQuery(prevTo.label);
                  setToPoint(prevFrom);
                  setToQuery(prevFrom.label);
                  setFromResults([]);
                  setToResults([]);
                  runRouteSearch(prevFrom, prevTo);
                }}
                aria-label="Swap start and destination"
                title="Swap start and destination"
                className="px-3 py-2 rounded-xl bg-surface-container text-on-surface-variant hover:text-primary hover:bg-surface-bright"
              >
                <span className="material-symbols-outlined text-[18px]">swap_horiz</span>
              </button>
            </div>
            {toResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-xl bg-surface-container-low border border-outline-variant/50 shadow-2xl max-h-48 overflow-y-auto">
                {toResults.map((place) => (
                  <button
                    key={`to-${place.lat}-${place.lon}-${place.displayName}`}
                    type="button"
                    onClick={() => {
                      const nextTo = { lat: place.lat, lon: place.lon, label: place.displayName };
                      setToQuery(place.displayName);
                      setToPoint(nextTo);
                      setToResults([]);
                      runRouteSearch(nextTo, fromPoint);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-surface-container-high text-sm text-on-surface"
                  >
                    {place.displayName}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-primary-container to-primary text-on-primary-container font-label-md font-bold"
            >
              {loading ? 'Routing...' : 'Find Route'}
            </button>
          </div>
        </form>

        {/* Real nearby destinations quick-select */}
        {nearbyChoices.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-on-surface-variant">Nearby real places:</span>
            {nearbyChoices.map((place) => (
              <button
                key={`near-${place.lat}-${place.lon}`}
                type="button"
                onClick={() => {
                  const nextTo = { lat: place.lat, lon: place.lon, label: place.displayName };
                  setToQuery(place.displayName);
                  setToPoint(nextTo);
                  runRouteSearch(nextTo, fromPoint);
                }}
                className="px-2.5 py-1 rounded-full bg-surface-container hover:bg-surface-container-highest text-on-surface transition"
              >
                {place.name}
              </button>
            ))}
          </div>
        )}
      </section>

      {error && <ErrorRetryCard message={error} onRetry={() => runRouteSearch()} />}

      {/* Map + Route Comparison (Real OpenStreetMap Road Map always visible immediately) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 space-y-3">
          {/* Map toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              {routeData ? (
                <span
                  className={`px-2.5 py-1 rounded-full font-bold ${
                    routeData.isRoadNetwork
                      ? 'bg-secondary/20 text-secondary'
                      : 'bg-error/20 text-error'
                  }`}
                >
                  {routeData.cleanest.provider}
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-full font-bold bg-surface-container text-primary">
                  OpenStreetMap Road Network
                </span>
              )}
              <span className="text-on-surface-variant hidden sm:inline">
                Tap map to pin {mapPickMode === 'to' ? 'Destination' : 'Start'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-surface-container rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setMapPickMode('to')}
                  className={`px-2 py-0.5 rounded font-semibold ${
                    mapPickMode === 'to' ? 'bg-primary text-on-primary' : 'text-on-surface-variant'
                  }`}
                >
                  Pin Dest
                </button>
                <button
                  type="button"
                  onClick={() => setMapPickMode('from')}
                  className={`px-2 py-0.5 rounded font-semibold ${
                    mapPickMode === 'from' ? 'bg-primary text-on-primary' : 'text-on-surface-variant'
                  }`}
                >
                  Pin Start
                </button>
              </div>
              <div className="flex items-center gap-1 bg-surface-container rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setMapStyle('road')}
                  className={`px-2 py-0.5 rounded font-semibold ${
                    mapStyle === 'road' ? 'bg-primary text-on-primary' : 'text-on-surface-variant'
                  }`}
                >
                  Road Map
                </button>
                <button
                  type="button"
                  onClick={() => setMapStyle('dark')}
                  className={`px-2 py-0.5 rounded font-semibold ${
                    mapStyle === 'dark' ? 'bg-primary text-on-primary' : 'text-on-surface-variant'
                  }`}
                >
                  Dark Map
                </button>
              </div>
            </div>
          </div>

          <div className="relative">
            <div
              ref={mapContainerRef}
              aria-label="Real road clean-air corridor map"
              className="w-full h-80 sm:h-96 rounded-2xl overflow-hidden bg-surface-container-lowest shadow-xl z-0"
            />
            {loading && (
              <div className="absolute top-3 start-3 z-[450] px-3 py-1.5 rounded-full bg-surface-container-lowest/90 backdrop-blur-md border border-primary/40 text-xs font-semibold text-primary flex items-center gap-2 shadow-lg pointer-events-none">
                <span className="material-symbols-outlined text-[15px] animate-spin">cyclone</span>
                <span>Computing real road corridors...</span>
              </div>
            )}
          </div>

          {tileError && (
            <div className="px-3 py-2 rounded-lg bg-primary/15 text-primary text-xs">
              Road map tiles could not load right now (offline/network blocked). Route lines and waypoints still reflect computed coordinates.
            </div>
          )}

          {routeData && !routeData.isRoadNetwork && (
            <div className="px-3 py-2 rounded-lg bg-error-container/30 border border-error/40 text-xs text-on-error-container">
              Live OpenStreetMap road routing APIs (ORS/Valhalla/OSRM) could not be reached — showing straight-line distance estimate instead of street geometry.
            </div>
          )}

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-on-surface-variant px-1">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-emerald-500 border border-white" /> Start
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-amber-500 border border-white" /> Destination
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-5 h-1 rounded bg-emerald-400" /> Cleanest Road (AQI-colored)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-5 h-0.5 border-t-2 border-dashed border-red-400" /> Direct Main Road
            </span>
          </div>

          {/* Best Departure Window Advisor */}
          {routeData && (
            <div className="p-3.5 rounded-xl bg-surface-container flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-tertiary">schedule</span>
                <div>
                  <div className="font-label-sm uppercase text-primary font-bold">
                    Best Departure (Next 3h): {routeData.bestDepartureWindow.label}
                  </div>
                  <div className="text-xs text-on-surface-variant">{routeData.bestDepartureWindow.reason}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-5 space-y-4">
          {loading && !routeData ? (
            <GlassSkeleton lines={5} />
          ) : routeData ? (
            <>
              {/* Comparison Cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 rounded-2xl bg-surface-container-high border border-secondary/40 space-y-1.5">
                  <div className="font-label-sm uppercase text-secondary font-bold">Cleanest Road</div>
                  <div className="font-headline-sm font-bold text-on-surface">{routeData.cleanest.avgPm25} µg/m³</div>
                  <div className="text-xs text-on-surface-variant">
                    {profile.units === 'imperial'
                      ? `${(routeData.cleanest.distanceKm * 0.621371).toFixed(2)} mi`
                      : `${routeData.cleanest.distanceKm} km`}{' '}
                    · {routeData.cleanest.durationMinutes} min
                  </div>
                  <div className="text-xs text-secondary font-semibold">
                    Exposure: {routeData.cleanest.cumulativeExposureUgMin} µg·min
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-surface-container space-y-1.5">
                  <div className="font-label-sm uppercase text-error font-bold">Direct Road</div>
                  <div className="font-headline-sm font-bold text-on-surface-variant">{routeData.fastest.avgPm25} µg/m³</div>
                  <div className="text-xs text-on-surface-variant">
                    {profile.units === 'imperial'
                      ? `${(routeData.fastest.distanceKm * 0.621371).toFixed(2)} mi`
                      : `${routeData.fastest.distanceKm} km`}{' '}
                    · {routeData.fastest.durationMinutes} min
                  </div>
                  <div className="text-xs text-error font-semibold">
                    Exposure: {routeData.fastest.cumulativeExposureUgMin} µg·min
                  </div>
                </div>
              </div>

              {/* Turn-by-turn Waypoints */}
              <div className="space-y-2">
                <h2 className="font-headline-sm text-on-surface font-semibold">Road Directions & Exposure</h2>
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {routeData.waypoints.map((wp, idx) => (
                    <button
                      key={`${wp.n}-${wp.title}`}
                      type="button"
                      onClick={() => {
                        setActiveWaypointIdx(idx);
                        mapRef.current?.setView([wp.lat, wp.lon], 15);
                        if (navActive) speakText(`Step ${wp.n}: ${wp.title}. ${wp.detail}`);
                      }}
                      className={`w-full text-left p-3 rounded-xl flex items-start gap-3 transition ${
                        activeWaypointIdx === idx
                          ? 'bg-surface-container-high border border-primary/50'
                          : 'bg-surface-container hover:bg-surface-container-high'
                      }`}
                    >
                      <span className="w-7 h-7 rounded-full bg-primary text-on-primary font-bold text-xs flex items-center justify-center shrink-0">
                        {wp.n}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between gap-2">
                          <span className="font-label-md font-semibold text-on-surface">{wp.title}</span>
                          <span className="text-xs text-primary shrink-0">{wp.etaLabel}</span>
                        </div>
                        <p className="text-xs text-on-surface-variant mt-0.5">{wp.detail}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Navigation & Save Actions */}
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleToggleNav}
                  className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-primary-container to-primary text-on-primary-container font-label-lg font-bold flex items-center justify-center gap-2 shadow-lg"
                >
                  <span className="material-symbols-outlined">navigation</span>
                  <span>
                    {navActive
                      ? `Voice Guidance Active • Step ${activeWaypointIdx + 1}`
                      : t('route.startNav')}
                  </span>
                </button>
                {navActive && (
                  <button
                    type="button"
                    onClick={handleNextWaypoint}
                    className="w-full py-2.5 px-4 rounded-xl bg-secondary-container text-on-secondary-container font-label-md font-bold flex items-center justify-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[18px]">skip_next</span>
                    <span>Next Step & Speak</span>
                  </button>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleShareEta}
                    className="py-2.5 px-3 rounded-xl bg-surface-container-high hover:bg-surface-bright text-on-surface font-label-md font-semibold flex items-center justify-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-primary text-[18px]">share_location</span>
                    <span>{t('route.shareEta')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      saveRoute({
                        id: `route-${Date.now()}`,
                        fromLabel: routeData.fromLabel,
                        toLabel: routeData.toLabel,
                        distanceKm: routeData.cleanest.distanceKm,
                        durationMinutes: routeData.cleanest.durationMinutes,
                        avgPm25: routeData.cleanest.avgPm25,
                        reductionPercent: routeData.exposureReductionPercent,
                        savedAt: new Date().toISOString()
                      });
                      pushToast('Route saved locally', 'success');
                    }}
                    className="py-2.5 px-3 rounded-xl bg-surface-container-high hover:bg-surface-bright text-secondary font-label-md font-semibold flex items-center justify-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[18px]">bookmark</span>
                    <span>Save Route</span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="p-4 rounded-2xl bg-surface-container text-sm text-on-surface-variant">
              Search a destination above or tap anywhere on the real road map to compare clean-air routes.
            </div>
          )}
        </div>
      </div>

      {savedRoutes.length > 0 && (
        <section className="rounded-2xl bg-surface-container-low p-4 space-y-2">
          <h3 className="font-label-md uppercase text-primary font-bold">Saved Routes</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {savedRoutes.map((sr) => (
              <div key={sr.id} className="p-3 rounded-xl bg-surface-container text-xs flex justify-between items-center">
                <span>{sr.fromLabel} → {sr.toLabel}</span>
                <span className="text-secondary font-bold">-{sr.reductionPercent}% exp</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title="Live Clean-Air Route ETA"
        text={etaShareText}
      />
    </div>
  );
};
