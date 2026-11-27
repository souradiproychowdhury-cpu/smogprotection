import emissionFactors from './emission-factors.json' with { type: 'json' };

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
export function calculateIndoorPm25(input: IndoorPm25Input): {
  indoorPm25: ImpactMetricResult;
  reductionPercent: ImpactMetricResult;
} {
  const f = emissionFactors.filtration;
  const outdoor = Math.max(0, input.outdoorPm25);
  const roomVol = Math.max(12, input.roomVolumeM3 ?? f.defaultRoomVolumeM3);
  const achInf = input.windowsSealed ? f.infiltrationAchSealed : f.infiltrationAchUnsealed;
  const penetration = input.windowsSealed ? f.penetrationFactorSealed : f.penetrationFactorUnsealed;

  const purifierSpec = input.purifierRunning
    ? f[input.purifierType ?? 'hepaPurifier']
    : null;
  const cadr = purifierSpec ? purifierSpec.cadrM3h : 0;
  const filtrationAch = cadr / roomVol;

  // Baseline unmitigated indoor PM2.5 (unsealed, no purifier)
  const baselineDenominator = f.infiltrationAchUnsealed + f.depositionRatePerHour;
  const baselineIndoor = (outdoor * f.infiltrationAchUnsealed * f.penetrationFactorUnsealed) / baselineDenominator;

  // Cooking indoor penalty amortized over 24h if solid/gas fuel used without exhaust
  let sourceConcentrationContribution = 0;
  if (input.cookingFuel && (input.cookingHoursToday ?? 0) > 0) {
    const fuelInfo = emissionFactors.cookingHeatingFuels[input.cookingFuel];
    const activeHours = Math.min(8, Math.max(0, input.cookingHoursToday ?? 0));
    sourceConcentrationContribution = (fuelInfo.indoorPm25ReleaseUgM3 * activeHours) / 24;
  }

  const denominator = achInf + filtrationAch + f.depositionRatePerHour;
  const indoorConc = Math.max(
    1,
    Math.round(((outdoor * achInf * penetration) / denominator + sourceConcentrationContribution) * 10) / 10
  );

  const reductionPct = baselineIndoor > 0
    ? Math.max(0, Math.min(98, Math.round(((baselineIndoor - indoorConc) / baselineIndoor) * 100)))
    : 0;

  return {
    indoorPm25: {
      value: indoorConc,
      unit: 'µg/m³',
      isEstimate: true,
      basis: 'Single-zone steady-state mass-balance model with infiltration, penetration, surface deposition, and CADR/V air changes per hour.',
      formula: 'C_in = (C_out × ACH_inf × P) / (ACH_inf + CADR/V + k_dep) + S_cooking',
      inputs: {
        outdoorPm25: Math.round(outdoor * 10) / 10,
        windowsSealed: input.windowsSealed,
        achInfiltration: achInf,
        penetrationFactor: penetration,
        cadrM3h: cadr,
        roomVolumeM3: roomVol,
        filtrationAch: Math.round(filtrationAch * 100) / 100
      }
    },
    reductionPercent: {
      value: reductionPct,
      unit: '%',
      isEstimate: true,
      basis: 'Comparison against unsealed room with no active filtration under the same outdoor PM2.5.',
      formula: '(C_baseline_unsealed - C_in) / C_baseline_unsealed × 100',
      inputs: {
        baselineIndoorPm25: Math.round(baselineIndoor * 10) / 10,
        mitigatedIndoorPm25: indoorConc
      }
    }
  };
}

export interface ExposureAvoidedInput {
  outdoorPm25: number;
  indoorPm25: number;
  hoursIndoors: number;
  routeExposureSavedUgHours?: number;
}

export function calculateExposureAvoided(input: ExposureAvoidedInput): ImpactMetricResult {
  const delta = Math.max(0, input.outdoorPm25 - input.indoorPm25);
  const hours = Math.max(0, Math.min(24, input.hoursIndoors));
  const indoorSaved = delta * hours;
  const routeSaved = Math.max(0, input.routeExposureSavedUgHours ?? 0);
  const totalSaved = Math.round(indoorSaved + routeSaved);

  return {
    value: totalSaved,
    unit: 'µg·h/m³',
    isEstimate: true,
    basis: 'Cumulative PM2.5 concentration difference avoided indoors over hours sheltered, plus any clean-air route savings.',
    formula: '(PM2.5_outdoor - PM2.5_indoor) × hours_indoors + route_savings',
    inputs: {
      outdoorPm25: Math.round(input.outdoorPm25 * 10) / 10,
      indoorPm25: Math.round(input.indoorPm25 * 10) / 10,
      hoursIndoors: hours,
      routeExposureSavedUgHours: Math.round(routeSaved)
    }
  };
}

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

export function calculateCo2Avoided(input: CostAndCarbonInput): ImpactMetricResult {
  const commuteKm = Math.max(0, input.commuteKm ?? 10);
  const cookingHours = Math.max(0, input.cookingHours ?? 1.5);

  // Reference high-emission baseline: private car + wood/coal cooking if user chose cleaner options
  const chosenTransport = emissionFactors.transportPerKm[input.transport];
  const carBaseline = emissionFactors.transportPerKm.car;
  const transportSaved = Math.max(0, (carBaseline.co2eKgPerKm - chosenTransport.co2eKgPerKm) * commuteKm);

  const chosenFuel = emissionFactors.cookingHeatingFuels[input.fuel];
  const woodBaseline = emissionFactors.cookingHeatingFuels.wood;
  const fuelSaved = Math.max(0, (woodBaseline.co2eKgPerHour - chosenFuel.co2eKgPerHour) * cookingHours);

  const totalKg = Math.round((transportSaved + fuelSaved) * 100) / 100;

  return {
    value: totalKg,
    unit: 'kg CO₂e',
    isEstimate: true,
    basis: 'DEFRA 2024 & CEA emission factors comparing chosen transport and cooking fuel against private car + biomass baseline.',
    formula: '((EF_car - EF_transport) × km) + ((EF_wood - EF_fuel) × cooking_hours)',
    inputs: {
      transportMode: input.transport,
      commuteKm,
      cookingFuel: input.fuel,
      cookingHours,
      transportCo2SavedKg: Math.round(transportSaved * 100) / 100,
      fuelCo2SavedKg: Math.round(fuelSaved * 100) / 100
    }
  };
}

