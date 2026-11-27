import React from 'react';
import { mapUsAqiToSpectrum } from '@aetheria/shared';
import { useAppStore } from '../store/useAppStore';
import { useTranslation } from '../i18n/useTranslation';
import { ModalDialog } from './ModalDialog';

interface AqiDetailsModalProps {
  open: boolean;
  onClose: () => void;
  onOpenLocation: () => void;
}

export const AqiDetailsModal: React.FC<AqiDetailsModalProps> = ({ open, onClose, onOpenLocation }) => {
  const air = useAppStore((s) => s.air);
  const { formatTime } = useTranslation();

  const cat = mapUsAqiToSpectrum(air?.aqi ?? 0);

  return (
    <ModalDialog open={open} onClose={onClose} title="Live Atmospheric Telemetry">
      {!air ? (
        <p className="text-body-sm text-on-surface-variant">Loading live air quality readings...</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-xl bg-surface-container border border-outline-variant/40">
            <div>
              <div className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                {air.locationName}
              </div>
              <div className="font-headline-md text-headline-md font-bold" style={{ color: cat.textColor }}>
                US AQI {air.aqi} · <span className="italic">{cat.accentWord}</span>
              </div>
              <div className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                {cat.usEpaBand}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenLocation();
              }}
              className="px-3 py-2 rounded-lg bg-surface-container-high hover:bg-surface-bright text-primary font-label-md text-label-md font-semibold"
            >
              Change City
            </button>
          </div>

          <p className="font-body-sm text-body-sm text-on-surface leading-relaxed">{cat.adviceSummary}</p>

          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'PM2.5', value: `${air.pm25} µg/m³` },
              { label: 'PM10', value: `${air.pm10} µg/m³` },
              { label: 'NO₂', value: `${air.no2} µg/m³` },
              { label: 'O₃', value: `${air.o3} µg/m³` },
              { label: 'Wind', value: `${air.windSpeed} m/s` },
              { label: 'Temp / RH', value: `${air.temperature}°C · ${air.humidity}%` },
              { label: 'Boundary Layer', value: `${air.boundaryLayerHeight} m` },
              { label: 'WHO Multiple', value: `${air.whoMultiple}×` },
              { label: 'Inversion', value: air.inversionDetected ? 'Active' : 'Clear' }
            ].map((item) => (
              <div key={item.label} className="p-2.5 rounded-xl bg-surface-container flex flex-col">
                <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">{item.label}</span>
                <span className="font-label-md text-label-md text-on-surface font-semibold mt-0.5">
                  {item.value}
                </span>
              </div>
            ))}
          </div>

          <div className="p-3 rounded-xl bg-surface-container-lowest space-y-2">
            <div className="font-label-sm text-label-sm uppercase tracking-wider text-primary font-bold">
              Aetheria US AQI Spectrum
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-[#059669]" /> 0–25 Pristine</div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-[#10B981]" /> 26–75 Temperate</div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B]" /> 76–150 Smog Intrusion</div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-[#E11D48]" /> 151+ Hazardous</div>
            </div>
          </div>

          <div className="text-xs text-on-surface-variant">
            Last updated {formatTime(air.updatedAt)} · Source: {air.source}
          </div>
        </div>
      )}
    </ModalDialog>
  );
};
