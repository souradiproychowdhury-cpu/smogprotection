import emissionFactors from './emission-factors.json';
export interface ImpactMetricResult {
    value: number;
    unit: string;
    isEstimate: true;
    basis: string;
    formula: string;
    inputs: Record<string, string | number | boolean>;
}
export interface IndoorPm25Input {
    outdoorPm25: number;
    purifierRunning: boolean;
    purifierType?: 'hepaPurifier' | 'diyBoxFanMerv13' | 'corsiRosenthalCube';
    windowsSealed: boolean;
    roomVolumeM3?: number;
    cookingFuel?: 'wood' | 'coal' | 'lpg' | 'electric' | 'induction';
    cookingHoursToday?: number;
}
/**
 * Steady-state single-zone indoor mass-balance model:
 *   C_in = (C_out * ACH_inf * P + S / V) / (ACH_inf + CADR / V + k_dep)
 * Where:
 *   ACH_inf = air exchange infiltration rate (h^-1)
 *   P = penetration factor of outdoor PM2.5 through building envelope
 *   CADR = Clean Air Delivery Rate of running purifier/DIY filter (m^3/h)
 *   V = room volume (m^3)
 *   k_dep = natural surface deposition rate (0.39 h^-1)
 *   S = indoor combustion source rate (µg/h)
 */
export declare function calculateIndoorPm25(input: IndoorPm25Input): {
    indoorPm25: ImpactMetricResult;
    reductionPercent: ImpactMetricResult;
};
export interface ExposureAvoidedInput {
    outdoorPm25: number;
    indoorPm25: number;
    hoursIndoors: number;
    routeExposureSavedUgHours?: number;
}
export declare function calculateExposureAvoided(input: ExposureAvoidedInput): ImpactMetricResult;
export interface CostAndCarbonInput {
    fuel: 'wood' | 'coal' | 'lpg' | 'electric' | 'induction';
    transport: 'car' | 'motorbike' | 'bus' | 'metro' | 'cycle' | 'walk';
    commuteKm?: number;
    cookingHours?: number;
    purifierRunning?: boolean;
    purifierType?: 'hepaPurifier' | 'diyBoxFanMerv13' | 'corsiRosenthalCube';
    purifierHours?: number;
    electricityRateInrPerKwh?: number;
    currency?: 'INR' | 'USD';
}
export declare function calculateCo2Avoided(input: CostAndCarbonInput): ImpactMetricResult;
export declare function calculateCostDelta(input: CostAndCarbonInput): ImpactMetricResult;
export interface DailyImpactInput {
    outdoorPm25: number;
    windowsSealed: boolean;
    purifierRunning: boolean;
    purifierType?: 'hepaPurifier' | 'diyBoxFanMerv13' | 'corsiRosenthalCube';
    fuel: 'wood' | 'coal' | 'lpg' | 'electric' | 'induction';
    transport: 'car' | 'motorbike' | 'bus' | 'metro' | 'cycle' | 'walk';
    completedRoutineCount: number;
    completedChecklistCount: number;
    currency?: 'INR' | 'USD';
}
export declare function calculateDailyImpactSummary(input: DailyImpactInput): {
    indoorPm25: ImpactMetricResult;
    reductionPercent: ImpactMetricResult;
    exposureAvoided: ImpactMetricResult;
    co2Avoided: ImpactMetricResult;
    costDelta: ImpactMetricResult;
    cleanAirHoursBanked: ImpactMetricResult;
};
export { emissionFactors };
