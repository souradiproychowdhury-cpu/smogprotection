import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { AirQualityData, RoutineResponse } from '@aetheria/shared';
import { AqiDetailsModal } from './components/AqiDetailsModal';
import { LanguageModal } from './components/LanguageModal';
import { Layout } from './components/Layout';
import { GlassSkeleton } from './components/LoadingSkeleton';
import { LocationModal } from './components/LocationModal';
import { ProfileSheet } from './components/ProfileSheet';
import { ToastContainer } from './components/ToastContainer';
import { api } from './lib/api';
import { idbGet, idbSet } from './lib/idb';
import { useAppStore } from './store/useAppStore';
import { TourOverlay } from './tutorial/TourOverlay';
import { VoiceAssistant } from './voice/VoiceAssistant';
import { WelcomeVoiceAssistant } from './voice/WelcomeVoiceAssistant';

const SanctuaryPage = lazy(() => import('./pages/SanctuaryPage').then((m) => ({ default: m.SanctuaryPage })));
const OraclePage = lazy(() => import('./pages/OraclePage').then((m) => ({ default: m.OraclePage })));
const ImpactPage = lazy(() => import('./pages/ImpactPage').then((m) => ({ default: m.ImpactPage })));
const VaultPage = lazy(() => import('./pages/VaultPage').then((m) => ({ default: m.VaultPage })));
const HealthPage = lazy(() => import('./pages/HealthPage').then((m) => ({ default: m.HealthPage })));
const AlertPage = lazy(() => import('./pages/AlertPage').then((m) => ({ default: m.AlertPage })));
const RoutePage = lazy(() => import('./pages/RoutePage').then((m) => ({ default: m.RoutePage })));
const TutorialPage = lazy(() => import('./pages/TutorialPage').then((m) => ({ default: m.TutorialPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Sanctuary | Aetheria',
  '/oracle': 'Smog Oracle | Aetheria',
  '/impact': 'Community Impact | Aetheria',
  '/vault': 'Lifestyle Vault | Aetheria',
  '/health': 'Health Shield | Aetheria',
  '/alert': 'Inversion Alert | Aetheria',
  '/route': 'Clean-Air Route | Aetheria',
  '/tutorial': 'Tutorial Library | Aetheria',
  '/settings': 'Settings & Setup | Aetheria'
};

const AppShell: React.FC = () => {
  const location = useLocation();
  const profile = useAppStore((s) => s.profile);
  const updateProfile = useAppStore((s) => s.updateProfile);
  const language = useAppStore((s) => s.language);
  const air = useAppStore((s) => s.air);
  const setAir = useAppStore((s) => s.setAir);
  const setAirLoading = useAppStore((s) => s.setAirLoading);
  const setAirError = useAppStore((s) => s.setAirError);
  const setRoutine = useAppStore((s) => s.setRoutine);
  const setOffline = useAppStore((s) => s.setOffline);
  const setServerMeta = useAppStore((s) => s.setServerMeta);
  const fontSizeOffset = useAppStore((s) => s.a11y.fontSizeOffset);
  const pushToast = useAppStore((s) => s.pushToast);

  const [aqiDetailsOpen, setAqiDetailsOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(!language.chosenByUser);
  const [profileOpen, setProfileOpen] = useState(false);
  const [routineLoading, setRoutineLoading] = useState(false);

  // Sync document title per route
  useEffect(() => {
    document.title = ROUTE_TITLES[location.pathname] || 'Aetheria — Clean-Air Sanctuary';
  }, [location.pathname]);

  // Apply font scale CSS variable
  useEffect(() => {
    const scale = 1 + fontSizeOffset * 0.1;
    document.documentElement.style.setProperty('--aetheria-font-scale', String(scale));
  }, [fontSizeOffset]);

  // Network online/offline listeners
  useEffect(() => {
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [setOffline]);

  // Fetch backend metadata (emergency number, VAPID key)
  useEffect(() => {
    api
      .health()
      .then((h) =>
        setServerMeta({
          emergencyNumber: h.emergencyNumber || '112',
          vapidPublicKey: h.vapidPublicKey
        })
      )
      .catch(() => undefined);
  }, [setServerMeta]);

  // Hydrate cached air & routine from IndexedDB on cold/offline startup
  useEffect(() => {
    if (!useAppStore.getState().air) {
      idbGet<AirQualityData>('last-air').then((cachedAir) => {
        if (cachedAir && !useAppStore.getState().air) {
          setAir(cachedAir);
        }
      });
    }
    if (!useAppStore.getState().routine) {
      idbGet<RoutineResponse>('last-routine').then((cachedRoutine) => {
        if (cachedRoutine && !useAppStore.getState().routine) {
          setRoutine(cachedRoutine);
        }
      });
    }
  }, [setAir, setRoutine]);

  const fetchRoutine = useCallback(
    async (lat: number, lon: number, name?: string) => {
      setRoutineLoading(true);
      try {
        const res = await api.generateRoutine({
          language: language.englishName || language.nativeName,
          profile: useAppStore.getState().profile,
          lat,
          lon,
          locationName: name,
          localTime: new Date().toLocaleTimeString()
        });
        setRoutine(res.data);
        await idbSet('last-routine', res.data);
      } catch {
        // Keep last cached routine if offline
      } finally {
        setRoutineLoading(false);
      }
    },
    [language.englishName, language.nativeName, setRoutine]
  );

  const refreshAir = useCallback(
    async (overrideLoc?: { lat: number; lon: number; name: string }) => {
      const target = overrideLoc || useAppStore.getState().profile.location || { lat: 28.6139, lon: 77.209, name: 'New Delhi, India' };
      setAirLoading(true);
      try {
        const data = await api.getAir(target.lat, target.lon, target.name);
        setAir(data);
        setOffline(false);
        await idbSet('last-air', data);
        fetchRoutine(data.lat, data.lon, data.locationName);
      } catch (err) {
        if (!navigator.onLine) {
          setOffline(true);
        }
        const hasCachedAir = Boolean(useAppStore.getState().air);
        setAirError(
          hasCachedAir
            ? 'Showing last cached air readings (live refresh failed).'
            : err instanceof Error
            ? err.message
            : 'Unable to fetch live air quality'
        );
      } finally {
        setAirLoading(false);
      }
    },
    [fetchRoutine, setAir, setAirError, setAirLoading, setOffline]
  );

  // Re-generate routine when language or key home/commute settings change (debounced)
  useEffect(() => {
    const currentAir = useAppStore.getState().air;
    if (!currentAir) return;
    const timer = setTimeout(() => {
      const latestAir = useAppStore.getState().air;
      if (latestAir) {
        fetchRoutine(latestAir.lat, latestAir.lon, latestAir.locationName);
      }
    }, 650);
    return () => clearTimeout(timer);
  }, [
    language.code,
    profile.windowsSealed,
    profile.purifierRunning,
    profile.fuel,
    profile.transport,
    fetchRoutine
  ]);

  // Initial fetch + 10-minute auto-refresh + tab focus refresh
  useEffect(() => {
    refreshAir();
    const interval = setInterval(() => refreshAir(), 10 * 60 * 1000);
    const onVis = () => {
      if (document.visibilityState === 'visible') refreshAir();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [profile.location?.lat, profile.location?.lon, profile.location?.name]);

  const handleLocationChanged = (loc: { name: string; country?: string; lat: number; lon: number }) => {
    updateProfile({ location: loc });
    pushToast(`Location updated to ${loc.name}`, 'success');
    refreshAir(loc);
  };

  return (
    <Layout
      onOpenAqiDetails={() => setAqiDetailsOpen(true)}
      onOpenLanguage={() => setLanguageOpen(true)}
      onOpenProfile={() => setProfileOpen(true)}
    >
      <Suspense fallback={<GlassSkeleton lines={5} />}>
        <Routes>
          <Route
            path="/"
            element={
              <SanctuaryPage
                onRefreshAir={() => refreshAir()}
                onRegenerateRoutine={() =>
                  air && fetchRoutine(air.lat, air.lon, air.locationName)
                }
                onOpenLocation={() => setLocationOpen(true)}
                routineLoading={routineLoading}
              />
            }
          />
          <Route path="/oracle" element={<OraclePage />} />
          <Route path="/impact" element={<ImpactPage />} />
          <Route path="/vault" element={<VaultPage />} />
          <Route path="/health" element={<HealthPage />} />
          <Route path="/alert" element={<AlertPage />} />
          <Route path="/route" element={<RoutePage />} />
          <Route path="/tutorial" element={<TutorialPage />} />
          <Route
            path="/settings"
            element={
              <SettingsPage
                onOpenProfile={() => setProfileOpen(true)}
                onOpenLanguage={() => setLanguageOpen(true)}
                onOpenLocation={() => setLocationOpen(true)}
              />
            }
          />
        </Routes>
      </Suspense>

      <AqiDetailsModal
        open={aqiDetailsOpen}
        onClose={() => setAqiDetailsOpen(false)}
        onOpenLocation={() => setLocationOpen(true)}
      />
      <LocationModal
        open={locationOpen}
        onClose={() => setLocationOpen(false)}
        onLocationChanged={handleLocationChanged}
      />
      <LanguageModal
        open={languageOpen}
        onClose={() => {
          if (!language.chosenByUser) {
            useAppStore.getState().setLanguage({ ...language, chosenByUser: true });
          }
          setLanguageOpen(false);
        }}
        isFirstRun={!language.chosenByUser}
      />
      <ProfileSheet
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onOpenLocation={() => setLocationOpen(true)}
        onOpenLanguage={() => setLanguageOpen(true)}
      />
      <TourOverlay />
      <VoiceAssistant />
      <WelcomeVoiceAssistant />
      <ToastContainer />
    </Layout>
  );
};

export function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

export default App;
