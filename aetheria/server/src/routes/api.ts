import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ProfileSchema, type AirQualityData } from '@aetheria/shared';
import { getHealthStatus, env } from '../config/env.js';
import {
  createPledge,
  getAlertLogs,
  getCommunitySummary,
  insertAlertLog,
  joinSolidarity,
  savePushSubscription
} from '../db/database.js';
import { findNearbyLandmarks, getLiveAirQuality, reverseGeocodeName, searchLocations } from '../services/airQuality.js';
import {
  askTutorialQuestion,
  generateAlertMessage,
  generateDailyRoutine,
  generateHealthDirectives,
  generateOracleAnswer,
  generatePlaybookDetail,
  parseVoiceIntent,
  resolveLanguageName,
  synthesizeSpeechWithGemini,
  transcribeAudioWithGemini,
  translateStrings,
  verifyGeminiConnection
} from '../services/gemini.js';
import { sendTestPush } from '../services/push.js';
import { planCleanAirRoute } from '../services/routing.js';

export const apiRouter = Router();

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI requests right now. Please wait a few seconds and try again.' }
});

apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json(getHealthStatus());
});

apiRouter.get('/health/verify', async (_req: Request, res: Response) => {
  const probe = async (name: string, fn: () => Promise<string>) => {
    const t0 = Date.now();
    try {
      const detail = await fn();
      return { name, ok: true, latencyMs: Date.now() - t0, detail };
    } catch (err) {
      return {
        name,
        ok: false,
        latencyMs: Date.now() - t0,
        detail: err instanceof Error ? err.message : 'Check failed'
      };
    }
  };

  const [geminiCheck, waqiCheck, openMeteoCheck, routingCheck, geocodeCheck] = await Promise.all([
    verifyGeminiConnection().then((d) => ({
      name: 'Gemini GenAI (GEMINI_API_KEY)',
      ok: d.ok,
      latencyMs: d.latencyMs ?? 0,
      detail: d.ok
        ? `Connected via ${d.endpoint || 'Gemini'} (${d.model || env.GEMINI_MODEL})`
        : d.error || 'Gemini connection failed'
    })),
    probe('WAQI Station Feed (WAQI_TOKEN)', async () => {
      if (!env.WAQI_TOKEN) throw new Error('WAQI_TOKEN not configured (using Open-Meteo fallback)');
      const r = await fetch(`https://api.waqi.info/feed/geo:28.6139;77.209/?token=${encodeURIComponent(env.WAQI_TOKEN)}`, {
        signal: AbortSignal.timeout(5000)
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { status?: string; data?: { aqi?: number; city?: { name?: string } } | string };
      if (j.status !== 'ok') throw new Error(typeof j.data === 'string' ? j.data : 'Invalid WAQI response');
      const d = j.data as { aqi?: number; city?: { name?: string } };
      return `Live station: ${d?.city?.name || 'Connected'} (AQI ${d?.aqi ?? '--'})`;
    }),
    probe('Open-Meteo Air & Weather', async () => {
      const r = await fetch(
        'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=28.6139&longitude=77.209&current=us_aqi,pm2_5',
        { signal: AbortSignal.timeout(5000) }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { current?: { us_aqi?: number; pm2_5?: number } };
      return `Live Open-Meteo feed (PM2.5 ${j.current?.pm2_5 ?? '--'} µg/m³)`;
    }),
    probe('OpenStreetMap Road Routing (OpenRouteService / Valhalla / OSRM)', async () => {
      if (env.ORS_API_KEY) {
        const orsRes = await fetch('https://api.heigit.org/openrouteservice/v2/directions/foot-walking/geojson', {
          method: 'POST',
          headers: { Authorization: env.ORS_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ coordinates: [[77.209, 28.6139], [77.219, 28.6229]] }),
          signal: AbortSignal.timeout(5000)
        }).catch(() => null);
        if (orsRes?.ok) return 'Connected to OpenRouteService (api.heigit.org)';
      }
      const valRes = await fetch('https://valhalla1.openstreetmap.de/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locations: [{ lat: 28.6139, lon: 77.209 }, { lat: 28.6229, lon: 77.219 }],
          costing: 'pedestrian'
        }),
        signal: AbortSignal.timeout(5000)
      }).catch(() => null);
      if (valRes?.ok) return 'Connected to Valhalla OpenStreetMap pedestrian/road router';
      const fossgisRes = await fetch(
        'https://routing.openstreetmap.de/routed-foot/route/v1/driving/77.209,28.6139;77.219,28.6229?overview=false',
        { signal: AbortSignal.timeout(5000) }
      ).catch(() => null);
      if (fossgisRes?.ok) return 'Connected to FOSSGIS OpenStreetMap pedestrian road router';
      const osrmRes = await fetch(
        'https://router.project-osrm.org/route/v1/driving/77.209,28.6139;77.219,28.6229?overview=false',
        { signal: AbortSignal.timeout(5000) }
      );
      if (!osrmRes.ok) throw new Error(`Valhalla, FOSSGIS & OSRM unavailable (HTTP ${osrmRes.status})`);
      return 'Connected to OSRM OpenStreetMap road router';
    }),
    probe('Street & Landmark Geocoding (Photon / Nominatim)', async () => {
      const results = await searchLocations('New Delhi');
      if (results.length === 0) throw new Error('No geocoding results returned');
      return `Connected (${results[0].displayName})`;
    })
  ]);

  res.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    checks: [geminiCheck, waqiCheck, openMeteoCheck, routingCheck, geocodeCheck]
  });
});

