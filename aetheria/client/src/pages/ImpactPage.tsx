import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { mapUsAqiToSpectrum } from '@aetheria/shared';
import { ErrorRetryCard, GlassSkeleton } from '../components/LoadingSkeleton';
import { ModalDialog } from '../components/ModalDialog';
import { ShareModal } from '../components/ShareModal';
import { api, type CommunitySummary } from '../lib/api';
import { tryNativeShare } from '../lib/share';
import { useAppStore } from '../store/useAppStore';
import { useTranslation } from '../i18n/useTranslation';

export const ImpactPage: React.FC = () => {
  const { t, formatNumber } = useTranslation();
  const air = useAppStore((s) => s.air);
  const airError = useAppStore((s) => s.airError);
  const airLoading = useAppStore((s) => s.airLoading);
  const setAir = useAppStore((s) => s.setAir);
  const setAirLoading = useAppStore((s) => s.setAirLoading);
  const setAirError = useAppStore((s) => s.setAirError);
  const profile = useAppStore((s) => s.profile);
  const deviceId = useAppStore((s) => s.deviceId);
  const vaultChecklist = useAppStore((s) => s.vaultChecklist);
  const vaultBookmarks = useAppStore((s) => s.vaultBookmarks);
  const completedRoutineByDate = useAppStore((s) => s.completedRoutineByDate);
  const pushToast = useAppStore((s) => s.pushToast);

  const areaName = (profile.location?.name || air?.locationName || 'Local Neighbourhood').slice(0, 220);

  const refreshLiveStations = async () => {
    const lat = profile.location?.lat ?? air?.lat ?? 28.6139;
    const lon = profile.location?.lon ?? air?.lon ?? 77.209;
    const name = profile.location?.name ?? air?.locationName;
    setAirLoading(true);
    try {
      const fresh = await api.getAir(lat, lon, name);
      setAir(fresh);
    } catch (err) {
      setAirError(err instanceof Error ? err.message : 'Unable to fetch live station data');
    } finally {
      setAirLoading(false);
    }
  };

  const [community, setCommunity] = useState<CommunitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'adoption' | 'co2'>('adoption');
  const [mapStyle, setMapStyle] = useState<'road' | 'dark'>('road');
  const [tileError, setTileError] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [contactHint, setContactHint] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markerMapRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const communityReady = Boolean(community);

  const fetchCommunity = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getCommunity(areaName, deviceId);
      setCommunity(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load community data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCommunity();
  }, [areaName, deviceId]);

  // 1. Initialize Leaflet map & switch tile layers with automatic OSM -> Carto Voyager fallback
  useEffect(() => {
    if (!communityReady || !mapContainerRef.current) return;
    const centerLat = air?.lat ?? profile.location?.lat ?? 28.6139;
    const centerLon = air?.lon ?? profile.location?.lon ?? 77.209;

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = L.map(mapContainerRef.current, {
        center: [centerLat, centerLon],
        zoom: 12,
        zoomControl: true,
        attributionControl: true
      });
    }

    const map = mapInstanceRef.current;

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
  }, [communityReady, mapStyle]);

  // 2. Plot live monitoring station markers whenever `air` or location updates
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!communityReady || !map) return;

    const centerLat = air?.lat ?? profile.location?.lat ?? 28.6139;
    const centerLon = air?.lon ?? profile.location?.lon ?? 77.209;

    markerMapRef.current.forEach((m) => map.removeLayer(m));
    markerMapRef.current.clear();

    const points = air?.nearbyPoints?.length ? air.nearbyPoints : [];
    const bounds = L.latLngBounds([]);

    points.forEach((pt) => {
      const cat = mapUsAqiToSpectrum(pt.aqi);
      const badge = pt.isLiveStation ? 'Live WAQI Station' : 'Live Open-Meteo Grid';
      const marker = L.circleMarker([pt.lat, pt.lon], {
        radius: 12,
        color: '#0d1322',
        fillColor: cat.color,
        fillOpacity: 0.85,
        weight: 2.5
      })
        .bindPopup(
          `<strong>${pt.name}</strong><br/>` +
            `<span style="font-size:11px;opacity:0.8">${badge}${typeof pt.distanceKm === 'number' ? ` · ${pt.distanceKm} km away` : ''}</span><br/>` +
            `US AQI: <strong>${pt.aqi}</strong> (${cat.shortLabel})<br/>PM2.5: ${pt.pm25} µg/m³`
        )
        .addTo(map);
      markerMapRef.current.set(`${pt.name}-${pt.lat.toFixed(4)}`, marker);
      bounds.extend([pt.lat, pt.lon]);
    });

    if (bounds.isValid() && points.length > 1) {
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 13 });
    } else if (points.length === 1) {
      map.setView([points[0].lat, points[0].lon], 13);
    } else {
      map.setView([centerLat, centerLon], 12);
    }
    map.invalidateSize();
  }, [communityReady, air, profile.location?.lat, profile.location?.lon]);

  useEffect(() => {
    return () => {
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
      tileLayerRef.current = null;
    };
  }, []);

  const handlePledge = async (pledgeType: 'stove_curfew' | 'no_waste_burning' | 'no_idle_carpool') => {
    try {
      const res = await api.pledge({ deviceId, area: areaName, pledgeType });
      setCommunity(res.community);
      pushToast(
        res.alreadyPledgedToday
          ? 'You already recorded this pledge today — thank you!'
          : 'Pledge recorded! Community totals updated.',
        res.alreadyPledgedToday ? 'info' : 'success'
      );
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to save pledge', 'error');
    }
  };

  const handleJoinSolidarity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consentChecked) {
      pushToast('Please check the consent box first.', 'error');
      return;
    }
    try {
      const res = await api.joinSolidarity({
        deviceId,
        area: areaName,
        contactHint,
        consentGiven: true
      });
      setCommunity(res.community);
      setJoinOpen(false);
      pushToast('Joined the Solidarity Clean-Air Protocol!', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to join', 'error');
    }
  };

  const sortedLeaderboard = useMemo(() => {
    const list = [...(community?.leaderboard || [])];
    return list.sort((a, b) =>
      sortBy === 'adoption' ? b.adoptionPercent - a.adoptionPercent : b.co2AvoidedKg - a.co2AvoidedKg
    );
  }, [community?.leaderboard, sortBy]);

  const sortedStations = useMemo(() => {
    return [...(air?.nearbyPoints || [])].sort((a, b) => a.aqi - b.aqi);
  }, [air?.nearbyPoints]);

  const userPledgedCount = community?.pledges.filter((p) => p.userPledgedToday).length || 0;
  const checklistDoneCount = vaultChecklist.filter((c) => c.checked).length;
  const routineDaysCount = Object.values(completedRoutineByDate).filter((arr) => arr.length > 0).length;

  const badges = [
    {
      id: 'first-pledge',
      title: 'Civic Pledge Keeper',
      desc: 'Take any daily clean-air pledge',
      unlocked: userPledgedCount >= 1,
      icon: 'handshake'
    },
    {
      id: 'home-shield',
      title: 'Sanctuary Sealer',
      desc: 'Complete 2+ Vault checklist actions',
      unlocked: checklistDoneCount >= 2,
      icon: 'shield_with_house'
    },
    {
      id: 'knowledge-keeper',
      title: 'Protocol Archivist',
      desc: 'Bookmark an Oracle or Vault play',
      unlocked: vaultBookmarks.length >= 1,
      icon: 'bookmark'
    },
    {
      id: 'daily-streak',
      title: 'Routine Guardian',
      desc: 'Complete routine steps today',
      unlocked: routineDaysCount >= 1,
      icon: 'workspace_premium'
    }
  ];

  const inviteText = `Join the ${areaName} Clean-Air Guild on Aetheria! Track live smog levels, learn zero-smoke indoor hacks, and pledge cleaner winter air habits.`;

  const handleInvite = async () => {
    const res = await tryNativeShare({ title: `${areaName} Clean-Air Guild`, text: inviteText });
    if (res === 'fallback') setShareOpen(true);
  };

  return (
    <div className="space-y-6">
      {error && <ErrorRetryCard message={error} onRetry={fetchCommunity} />}

      {loading && !community ? (
        <GlassSkeleton lines={6} />
      ) : community ? (
        <>
          {/* Hero Community Shield Banner */}
          <section
            data-tour="impact-hero"
            className="relative rounded-2xl bg-surface-container-low p-5 shadow-xl overflow-hidden gilded-rim space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">shield</span>
                <span className="font-label-sm uppercase tracking-widest text-primary font-bold">
                  {t('impact.guildTitle')}
                </span>
              </div>
              <span className="px-2.5 py-0.5 rounded-full font-label-sm font-bold uppercase bg-secondary/20 text-secondary">
                Live Verified Data
              </span>
            </div>

            <div>
              <h1 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                {community.area} Clean Air Guild
              </h1>
              <p className="font-label-md text-on-surface-variant flex items-center gap-1.5 mt-1">
                <span className="material-symbols-outlined text-primary text-[16px]">groups</span>
                <span className="text-primary font-bold">{formatNumber(community.residentsPledged)}</span>
                <span>Verified Participating Households · {formatNumber(community.totalRealPledges)} Pledges</span>
              </p>
              <p className="text-xs text-on-surface-variant mt-1">{community.seedNotice}</p>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div className="p-3 rounded-xl bg-surface-container">
                <div className="font-label-sm text-on-surface-variant uppercase">CO₂ Avoided</div>
                <div className="font-headline-sm text-primary font-bold">
                  {formatNumber(community.totalCo2AvoidedKg)} <span className="text-xs">kg</span>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-surface-container">
                <div className="font-label-sm text-on-surface-variant uppercase">Est. PM2.5 Cut</div>
                <div className="font-headline-sm text-secondary font-bold">
                  {formatNumber(community.totalUgM3Avoided)} <span className="text-xs">µg·h/m³</span>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-surface-container">
                <div className="font-label-sm text-on-surface-variant uppercase">Pledge Rate</div>
                <div className="font-headline-sm text-tertiary font-bold">{community.adoptionPercent}%</div>
              </div>
            </div>
          </section>

          {/* Desktop 12-col split: Live Map + Nearby Real Stations / Area Leaderboard */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Live Station & Neighbourhood Road Map */}
            <section
              data-tour="impact-map"
              className="lg:col-span-6 rounded-2xl bg-surface-container-low p-4 shadow-xl space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-tertiary text-[20px]">radar</span>
                  <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                    {t('impact.corridorsTitle')}
                  </h2>
                </div>
                <div className="flex items-center gap-1 bg-surface-container rounded-lg p-1 text-xs">
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

              <div
                ref={mapContainerRef}
                aria-label="Neighborhood live air quality stations map"
                className="w-full h-72 rounded-xl overflow-hidden bg-surface-container-lowest z-0"
              />

              {tileError && (
                <div className="px-3 py-2 rounded-lg bg-primary/15 text-primary text-xs">
                  Map road tiles could not be downloaded right now (network/offline). Station data below remains live if available.
                </div>
              )}

              {!air ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-on-surface-variant">
                  <span>
                    {airError
                      ? `Live station feed error: ${airError}`
                      : `Loading live air quality stations around ${areaName}...`}
                  </span>
                  <button
                    type="button"
                    onClick={refreshLiveStations}
                    disabled={airLoading}
                    className="px-2.5 py-1 rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-50"
                  >
                    {airLoading ? 'Refreshing...' : 'Retry Stations'}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2 text-xs text-on-surface-variant">
                    {(air.nearbyPoints || []).map((pt) => {
                      const c = mapUsAqiToSpectrum(pt.aqi);
                      return (
                        <button
                          key={`${pt.name}-${pt.lat.toFixed(3)}`}
                          type="button"
                          onClick={() => {
                            const marker = markerMapRef.current.get(`${pt.name}-${pt.lat.toFixed(4)}`);
                            mapInstanceRef.current?.setView([pt.lat, pt.lon], 13);
                            marker?.openPopup();
                          }}
                          className="px-2.5 py-1 rounded-full bg-surface-container hover:bg-surface-container-high flex items-center gap-1.5 transition"
                        >
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                          <span className="truncate max-w-[180px]">{pt.name}: AQI {pt.aqi}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-on-surface-variant pt-1">
                    <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#059669]" /> 0–25 Pristine</span>
                    <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#10B981]" /> 26–75 Temperate</span>
                    <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#F59E0B]" /> 76–150 Elevated</span>
                    <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#E11D48]" /> 151+ Severe</span>
                  </div>
                </div>
              )}
            </section>

            {/* Real Nearby Monitoring Stations Comparison + Verified Guilds */}
            <section className="lg:col-span-6 rounded-2xl bg-surface-container-low p-4 shadow-xl space-y-4">
              {sortedStations.length > 0 ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-secondary text-[20px]">sensors</span>
                      <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                        Live Nearby Monitoring Stations
                      </h2>
                    </div>
                    <span className="text-xs text-on-surface-variant">Cleanest → Highest</span>
                  </div>
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {sortedStations.map((st) => {
                      const cat = mapUsAqiToSpectrum(st.aqi);
                      return (
                        <button
                          key={`${st.name}-${st.lat.toFixed(4)}`}
                          type="button"
                          onClick={() => {
                            const marker = markerMapRef.current.get(`${st.name}-${st.lat.toFixed(4)}`);
                            mapInstanceRef.current?.setView([st.lat, st.lon], 13);
                            marker?.openPopup();
                          }}
                          className="w-full text-left p-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high flex items-center justify-between gap-3 transition"
                        >
                          <div className="min-w-0">
                            <div className="font-body-sm font-semibold text-on-surface truncate">{st.name}</div>
                            <div className="text-[11px] text-on-surface-variant">
                              {st.isLiveStation ? 'WAQI Station' : 'Open-Meteo Grid'}
                              {typeof st.distanceKm === 'number' && st.distanceKm > 0 ? ` · ${st.distanceKm} km away` : ' · Nearest'}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-label-md font-bold" style={{ color: cat.textColor }}>
                              AQI {st.aqi}
                            </div>
                            <div className="text-[11px] text-on-surface-variant">PM2.5 {st.pm25} µg/m³</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-surface-container text-xs text-on-surface-variant">
                  Live nearby monitoring station readings are unavailable right now. Check Settings if air providers are unreachable.
                </div>
              )}

              <div className="space-y-2.5 pt-2 border-t border-outline-variant/25">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-[20px]">military_tech</span>
                    <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                      {t('impact.leaderboardTitle')}
                    </h2>
                  </div>
                  <div className="flex items-center gap-1 bg-surface-container rounded-lg p-1 text-xs">
                    <button
                      type="button"
                      onClick={() => setSortBy('adoption')}
                      className={`px-2.5 py-1 rounded-md font-semibold ${
                        sortBy === 'adoption' ? 'bg-primary text-on-primary' : 'text-on-surface-variant'
                      }`}
                    >
                      Pledge %
                    </button>
                    <button
                      type="button"
                      onClick={() => setSortBy('co2')}
                      className={`px-2.5 py-1 rounded-md font-semibold ${
                        sortBy === 'co2' ? 'bg-primary text-on-primary' : 'text-on-surface-variant'
                      }`}
                    >
                      CO₂ Saved
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  {sortedLeaderboard.map((row, idx) => (
                    <div
                      key={row.id}
                      className={`p-3 rounded-xl flex items-center justify-between gap-3 ${
                        row.isCurrentArea ? 'bg-primary/15 border border-primary/40' : 'bg-surface-container'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-8 h-8 rounded-full bg-surface-container-high text-primary font-bold flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="font-body-md font-semibold text-on-surface truncate">{row.name}</div>
                          <div className="font-body-sm text-secondary truncate">{row.highlight}</div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-label-md font-bold text-primary">{row.adoptionPercent}%</div>
                        <div className="text-xs text-on-surface-variant">{row.co2AvoidedKg} kg CO₂</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          {/* Solidarity Protocol Pledges */}
          <section data-tour="impact-pledges" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                {t('impact.solidarityTitle')}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setJoinOpen(true)}
                  className="px-3.5 py-1.5 rounded-xl bg-secondary-container text-on-secondary-container font-label-md font-bold"
                >
                  {community.userJoinedSolidarity ? 'Solidarity Member ✓' : 'Join Guild Updates'}
                </button>
                <button
                  type="button"
                  onClick={handleInvite}
                  className="px-3.5 py-1.5 rounded-xl bg-surface-container-high hover:bg-surface-bright text-primary font-label-md font-semibold flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">share</span>
                  <span>Invite Neighbours</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {community.pledges.map((p) => (
                <div key={p.type} className="rounded-2xl bg-surface-container-low p-4 shadow-lg flex flex-col justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded-lg bg-primary-container/20 flex items-center justify-center text-primary shrink-0">
                          <span className="material-symbols-outlined text-[20px]">{p.icon}</span>
                        </div>
                        <div>
                          <h3 className="font-body-md font-semibold text-on-surface">{p.title}</h3>
                          <span className="font-label-sm text-secondary font-medium">
                            {formatNumber(p.totalCount)} Verified Pledge{p.totalCount === 1 ? '' : 's'}
                          </span>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-surface-container-high font-label-sm text-on-surface-variant shrink-0">
                        {p.windowLabel}
                      </span>
                    </div>
                    <p className="font-body-sm text-on-surface-variant">{p.description}</p>
                    <div className="text-xs text-tertiary font-medium">{p.pm25ImpactLabel}</div>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      handlePledge(p.type as 'stove_curfew' | 'no_waste_burning' | 'no_idle_carpool')
                    }
                    className={`w-full py-2.5 px-4 rounded-xl font-label-md font-bold flex items-center justify-center gap-2 transition ${
                      p.userPledgedToday
                        ? 'bg-secondary-container text-on-secondary-container'
                        : 'bg-gradient-to-r from-primary-container to-primary text-on-primary-container hover:brightness-110'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {p.userPledgedToday ? 'check_circle' : 'handshake'}
                    </span>
                    <span>{p.userPledgedToday ? 'Pledged Today ✓' : 'Take Pledge Today'}</span>
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Achievement Badges Shelf */}
          <section className="rounded-2xl bg-surface-container-low p-4 space-y-3">
            <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
              Achievement Shelf
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {badges.map((b) => (
                <div
                  key={b.id}
                  className={`p-3 rounded-xl border flex flex-col gap-1.5 ${
                    b.unlocked
                      ? 'bg-primary/15 border-primary/40 text-on-surface'
                      : 'bg-surface-container border-outline-variant/20 text-on-surface-variant opacity-60'
                  }`}
                >
                  <span className={`material-symbols-outlined text-[24px] ${b.unlocked ? 'text-primary' : 'text-outline'}`}>
                    {b.icon}
                  </span>
                  <div className="font-label-md font-bold">{b.title}</div>
                  <div className="text-xs">{b.desc}</div>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {/* Solidarity Join Modal */}
      <ModalDialog open={joinOpen} onClose={() => setJoinOpen(false)} title="Join Solidarity Protocol">
        <form onSubmit={handleJoinSolidarity} className="space-y-4">
          <p className="text-sm text-on-surface-variant">
            Receive community air-alert updates for <strong>{areaName}</strong>. Contact info is optional and never shared publicly.
          </p>
          <div>
            <label htmlFor="solidarity-contact" className="block font-label-md text-on-surface-variant mb-1">
              Optional Phone or Email
            </label>
            <input
              id="solidarity-contact"
              type="text"
              value={contactHint}
              onChange={(e) => setContactHint(e.target.value)}
              placeholder="Optional phone or email"
              className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
            />
          </div>
          <label className="flex items-start gap-2.5 text-sm text-on-surface cursor-pointer">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              className="mt-1 w-4 h-4 accent-amber-500"
            />
            <span>I consent to join the {areaName} Clean-Air Solidarity Protocol locally with my anonymous device ID.</span>
          </label>
          <button
            type="submit"
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-primary-container to-primary text-on-primary-container font-label-lg font-bold"
          >
            Confirm Membership
          </button>
        </form>
      </ModalDialog>

      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title={`${areaName} Clean-Air Guild`}
        text={inviteText}
      />
    </div>
  );
};