export function calculateCostDelta(input: CostAndCarbonInput): ImpactMetricResult {
  const isUsd = input.currency === 'USD';
  const commuteKm = Math.max(0, input.commuteKm ?? 10);
  const cookingHours = Math.max(0, input.cookingHours ?? 1.5);
  const purifierHours = input.purifierRunning ? Math.max(0, input.purifierHours ?? 12) : 0;

  const ratePerKwh = input.electricityRateInrPerKwh ??
    (isUsd ? emissionFactors.filtration.defaultElectricityRateUsdPerKwh : emissionFactors.filtration.defaultElectricityRateInrPerKwh);

  const chosenTransport = emissionFactors.transportPerKm[input.transport];
  const carBaseline = emissionFactors.transportPerKm.car;
  const transportCostSaved = Math.max(
    0,
    ((isUsd ? carBaseline.costPerKmUsd : carBaseline.costPerKmInr) -
      (isUsd ? chosenTransport.costPerKmUsd : chosenTransport.costPerKmInr)) * commuteKm
  );

  const chosenFuel = emissionFactors.cookingHeatingFuels[input.fuel];
  const coalBaseline = emissionFactors.cookingHeatingFuels.coal;
  const fuelCostSaved = Math.max(
    0,
    ((isUsd ? coalBaseline.costPerHourUsd : coalBaseline.costPerHourInr) -
      (isUsd ? chosenFuel.costPerHourUsd : chosenFuel.costPerHourInr)) * cookingHours
  );

  let purifierRunningCost = 0;
  if (input.purifierRunning) {
    const spec = emissionFactors.filtration[input.purifierType ?? 'hepaPurifier'];
    const kwh = (spec.watts * purifierHours) / 1000;
    const filterCost = isUsd ? spec.dailyFilterAmortizedUsd : spec.dailyFilterAmortizedInr;
    purifierRunningCost = kwh * ratePerKwh + filterCost;
  }

  const netSaved = Math.round((transportCostSaved + fuelCostSaved - purifierRunningCost) * 100) / 100;

  return {
    value: netSaved,
    unit: isUsd ? 'USD' : 'INR',
    isEstimate: true,
    basis: 'Daily commute + fuel savings minus electricity and amortized filter cost for running air purification.',
    formula: '(car_cost - mode_cost) × km + (coal_cost - fuel_cost) × hrs - ((watts × hrs / 1000) × rate + filter_amortized)',
    inputs: {
      transportCostSaved: Math.round(transportCostSaved * 100) / 100,
      fuelCostSaved: Math.round(fuelCostSaved * 100) / 100,
      purifierRunningCost: Math.round(purifierRunningCost * 100) / 100,
      ratePerKwh
    }
  };
}

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

export function calculateDailyImpactSummary(input: DailyImpactInput) {
  const { indoorPm25, reductionPercent } = calculateIndoorPm25({
    outdoorPm25: input.outdoorPm25,
    purifierRunning: input.purifierRunning,
    purifierType: input.purifierType,
    windowsSealed: input.windowsSealed,
    cookingFuel: input.fuel,
    cookingHoursToday: 1.5
  });

  // Clean air hours banked increases with routine/checklist actions and active sealing/purifier
  const baseHours = input.windowsSealed || input.purifierRunning ? 10 : 4;
  const actionHours = Math.min(14, input.completedRoutineCount * 2.5 + input.completedChecklistCount * 1.5);
  const hoursBanked = Math.min(24, Math.round((baseHours + actionHours) * 10) / 10);

  const exposureAvoided = calculateExposureAvoided({
    outdoorPm25: input.outdoorPm25,
    indoorPm25: indoorPm25.value,
    hoursIndoors: hoursBanked
  });

  const co2Avoided = calculateCo2Avoided({
    fuel: input.fuel,
    transport: input.transport,
    commuteKm: 10,
    cookingHours: 1.5
  });

  const costDelta = calculateCostDelta({
    fuel: input.fuel,
    transport: input.transport,
    commuteKm: 10,
    cookingHours: 1.5,
    purifierRunning: input.purifierRunning,
    purifierType: input.purifierType,
    purifierHours: hoursBanked,
    currency: input.currency
  });

  const cleanAirHoursBanked: ImpactMetricResult = {
    value: hoursBanked,
    unit: 'hrs',
    isEstimate: true,
    basis: 'Estimated hours spent in mitigated indoor air based on sealing/filtration status and completed protective actions today.',
    formula: 'min(24, base_hours + routine_done × 2.5 + checklist_done × 1.5)',
    inputs: {
      baseHours,
      completedRoutineCount: input.completedRoutineCount,
      completedChecklistCount: input.completedChecklistCount,
      windowsSealed: input.windowsSealed,
      purifierRunning: input.purifierRunning
    }
  };

  return {
    indoorPm25,
    reductionPercent,
    exposureAvoided,
    co2Avoided,
    costDelta,
    cleanAirHoursBanked
  };
}

export { emissionFactors };