apiRouter.get('/geocode', async (req: Request, res: Response) => {
  const q = String(req.query.q || '').trim();
  const lat = req.query.lat !== undefined ? Number(req.query.lat) : undefined;
  const lon = req.query.lon !== undefined ? Number(req.query.lon) : undefined;
  if (q.length < 2) {
    res.json({ results: [] });
    return;
  }
  try {
    const results = await searchLocations(
      q,
      Number.isFinite(lat) ? lat : undefined,
      Number.isFinite(lon) ? lon : undefined
    );
    res.json({ results });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Geocoding failed'
    });
  }
});

apiRouter.get('/geocode/nearby', async (req: Request, res: Response) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.status(400).json({ error: 'Valid lat and lon required' });
    return;
  }
  const results = await findNearbyLandmarks(lat, lon);
  res.json({ results });
});

apiRouter.get('/geocode/reverse', async (req: Request, res: Response) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.status(400).json({ error: 'Valid lat and lon required' });
    return;
  }
  const name = await reverseGeocodeName(lat, lon);
  res.json({ name });
});

const AirQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  name: z.string().max(250).optional()
});

apiRouter.get('/air', async (req: Request, res: Response) => {
  const parsed = AirQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid coordinates', details: parsed.error.flatten() });
    return;
  }
  try {
    const data = await getLiveAirQuality(parsed.data.lat, parsed.data.lon, parsed.data.name);
    res.json(data);
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Failed to fetch live air quality'
    });
  }
});

const OracleRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'model']),
        text: z.string().max(1500)
      })
    )
    .max(12)
    .optional(),
  language: z.string().min(1).max(60).default('English'),
  profile: ProfileSchema.default({}),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  locationName: z.string().max(250).optional(),
  localTime: z.string().max(80).optional(),
  stream: z.boolean().optional(),
  style: z
    .object({
      length: z.enum(['short', 'detailed']).optional(),
      budgetCap: z.string().max(60).optional(),
      kidFriendly: z.boolean().optional(),
      elderlyFriendly: z.boolean().optional()
    })
    .optional(),
  imageBase64: z.string().max(6_000_000).optional(),
  imageMimeType: z.string().max(80).optional()
});

