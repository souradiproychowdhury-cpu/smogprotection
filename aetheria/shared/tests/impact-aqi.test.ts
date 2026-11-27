import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapUsAqiToSpectrum,
  pm25ToUsAqi,
  whoGuidelineMultiple,
  calculateIndoorPm25,
  calculateExposureAvoided,
  calculateCo2Avoided,
  calculateCostDelta,
  calculateDailyImpactSummary,
  OracleResponseSchema,
  VoiceIntentSchema
} from '../src/index.js';

test('mapUsAqiToSpectrum maps US AQI scale accurately to DESIGN.md spectrum', () => {
  assert.equal(mapUsAqiToSpectrum(0).key, 'pristine');
  assert.equal(mapUsAqiToSpectrum(25).key, 'pristine');
  assert.equal(mapUsAqiToSpectrum(26).key, 'temperate');
  assert.equal(mapUsAqiToSpectrum(75).key, 'temperate');
  assert.equal(mapUsAqiToSpectrum(76).key, 'intrusion');
  assert.equal(mapUsAqiToSpectrum(150).key, 'intrusion');
  assert.equal(mapUsAqiToSpectrum(151).key, 'hazardous');
  assert.equal(mapUsAqiToSpectrum(350).key, 'hazardous');
});

test('pm25ToUsAqi converts PM2.5 concentrations using EPA breakpoints', () => {
  assert.equal(pm25ToUsAqi(0), 0);
  assert.equal(pm25ToUsAqi(9.0), 50);
  assert.ok(pm25ToUsAqi(35.4) === 100);
  assert.ok(pm25ToUsAqi(150) > 200);
  assert.equal(pm25ToUsAqi(600), 500);
});

test('whoGuidelineMultiple calculates multiple of 15 ug/m3', () => {
  assert.equal(whoGuidelineMultiple(15), 1);
  assert.equal(whoGuidelineMultiple(72), 4.8);
  assert.equal(whoGuidelineMultiple(0), 0);
});

test('calculateIndoorPm25 shows significant reduction with sealed windows and purifier', () => {
  const unmitigated = calculateIndoorPm25({
    outdoorPm25: 180,
    purifierRunning: false,
    windowsSealed: false
  });
  const mitigated = calculateIndoorPm25({
    outdoorPm25: 180,
    purifierRunning: true,
    purifierType: 'diyBoxFanMerv13',
    windowsSealed: true
  });

  assert.ok(mitigated.indoorPm25.value < unmitigated.indoorPm25.value);
  assert.ok(mitigated.reductionPercent.value >= 70);
  assert.equal(mitigated.indoorPm25.isEstimate, true);
  assert.ok(mitigated.indoorPm25.formula.length > 0);
});

test('calculateExposureAvoided and CO2/Cost formulas handle edge cases', () => {
  const zeroHours = calculateExposureAvoided({ outdoorPm25: 200, indoorPm25: 20, hoursIndoors: 0 });
  assert.equal(zeroHours.value, 0);

  const co2 = calculateCo2Avoided({ fuel: 'induction', transport: 'metro', commuteKm: 12, cookingHours: 2 });
  assert.ok(co2.value > 0);

  const cost = calculateCostDelta({
    fuel: 'induction',
    transport: 'metro',
    commuteKm: 12,
    cookingHours: 2,
    purifierRunning: true,
    purifierHours: 12
  });
  assert.equal(cost.unit, 'INR');
  assert.equal(cost.isEstimate, true);
});

test('calculateDailyImpactSummary aggregates all metrics transparently', () => {
  const summary = calculateDailyImpactSummary({
    outdoorPm25: 160,
    windowsSealed: true,
    purifierRunning: true,
    purifierType: 'hepaPurifier',
    fuel: 'lpg',
    transport: 'metro',
    completedRoutineCount: 2,
    completedChecklistCount: 1,
    currency: 'INR'
  });

  assert.ok(summary.indoorPm25.value < 50);
  assert.ok(summary.exposureAvoided.value > 500);
  assert.ok(summary.cleanAirHoursBanked.value >= 10);
  assert.ok(summary.co2Avoided.value > 0);
});

test('OracleResponseSchema and VoiceIntentSchema validate structured AI payloads', () => {
  const validOracle = {
    title: 'Box-Fan MERV-13 Shield',
    urgency: 'immediate',
    summary: 'Sealing windows and running a box-fan filter lowers indoor PM2.5 substantially.',
    steps: [{ n: 1, label: 'Seal gaps', detail: 'Use damp towels or weatherstripping.' }],
    impact: [{ metric: 'Indoor PM2.5', value: '-72%', basis: 'CADR mass balance estimate', kind: 'health', isEstimate: true }],
    remedy: { title: 'Saline nasal rinse', text: 'Helps clear upper airway irritants.', evidence: 'moderate' },
    evidenceNote: 'HEPA/MERV-13 filtration is strongly supported; herbal vapor does not remove PM2.5.',
    safetyNote: null,
    confidence: { level: 'high', reason: 'Live Open-Meteo reading + standard CADR model' },
    followUps: ['How often should I replace the filter?'],
    actions: [{ type: 'open_route', label: 'Find clean walking route', payload: {} }]
  };
  assert.doesNotThrow(() => OracleResponseSchema.parse(validOracle));

  const badOracle = { ...validOracle, urgency: 'super_urgent' };
  assert.throws(() => OracleResponseSchema.parse(badOracle));

  const validVoice = {
    intent: 'navigate',
    params: { route: '/health' },
    replyText: 'Opening your Health Profile.',
    requiresConfirmation: false
  };
  assert.doesNotThrow(() => VoiceIntentSchema.parse(validVoice));
});
