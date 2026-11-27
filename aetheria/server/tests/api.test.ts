import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import {
  ProfileSchema,
  OracleResponseSchema,
  PlaybookDetailSchema,
  RoutineResponseSchema,
  VoiceIntentSchema,
  mapUsAqiToSpectrum
} from '@aetheria/shared';

// Isolate tests to a temporary SQLite database so production aetheria/data.db is never polluted
const TEST_DB_PATH = path.join(os.tmpdir(), `aetheria-test-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getHealthStatus } = await import('../src/config/env.js');
const { getCommunitySummary, createPledge, default: db } = await import('../src/db/database.js');
const {
  generateDailyRoutine,
  generateOracleAnswer,
  generatePlaybookDetail,
  parseVoiceIntent
} = await import('../src/services/gemini.js');
const { planCleanAirRoute } = await import('../src/services/routing.js');
const { app } = await import('../src/index.js');

test.after(() => {
  try {
    db.close();
  } catch {
    // ignore
  }
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(`${TEST_DB_PATH}${suffix}`);
    } catch {
      // ignore
    }
  }
});

async function invokeApp(method: string, url: string, bodyObj?: unknown, headers: Record<string, string> = {}) {
  const payload = bodyObj !== undefined ? JSON.stringify(bodyObj) : '';
  const reqStream = new Readable({
    read() {
      if (payload) this.push(payload);
      this.push(null);
    }
  }) as unknown as Record<string, unknown>;

  reqStream.method = method;
  reqStream.url = url;
  reqStream.headers = {
    ...(payload ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) } : {}),
    ...headers
  };
  const fakeSocket = new PassThrough() as PassThrough & { remoteAddress?: string };
  fakeSocket.remoteAddress = '127.0.0.1';
  reqStream.socket = fakeSocket;
  reqStream.connection = fakeSocket;

  const resHeaders: Record<string, string | string[]> = {};
  const chunks: Buffer[] = [];
  const res = new EventEmitter() as EventEmitter & {
    statusCode: number;
    headersSent: boolean;
    setHeader: (k: string, v: string | string[]) => void;
    getHeader: (k: string) => string | string[] | undefined;
    removeHeader: (k: string) => void;
    flushHeaders: () => void;
    writeHead: (code: number, hdrs?: Record<string, string | string[]>) => unknown;
    write: (chunk: string | Buffer) => boolean;
    end: (chunk?: string | Buffer) => unknown;
  };
  res.statusCode = 200;
  res.headersSent = false;
  res.setHeader = (k, v) => { resHeaders[k.toLowerCase()] = v; };
  res.getHeader = (k) => resHeaders[k.toLowerCase()];
  res.removeHeader = (k) => { delete resHeaders[k.toLowerCase()]; };
  res.flushHeaders = () => { res.headersSent = true; };
  res.writeHead = (code, hdrs) => {
    res.statusCode = code;
    if (hdrs) Object.entries(hdrs).forEach(([k, v]) => res.setHeader(k, v));
    res.headersSent = true;
    return res;
  };
  res.write = (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    return true;
  };

  const done = new Promise<{ status: number; body: string; headers: typeof resHeaders }>((resolve) => {
    res.end = (chunk?: string | Buffer) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      res.emit('finish');
      resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: resHeaders });
      return res;
    };
  });

  (app as unknown as (req: unknown, res: unknown) => void)(reqStream, res);
  return await done;
}

test('getHealthStatus never leaks raw secrets and documents all keys', () => {
  const health = getHealthStatus();
  assert.equal(health.ok, true);
  assert.ok(Array.isArray(health.keys));
  assert.ok(health.keys.some((k) => k.name === 'GEMINI_API_KEY' && k.required === true));
  const serialized = JSON.stringify(health);
  if (process.env.GEMINI_API_KEY) {
    assert.ok(!serialized.includes(process.env.GEMINI_API_KEY));
  }
});

test('SQLite community pledges enforce 1 pledge per type per device per day', () => {
  const devId = `test-device-${Date.now()}`;
  const first = createPledge(devId, 'Test District', 'stove_curfew');
  assert.equal(first.alreadyPledgedToday, false);

  const second = createPledge(devId, 'Test District', 'stove_curfew');
  assert.equal(second.alreadyPledgedToday, true);

  const summary = getCommunitySummary('Test District', devId);
  const stovePledge = summary.pledges.find((p) => p.type === 'stove_curfew');
  assert.equal(stovePledge?.userPledgedToday, true);
});

test('Oracle, Routine, and VoiceIntent fallbacks validate against Zod schemas', async () => {
  const profile = ProfileSchema.parse({});
  const mockAir = {
    locationName: 'Delhi',
    lat: 28.61,
    lon: 77.2,
    aqi: 210,
    categoryKey: 'hazardous' as const,
    categoryLabel: 'Hazardous Sovereign Breach',
    accentWord: 'Hazardous',
    pm25: 160,
    pm10: 230,
    no2: 45,
    o3: 30,
    windSpeed: 1.1,
    windDirection: 290,
    temperature: 12,
    humidity: 70,
    boundaryLayerHeight: 160,
    inversionDetected: true,
    inversionReason: 'Low BLH',
    whoMultiple: 10.7,
    source: 'Test',
    updatedAt: new Date().toISOString(),
    hourly: [
      {
        time: new Date().toISOString(),
        pm25: 160,
        pm10: 220,
        no2: 40,
        aqi: 210,
        windSpeed: 1.1,
        temperature: 12,
        boundaryLayerHeight: 160
      }
    ],
    nearbyPoints: []
  };

  const oracle = await generateOracleAnswer({
    message: 'How do I keep my baby safe tonight?',
    language: 'English',
    profile,
    air: mockAir,
    localTime: '8:00 PM'
  });
  assert.doesNotThrow(() => OracleResponseSchema.parse(oracle.data));

  const routine = await generateDailyRoutine({
    language: 'English',
    profile,
    air: mockAir,
    localTime: '8:00 AM'
  });
  assert.doesNotThrow(() => RoutineResponseSchema.parse(routine.data));

  const voice = await parseVoiceIntent({
    transcript: 'open my health profile',
    language: 'English',
    currentRoute: '/'
  });
  assert.doesNotThrow(() => VoiceIntentSchema.parse(voice));
  assert.equal(voice.intent, 'navigate');
  assert.equal(voice.params.route, '/health');
});

test('VoiceIntent handles AQI, dose logging, language switch, reminders, tutorial controls, and alert confirmation', async () => {
  const aqiIntent = await parseVoiceIntent({ transcript: "what's the air quality", language: 'English', currentRoute: '/' });
  assert.equal(aqiIntent.intent, 'read_aqi');

  const doseIntent = await parseVoiceIntent({ transcript: 'log inhaler dose', language: 'English', currentRoute: '/' });
  assert.equal(doseIntent.intent, 'log_dose');

  const langIntent = await parseVoiceIntent({ transcript: 'change language to Hindi', language: 'English', currentRoute: '/' });
  assert.equal(langIntent.intent, 'change_language');
  assert.equal(langIntent.params.language, 'Hindi');

  const remIntent = await parseVoiceIntent({ transcript: 'remind me at 10 AM to open windows', language: 'English', currentRoute: '/' });
  assert.equal(remIntent.intent, 'set_reminder');

  const tutNext = await parseVoiceIntent({ transcript: 'next step', language: 'English', currentRoute: '/' });
  assert.equal(tutNext.intent, 'tutorial_control');
  assert.equal(tutNext.params.action, 'next');

  const alertIntent = await parseVoiceIntent({ transcript: 'send alert to school', language: 'English', currentRoute: '/' });
  assert.equal(alertIntent.intent, 'send_alert');
  assert.equal(alertIntent.requiresConfirmation, true);

  const heatingPlaybook = await generatePlaybookDetail({
    playbookId: 'clean-heating',
    title: 'Zero-Smoke Winter Heating',
    language: 'English',
    profile: ProfileSchema.parse({}),
    air: null
  });
  assert.doesNotThrow(() => PlaybookDetailSchema.parse(heatingPlaybook.data));
  assert.ok(mapUsAqiToSpectrum(200).textColor.startsWith('#'));
});

test('Community summary scopes counts accurately by area with zero seed or cross-city leakage', () => {
  const areaA = `AreaA-${Date.now()}`;
  const areaB = `AreaB-${Date.now()}`;
  const devId = `dev-${Date.now()}`;

  const before = getCommunitySummary(areaA, devId);
  assert.equal(before.isSeed, false);
  assert.equal(before.totalRealPledges, 0);
  assert.equal(before.totalCo2AvoidedKg, 0);
  assert.ok(before.pledges.every((p) => p.seedCount === 0 && p.totalCount === p.realCount));
  assert.ok(!before.leaderboard.some((l) => l.name === 'North Corridor Transit Guild'));

  createPledge(devId, areaA, 'no_waste_burning');
  const afterA = getCommunitySummary(areaA, devId);
  assert.equal(afterA.totalRealPledges, 1);
  assert.ok(afterA.totalCo2AvoidedKg > 0);
  const rowA = afterA.leaderboard.find((l) => l.name === areaA);
  assert.ok(rowA);
  assert.equal(rowA.isCurrentArea, true);

  // Switching to AreaB (0 pledges) must NOT inherit AreaA's CO2 or adoption %
  const summaryB = getCommunitySummary(areaB, devId);
  assert.equal(summaryB.totalRealPledges, 0);
  assert.equal(summaryB.totalCo2AvoidedKg, 0);
  assert.equal(summaryB.adoptionPercent, 0);
  const rowB = summaryB.leaderboard.find((l) => l.name === areaB);
  assert.ok(rowB);
  assert.equal(rowB.co2AvoidedKg, 0);
  assert.equal(rowB.adoptionPercent, 0);
});

test('Oracle handles multi-turn history and question-aware guidance across all follow-up topics', async () => {
  const profile = ProfileSchema.parse({ fuel: 'lpg', transport: 'motorbike' });

  const topics: Array<{ q: string; expect: RegExp }> = [
    { q: 'Is metro safer than bike today?', expect: /commute|metro|pm2\.5/i },
    { q: 'What stove emission hack helps?', expect: /kitchen|stove|cooking/i },
    { q: 'When should I open windows today?', expect: /ventilation|window/i },
    { q: 'How do I build a DIY MERV-13 filter?', expect: /box-fan|merv-13|purifier/i },
    { q: 'How do I check if my N95 mask seals properly?', expect: /n95|mask|seal/i },
    { q: 'Do indoor plants clean winter smog?', expect: /plant|simmer|hepa/i },
    { q: 'What is the current air quality and inversion status?', expect: /air|inversion|aqi/i }
  ];

  for (const t of topics) {
    const ans = await generateOracleAnswer({
      message: t.q,
      history: [{ role: 'user', text: 'Previous question' }],
      language: 'English',
      profile,
      air: null,
      localTime: '9:00 AM'
    });
    assert.doesNotThrow(() => OracleResponseSchema.parse(ans.data));
    assert.match(`${ans.data.title} ${ans.data.summary}`, t.expect);
  }
});

test('planCleanAirRoute returns valid cleanest/fastest routes and handles same-point trips', async () => {
  const mockAir = {
    locationName: 'New Delhi',
    lat: 28.6139,
    lon: 77.209,
    aqi: 180,
    categoryKey: 'hazardous' as const,
    categoryLabel: 'Hazardous Sovereign Breach',
    accentWord: 'Hazardous',
    pm25: 110,
    pm10: 180,
    no2: 35,
    o3: 25,
    windSpeed: 1.5,
    windDirection: 270,
    temperature: 14,
    humidity: 65,
    boundaryLayerHeight: 200,
    inversionDetected: true,
    inversionReason: 'Low BLH',
    whoMultiple: 7.3,
    source: 'Test',
    updatedAt: new Date().toISOString(),
    hourly: [
      {
        time: new Date().toISOString(),
        pm25: 105,
        pm10: 170,
        no2: 32,
        aqi: 176,
        windSpeed: 1.8,
        temperature: 15,
        boundaryLayerHeight: 220
      }
    ],
    nearbyPoints: []
  };

  const result = await planCleanAirRoute({
    from: { lat: 28.6139, lon: 77.209, label: 'Origin' },
    to: { lat: 28.625, lon: 77.22, label: 'Dest' },
    mode: 'foot',
    liveAir: mockAir
  });

  assert.equal(result.mode, 'foot');
  assert.ok(result.cleanest.points.length >= 2);
  assert.ok(result.fastest.points.length >= 2);
  assert.ok(result.cleanest.cumulativeExposureUgMin <= result.fastest.cumulativeExposureUgMin);
  assert.ok(result.waypoints.length >= 2);

  const samePt = await planCleanAirRoute({
    from: { lat: 28.6139, lon: 77.209, label: 'Same' },
    to: { lat: 28.6139, lon: 77.209, label: 'Same' },
    mode: 'foot',
    liveAir: mockAir
  });
  assert.ok(samePt.cleanest.distanceKm <= 0.1);
});

test('HTTP Express endpoints /api/health, /api/health/verify, /api/geocode/reverse, /api/community, /api/oracle respond cleanly', async () => {
  const healthRes = await invokeApp('GET', '/api/health');
  assert.equal(healthRes.status, 200);
  const healthJson = JSON.parse(healthRes.body) as { ok: boolean };
  assert.equal(healthJson.ok, true);

  const verifyRes = await invokeApp('GET', '/api/health/verify');
  assert.equal(verifyRes.status, 200);
  const verifyJson = JSON.parse(verifyRes.body) as { ok: boolean; checks: Array<{ name: string; ok: boolean; detail: string }> };
  assert.equal(verifyJson.ok, true);
  assert.equal(verifyJson.checks.length, 5);

  const revBad = await invokeApp('GET', '/api/geocode/reverse?lat=abc&lon=77');
  assert.equal(revBad.status, 400);

  const revOk = await invokeApp('GET', '/api/geocode/reverse?lat=28.6139&lon=77.209');
  assert.equal(revOk.status, 200);

  const commRes = await invokeApp('GET', '/api/community?area=TestCity&deviceId=dev-http-1');
  assert.equal(commRes.status, 200);
  const commJson = JSON.parse(commRes.body) as { isSeed: boolean; pledges: unknown[] };
  assert.equal(commJson.isSeed, false);
  assert.equal(commJson.pledges.length, 3);

  const joinFail = await invokeApp('POST', '/api/community/join', {
    deviceId: 'dev-http-1',
    area: 'TestCity',
    consentGiven: false
  });
  assert.equal(joinFail.status, 400);

  const oracleSseRes = await invokeApp(
    'POST',
    '/api/oracle',
    {
      message: 'How do I protect my child tonight?',
      language: 'English',
      stream: true
    },
    { accept: 'text/event-stream' }
  );
  assert.equal(oracleSseRes.status, 200);
  assert.ok(oracleSseRes.body.includes('event: card'));
  assert.ok(oracleSseRes.body.includes('event: done'));

  const oracleJsonRes = await invokeApp('POST', '/api/oracle', {
    message: 'Is metro safer than bike today?',
    language: 'English',
    stream: false
  });
  assert.equal(oracleJsonRes.status, 200);
  const parsedOracle = JSON.parse(oracleJsonRes.body) as { data: unknown };
  assert.doesNotThrow(() => OracleResponseSchema.parse(parsedOracle.data));
});