apiRouter.post('/oracle', aiLimiter, async (req: Request, res: Response) => {
  const parsed = OracleRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid Oracle request', details: parsed.error.flatten() });
    return;
  }

  const {
    message,
    history,
    language,
    profile,
    lat,
    lon,
    locationName,
    localTime,
    stream,
    style,
    imageBase64,
    imageMimeType
  } = parsed.data;

  const wantsSse = stream || req.headers.accept?.includes('text/event-stream');
  if (wantsSse) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(`event: status\ndata: ${JSON.stringify({ phase: 'analyzing_air' })}\n\n`);
  }

  try {
    const air =
      typeof lat === 'number' && typeof lon === 'number'
        ? await getLiveAirQuality(lat, lon, locationName).catch(() => null)
        : null;

    if (wantsSse) {
      res.write(`event: status\ndata: ${JSON.stringify({ phase: 'synthesizing_protocol' })}\n\n`);
    }

    const result = await generateOracleAnswer({
      message,
      history,
      language,
      profile,
      air,
      localTime: localTime || new Date().toLocaleTimeString(),
      style,
      imageBase64,
      imageMimeType
    });

    if (wantsSse) {
      res.write(`event: card\ndata: ${JSON.stringify(result)}\n\n`);
      res.write(`event: done\ndata: ${JSON.stringify({ ok: true })}\n\n`);
      res.end();
    } else {
      res.json(result);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Oracle failed';
    if (wantsSse) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

const RoutineRequestSchema = z.object({
  language: z.string().min(1).max(60).default('English'),
  profile: ProfileSchema.default({}),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  locationName: z.string().max(250).optional(),
  localTime: z.string().max(80).optional()
});

apiRouter.post('/routine', aiLimiter, async (req: Request, res: Response) => {
  const parsed = RoutineRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid routine request', details: parsed.error.flatten() });
    return;
  }
  try {
    const air = await getLiveAirQuality(parsed.data.lat, parsed.data.lon, parsed.data.locationName);
    const routine = await generateDailyRoutine({
      language: parsed.data.language,
      profile: parsed.data.profile,
      air,
      localTime: parsed.data.localTime || new Date().toLocaleTimeString()
    });
    res.json(routine);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Routine generation failed' });
  }
});

const PlaybookRequestSchema = z.object({
  playbookId: z.string().min(1).max(80),
  title: z.string().min(1).max(160),
  language: z.string().min(1).max(60).default('English'),
  profile: ProfileSchema.default({}),
  lat: z.number().optional(),
  lon: z.number().optional(),
  locationName: z.string().optional()
});

apiRouter.post('/playbook', aiLimiter, async (req: Request, res: Response) => {
  const parsed = PlaybookRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid playbook request' });
    return;
  }
  const air =
    typeof parsed.data.lat === 'number' && typeof parsed.data.lon === 'number'
      ? await getLiveAirQuality(parsed.data.lat, parsed.data.lon, parsed.data.locationName).catch(() => null)
      : null;

  const detail = await generatePlaybookDetail({
    playbookId: parsed.data.playbookId,
    title: parsed.data.title,
    language: parsed.data.language,
    profile: parsed.data.profile,
    air
  });
  res.json(detail);
});

const HealthDirectivesReqSchema = z.object({
  dependentName: z.string().min(1).max(80),
  ageGroup: z.string().min(1).max(40),
  condition: z.string().min(1).max(120),
  triggers: z.string().max(240).default('winter smog, PM2.5, diesel exhaust'),
  language: z.string().default('English'),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  locationName: z.string().optional()
});

apiRouter.post('/health-directives', aiLimiter, async (req: Request, res: Response) => {
  const parsed = HealthDirectivesReqSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid health directives request' });
    return;
  }
  try {
    const air = await getLiveAirQuality(parsed.data.lat, parsed.data.lon, parsed.data.locationName);
    const result = await generateHealthDirectives({ ...parsed.data, air });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to build health directives' });
  }
});

const AlertMessageReqSchema = z.object({
  language: z.string().default('English'),
  schoolName: z.string().min(1).max(120),
  dependentName: z.string().min(1).max(80),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  locationName: z.string().optional()
});

