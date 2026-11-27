import React, { useEffect, useState } from 'react';
import { api, type GeocodedPlace } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { ModalDialog } from './ModalDialog';

interface LocationModalProps {
  open: boolean;
  onClose: () => void;
  onLocationChanged: (loc: { name: string; country?: string; lat: number; lon: number }) => void;
}

const POPULAR_CITIES = [
  { name: 'New Delhi, India', country: 'India', lat: 28.6139, lon: 77.209 },
  { name: 'Lahore, Pakistan', country: 'Pakistan', lat: 31.5204, lon: 74.3587 },
  { name: 'Kolkata, India', country: 'India', lat: 22.5726, lon: 88.3639 },
  { name: 'London, United Kingdom', country: 'United Kingdom', lat: 51.5074, lon: -0.1278 }
];

export const LocationModal: React.FC<LocationModalProps> = ({ open, onClose, onLocationChanged }) => {
  const pushToast = useAppStore((s) => s.pushToast);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodedPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.geocode(query);
        setResults(res.results);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const handleUseGps = () => {
    if (!navigator.geolocation) {
      pushToast('GPS is not supported in this browser. Search for your city below.', 'error');
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        let name = `My GPS (${lat.toFixed(2)}, ${lon.toFixed(2)})`;
        try {
          const rev = await api.reverseGeocode(lat, lon);
          if (rev.name) name = rev.name;
        } catch {
          // keep coordinate fallback
        }
        setGpsLoading(false);
        onLocationChanged({ name, lat, lon });
        onClose();
      },
      () => {
        setGpsLoading(false);
        pushToast('Location permission denied. Please choose your city below.', 'info');
      },
      { timeout: 8000 }
    );
  };

  return (
    <ModalDialog open={open} onClose={onClose} title="Set Your Location">
      <div className="space-y-4">
        <button
          type="button"
          onClick={handleUseGps}
          disabled={gpsLoading}
          className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-gradient-to-r from-primary-container to-primary text-on-primary-container font-label-lg text-label-lg font-bold flex items-center justify-center gap-2 shadow-lg"
        >
          <span className="material-symbols-outlined text-[20px]">my_location</span>
          <span>{gpsLoading ? 'Detecting GPS...' : 'Use Current GPS Location'}</span>
        </button>

        <div>
          <label htmlFor="city-search-input" className="block font-label-md text-label-md text-on-surface-variant mb-1.5">
            Search any city or town
          </label>
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-surface-container-lowest border border-outline-variant/60">
            <span className="material-symbols-outlined text-primary text-[18px]">search</span>
            <input
              id="city-search-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Delhi, Mumbai, Lahore, London..."
              className="w-full bg-transparent text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none"
            />
          </div>
        </div>

        {searching && <div className="text-xs text-primary">Searching Open-Meteo directory...</div>}

        {results.length > 0 && (
          <div className="space-y-1.5">
            {results.map((r) => (
              <button
                key={`${r.lat}-${r.lon}-${r.displayName}`}
                type="button"
                onClick={() => {
                  onLocationChanged({ name: r.displayName, country: r.country, lat: r.lat, lon: r.lon });
                  onClose();
                }}
                className="w-full text-left px-3.5 py-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high flex items-center justify-between transition"
              >
                <span className="font-body-md text-body-md text-on-surface">{r.displayName}</span>
                <span className="material-symbols-outlined text-primary text-[18px]">chevron_right</span>
              </button>
            ))}
          </div>
        )}

        <div className="space-y-2 pt-2 border-t border-outline-variant/30">
          <div className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
            Quick Select Cities
          </div>
          <div className="grid grid-cols-2 gap-2">
            {POPULAR_CITIES.map((city) => (
              <button
                key={city.name}
                type="button"
                onClick={() => {
                  onLocationChanged(city);
                  onClose();
                }}
                className="px-3 py-2 rounded-xl bg-surface-container-high hover:bg-surface-bright text-left text-sm text-on-surface transition"
              >
                {city.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </ModalDialog>
  );
};
