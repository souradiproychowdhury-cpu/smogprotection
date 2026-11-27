/**
 * US AQI to Aetheria DESIGN.md Spectrum Mapping
 *
 * US AQI Scale -> DESIGN.md Atmospheric Spectrum:
 *   0 - 25   : Sovereign Pristine   (#059669 emerald, #34D399 halo)
 *   26 - 75  : Temperate Shift      (#10B981 -> #06B6D4 cyan-teal)
 *   76 - 150 : Smog Intrusion       (#F59E0B warm imperial amber)
 *   151+     : Hazardous Breach     (#E11D48 damson crimson + gold hazard trim)
 *
 * Note: Standard US EPA AQI breakpoints are:
 *   0-50 Good, 51-100 Moderate, 101-150 USG, 151-200 Unhealthy, 201-300 Very Unhealthy, 301+ Hazardous.
 * Aetheria tightens the pristine threshold to 0-25 and temperate to 26-75 to better align
 * with WHO 2021 PM2.5 guidance for vulnerable households (infants, elderly, asthma/COPD).
 */

export type AqiSpectrumKey = 'pristine' | 'temperate' | 'intrusion' | 'hazardous';

export interface AqiCategoryInfo {
  key: AqiSpectrumKey;
  label: string;
  accentWord: string;
  shortLabel: string;
  usEpaBand: string;
  color: string;
  haloColor: string;
  textColor: string;
  pillBgClass: string;
  pillTextClass: string;
  borderClass: string;
  adviceSummary: string;
}

export function mapUsAqiToSpectrum(aqi: number): AqiCategoryInfo {
  const safeAqi = Number.isFinite(aqi) ? Math.max(0, Math.round(aqi)) : 0;

  if (safeAqi <= 25) {
    return {
      key: 'pristine',
      label: 'Sovereign Pristine',
      accentWord: 'Pristine',
      shortLabel: 'Pristine',
      usEpaBand: 'Good (US AQI 0–25)',
      color: '#059669',
      haloColor: '#34D399',
      textColor: '#68dba9',
      pillBgClass: 'bg-secondary/15',
      pillTextClass: 'text-secondary',
      borderClass: 'border-secondary/30',
      adviceSummary: 'Ideal conditions for natural cross-ventilation and outdoor activity.'
    };
  }

  if (safeAqi <= 75) {
    return {
      key: 'temperate',
      label: 'Temperate Shift',
      accentWord: 'Temperate',
      shortLabel: 'Temperate',
      usEpaBand: safeAqi <= 50 ? 'Good (US AQI 26–50)' : 'Moderate (US AQI 51–75)',
      color: '#10B981',
      haloColor: '#06B6D4',
      textColor: '#8ed5ff',
      pillBgClass: 'bg-tertiary/15',
      pillTextClass: 'text-tertiary',
      borderClass: 'border-tertiary/30',
      adviceSummary: 'Acceptable for most people; sensitive groups should monitor symptoms.'
    };
  }

  if (safeAqi <= 150) {
    return {
      key: 'intrusion',
      label: 'Smog Intrusion',
      accentWord: 'Intrusion',
      shortLabel: 'Elevated',
      usEpaBand: safeAqi <= 100 ? 'Moderate (US AQI 76–100)' : 'Unhealthy for Sensitive Groups (US AQI 101–150)',
      color: '#F59E0B',
      haloColor: '#F59E0B',
      textColor: '#ffc174',
      pillBgClass: 'bg-primary-container/20',
      pillTextClass: 'text-primary',
      borderClass: 'border-primary-container/40',
      adviceSummary: 'Close drafty windows, run HEPA/DIY filtration, and limit outdoor exertion for children and seniors.'
    };
  }

  return {
    key: 'hazardous',
    label: 'Hazardous Sovereign Breach',
    accentWord: 'Hazardous',
    shortLabel: 'Severe',
    usEpaBand: safeAqi <= 200 ? 'Unhealthy (US AQI 151–200)' : safeAqi <= 300 ? 'Very Unhealthy (US AQI 201–300)' : 'Hazardous (US AQI 301+)',
    color: '#E11D48',
    haloColor: '#E11D48',
    textColor: '#ffb4ab',
    pillBgClass: 'bg-error-container/50',
    pillTextClass: 'text-error',
    borderClass: 'border-error/40',
    adviceSummary: 'Stay indoors with sealed windows and active filtration. Use N95/FFP2 masks if outdoor travel is unavoidable.'
  };
}

/**
 * Standard US EPA 2024 PM2.5 (µg/m³) -> US AQI linear interpolation.
 */
export function pm25ToUsAqi(pm25: number): number {
  const c = Math.max(0, Math.floor(pm25 * 10) / 10);
  const breakpoints: Array<[number, number, number, number]> = [
    [0.0, 9.0, 0, 50],
    [9.1, 35.4, 51, 100],
    [35.5, 55.4, 101, 150],
    [55.5, 125.4, 151, 200],
    [125.5, 225.4, 201, 300],
    [225.5, 325.4, 301, 400],
    [325.5, 500.4, 401, 500]
  ];

  for (const [cLow, cHigh, iLow, iHigh] of breakpoints) {
    if (c <= cHigh) {
      return Math.round(((iHigh - iLow) / (cHigh - cLow)) * (c - cLow) + iLow);
    }
  }
  return 500;
}

export function whoGuidelineMultiple(pm25: number): number {
  if (!Number.isFinite(pm25) || pm25 <= 0) return 0;
  return Math.round((pm25 / 15) * 10) / 10;
}