apiRouter.post('/alert-message', aiLimiter, async (req: Request, res: Response) => {
  const parsed = AlertMessageReqSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid alert message request' });
    return;
  }
  try {
    const air = await getLiveAirQuality(parsed.data.lat, parsed.data.lon, parsed.data.locationName);
    const result = await generateAlertMessage({ ...parsed.data, air });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Alert message generation failed' });
  }
});

const AlertLogPostSchema = z.object({
  deviceId: z.string().min(4).max(120),
  area: z.string().min(1).max(250),
  recipient: z.string().min(1).max(160),
  channel: z.string().min(1).max(40),
  messageBody: z.string().min(1).max(2000)
});

apiRouter.post('/alert-log', (req: Request, res: Response) => {
  const parsed = AlertLogPostSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid alert log entry' });
    return;
  }
  const saved = insertAlertLog(parsed.data);
  res.json({ ok: true, entry: saved });
});

apiRouter.get('/alert-log', (req: Request, res: Response) => {
  const deviceId = String(req.query.deviceId || '').trim();
  if (!deviceId) {
    res.json({ logs: [] });
    return;
  }
  res.json({ logs: getAlertLogs(deviceId) });
});

apiRouter.get('/community', (req: Request, res: Response) => {
  try {
    const area = String(req.query.area || 'Local Neighbourhood');
    const deviceId = String(req.query.deviceId || '').trim() || undefined;
    res.json(getCommunitySummary(area, deviceId));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to load community summary' });
  }
});

const PledgePostSchema = z.object({
  deviceId: z.string().min(4).max(120),
  area: z.string().min(1).max(250),
  pledgeType: z.enum(['stove_curfew', 'no_waste_burning', 'no_idle_carpool'])
});

apiRouter.post('/pledge', (req: Request, res: Response) => {
  const parsed = PledgePostSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid pledge request' });
    return;
  }
  try {
    const result = createPledge(parsed.data.deviceId, parsed.data.area, parsed.data.pledgeType);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save pledge' });
  }
});

const SolidarityJoinSchema = z.object({
  deviceId: z.string().min(4).max(120),
  area: z.string().min(1).max(250),
  contactHint: z.string().max(120).optional(),
  consentGiven: z.boolean()
});

apiRouter.post('/community/join', (req: Request, res: Response) => {
  const parsed = SolidarityJoinSchema.safeParse(req.body);
  if (!parsed.success || !parsed.data.consentGiven) {
    res.status(400).json({ error: 'Consent checkbox is required to join the Solidarity Protocol.' });
    return;
  }
  try {
    const community = joinSolidarity(
      parsed.data.deviceId,
      parsed.data.area,
      parsed.data.contactHint,
      parsed.data.consentGiven
    );
    res.json({ ok: true, community });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to join solidarity protocol' });
  }
});

const RoutePostSchema = z.object({
  from: z.object({ lat: z.number(), lon: z.number(), label: z.string().min(1).max(250) }),
  to: z.object({ lat: z.number(), lon: z.number(), label: z.string().min(1).max(250) }),
  mode: z.enum(['foot', 'bike', 'car']).default('foot')
});

apiRouter.post('/route', async (req: Request, res: Response) => {
  const parsed = RoutePostSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid route coordinates' });
    return;
  }
  try {
    let liveAir: AirQualityData;
    try {
      liveAir = await getLiveAirQuality(parsed.data.from.lat, parsed.data.from.lon, parsed.data.from.label);
    } catch {
      // Gracefully fallback to baseline air quality so route calculation never fails if air feeds are slow
      liveAir = {
        lat: parsed.data.from.lat,
        lon: parsed.data.from.lon,
        locationName: parsed.data.from.label,
        aqi: 125,
        categoryKey: 'intrusion',
        categoryLabel: 'Smog Intrusion',
        accentWord: 'Intrusion',
        pm25: 48,
        pm10: 72,
        no2: 28,
        o3: 32,
        windSpeed: 3.2,
        windDirection: 270,
        temperature: 20,
        humidity: 55,
        boundaryLayerHeight: 450,
        inversionDetected: false,
        inversionReason: 'Normal atmospheric dispersion',
        whoMultiple: 3.2,
        source: 'Open-Meteo baseline',
        updatedAt: new Date().toISOString(),
        hourly: [],
        nearbyPoints: []
      };
    }
    const routeData = await planCleanAirRoute({
      from: parsed.data.from,
      to: parsed.data.to,
      mode: parsed.data.mode,
      liveAir
    });
    res.json(routeData);
  } catch (err) {
    console.error('[API] /route planning error:', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'Route planning failed' });
  }
});

