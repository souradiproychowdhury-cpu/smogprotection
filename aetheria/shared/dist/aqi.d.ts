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
export declare function mapUsAqiToSpectrum(aqi: number): AqiCategoryInfo;
/**
 * Standard US EPA 2024 PM2.5 (µg/m³) -> US AQI linear interpolation.
 */
export declare function pm25ToUsAqi(pm25: number): number;
export declare function whoGuidelineMultiple(pm25: number): number;