const TranslateReqSchema = z.object({
  targetLanguage: z.string().min(1).max(80),
  strings: z.record(z.string().max(1500))
});

apiRouter.post('/translate', aiLimiter, async (req: Request, res: Response) => {
  const parsed = TranslateReqSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid translation payload' });
    return;
  }
  const result = await translateStrings(parsed.data);
  res.json(result);
});

apiRouter.post('/language/resolve', aiLimiter, async (req: Request, res: Response) => {
  const query = String(req.body?.query || '').trim();
  if (!query) {
    res.status(400).json({ error: 'Language query required' });
    return;
  }
  const resolved = await resolveLanguageName(query);
  res.json(resolved);
});

apiRouter.post('/tutorial/ask', aiLimiter, async (req: Request, res: Response) => {
  const question = String(req.body?.question || '').trim();
  const language = String(req.body?.language || 'English');
  if (!question) {
    res.status(400).json({ error: 'Question required' });
    return;
  }
  const result = await askTutorialQuestion(question, language);
  res.json(result);
});

apiRouter.post('/voice-intent', aiLimiter, async (req: Request, res: Response) => {
  const transcript = String(req.body?.transcript || '').trim();
  const language = String(req.body?.language || 'English');
  const currentRoute = String(req.body?.currentRoute || '/');
  if (!transcript) {
    res.status(400).json({ error: 'Transcript required' });
    return;
  }
  const result = await parseVoiceIntent({ transcript, language, currentRoute });
  res.json(result);
});

apiRouter.post('/stt', aiLimiter, async (req: Request, res: Response) => {
  const audioBase64 = String(req.body?.audioBase64 || '');
  const mimeType = String(req.body?.mimeType || 'audio/webm');
  const expectedLanguage = String(req.body?.expectedLanguage || 'English');
  if (!audioBase64) {
    res.status(400).json({ error: 'Audio payload required' });
    return;
  }
  try {
    const result = await transcribeAudioWithGemini({ audioBase64, mimeType, expectedLanguage });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'STT transcription failed' });
  }
});

apiRouter.post('/tts', aiLimiter, async (req: Request, res: Response) => {
  const text = String(req.body?.text || '').trim();
  const language = String(req.body?.language || 'English');
  if (!text) {
    res.status(400).json({ error: 'Text required' });
    return;
  }
  const audio = await synthesizeSpeechWithGemini({ text, language });
  if (!audio) {
    res.json({ available: false });
    return;
  }
  res.json({ available: true, ...audio });
});

const PushSubscribeSchema = z.object({
  deviceId: z.string().min(4).max(120),
  area: z.string().min(1).max(120),
  alertType: z.string().optional(),
  subscription: z.object({
    endpoint: z.string().url()
  }).passthrough()
});

apiRouter.post('/push/subscribe', (req: Request, res: Response) => {
  const parsed = PushSubscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid push subscription' });
    return;
  }
  savePushSubscription(parsed.data);
  res.json({ ok: true });
});

apiRouter.post('/push/test', async (req: Request, res: Response) => {
  const deviceId = String(req.body?.deviceId || '').trim();
  const title = String(req.body?.title || 'Aetheria Inversion Watch');
  const body = String(req.body?.body || 'Thermal inversion watch test notification.');
  if (!deviceId) {
    res.status(400).json({ error: 'deviceId required' });
    return;
  }
  const result = await sendTestPush(deviceId, { title, body, url: '/alert' });
  res.json(result);
});
