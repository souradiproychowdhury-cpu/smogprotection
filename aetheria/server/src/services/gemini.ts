import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlertMessageSchema,
  HealthDirectivesSchema,
  OracleResponseSchema,
  PlaybookDetailSchema,
  RoutineResponseSchema,
  VoiceIntentSchema,
  type AirQualityData,
  type AlertMessage,
  type HealthDirectives,
  type OracleResponse,
  type PlaybookDetail,
  type RoutineResponse,
  type UserProfile,
  type VoiceIntent
} from '@aetheria/shared';
import { z } from 'zod';
import { env } from '../config/env.js';
import { buildOracleSystemPrompt, buildRoutinePrompt } from '../prompts/oracle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_MANIFEST_PATH = path.resolve(__dirname, '../../../tutorial/app-manifest.json');

function loadManifestText(): string {
  try {
    return fs.readFileSync(APP_MANIFEST_PATH, 'utf8');
  } catch {
    return '{}';
  }
}

function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

let lastGeminiDiagnostic: GeminiDiagnostic | null = null;
const disabledEndpointModels = new Set<string>();
let vertexGloballyDisabled = false;

function buildGeminiEndpoints(model: string): Array<{ label: string; url: string }> {
  const key = encodeURIComponent(env.GEMINI_API_KEY);
  const encModel = encodeURIComponent(model);
  const aiStudio = {
    label: 'Google AI Studio',
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encModel}:generateContent?key=${key}`
  };
  if (vertexGloballyDisabled) {
    return [aiStudio];
  }
  const vertex = {
    label: 'Vertex AI Express',
    url: `https://aiplatform.googleapis.com/v1/publishers/google/models/${encModel}:generateContent?key=${key}`
  };
  return [aiStudio, vertex];
}

export interface GeminiDiagnostic {
  ok: boolean;
  endpoint?: string;
  model?: string;
  latencyMs?: number;
  error?: string;
}
let aiStudioVerified = false;

export function getLastGeminiDiagnostic(): GeminiDiagnostic | null {
  return lastGeminiDiagnostic;
}

function describeNetworkError(err: unknown): { message: string; isNetworkAbort: boolean } {
  if (!(err instanceof Error)) return { message: 'Unknown Gemini error', isNetworkAbort: false };
  const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause;
  const code = cause?.code || '';
  const causeMsg = cause?.message || '';
  const full = [err.message, code, causeMsg].filter(Boolean).join(' · ');
  const isNetworkAbort = /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(full);
  return {
    message: code ? `${err.message} (${code}${causeMsg ? `: ${causeMsg}` : ''})` : err.message,
    isNetworkAbort
  };
}

function compactApiError(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string; status?: string } };
    if (parsed?.error?.message) {
      return parsed.error.message.replace(/\s+/g, ' ').trim().slice(0, 180);
    }
  } catch {
    // ignore non-JSON
  }
  return raw.replace(/\s+/g, ' ').trim().slice(0, 180);
}

async function callGeminiRaw(params: {
  systemInstruction?: string;
  parts: Array<Record<string, unknown>>;
  history?: Array<{ role: 'user' | 'model'; text: string }>;
  responseMimeType?: string;
  temperature?: number;
  maxOutputTokens?: number;
  model?: string;
  timeoutMs?: number;
}): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    lastGeminiDiagnostic = { ok: false, error: 'GEMINI_API_KEY is missing in aetheria/.env' };
    throw new Error('GEMINI_API_KEY_MISSING');
  }

  const primaryModel = params.model || env.GEMINI_MODEL || 'gemini-2.5-flash';
  const modelsToTry = Array.from(
    new Set([
      primaryModel,
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-3.8-flash',
      'gemini-3-flash-preview',
      'gemini-1.5-flash',
      'gemini-flash-latest'
    ])
  );

  const contents = [
    ...(params.history || []).slice(-8).map((h) => ({
      role: h.role,
      parts: [{ text: h.text }]
    })),
    { role: 'user', parts: params.parts }
  ];

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: params.temperature ?? 0.35,
      maxOutputTokens: params.maxOutputTokens ?? 4096,
      ...(params.responseMimeType ? { responseMimeType: params.responseMimeType } : {})
    }
  };

  if (params.systemInstruction) {
    body.systemInstruction = { parts: [{ text: params.systemInstruction }] };
  }

  let lastErr: unknown;
  let preferredAiStudioDiag: GeminiDiagnostic | null = null;

  for (const model of modelsToTry) {
    const endpoints = buildGeminiEndpoints(model).filter(
      (ep) => !(aiStudioVerified && ep.label === 'Vertex AI Express')
    );
    for (const ep of endpoints) {
      const cacheKey = `${ep.label}:${model}`;
      if (disabledEndpointModels.has(cacheKey)) continue;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 14000);
      const t0 = Date.now();
      try {
        const res = await fetch(ep.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          const shortErr = compactApiError(errText);
          if (res.status === 404 || res.status === 403) {
            disabledEndpointModels.add(cacheKey);
          }
          if (
            ep.label === 'Vertex AI Express' &&
            (res.status === 403 || res.status === 401) &&
            /has not been used|disabled|PERMISSION_DENIED|API_KEY_INVALID/i.test(errText)
          ) {
            vertexGloballyDisabled = true;
          }
          const errMsg = `${ep.label} HTTP ${res.status}${shortErr ? `: ${shortErr}` : ''}`;
          if (ep.label === 'Google AI Studio') {
            preferredAiStudioDiag = {
              ok: false,
              endpoint: ep.label,
              model,
              latencyMs: Date.now() - t0,
              error: errMsg
            };
          }
          throw new Error(errMsg);
        }
        const data = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
        if (!text.trim()) throw new Error(`Empty response from ${ep.label}`);
        if (ep.label === 'Google AI Studio') {
          aiStudioVerified = true;
        }
        lastGeminiDiagnostic = {
          ok: true,
          endpoint: ep.label,
          model,
          latencyMs: Date.now() - t0
        };
        return text;
      } catch (err) {
        const desc = describeNetworkError(err);
        const wrapped = new Error(desc.message);
        lastErr = wrapped;
        lastGeminiDiagnostic = preferredAiStudioDiag || {
          ok: false,
          endpoint: ep.label,
          model,
          error: desc.message
        };
        // DNS/connection failures won't recover on another endpoint, skip fast
        if (desc.isNetworkAbort) {
          throw wrapped;
        }
      } finally {
        clearTimeout(timer);
      }
    }
  }
  throw lastErr || new Error(preferredAiStudioDiag?.error || 'All configured Gemini endpoints/models failed');
}

export async function verifyGeminiConnection(): Promise<GeminiDiagnostic> {
  if (!env.GEMINI_API_KEY) {
    return { ok: false, error: 'GEMINI_API_KEY is not set in aetheria/.env' };
  }

  const t0 = Date.now();
  let registryOk = false;
  let registryError: string | null = null;

  try {
    const regRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (regRes.ok) {
      registryOk = true;
      aiStudioVerified = true;
    } else {
      const txt = await regRes.text().catch(() => '');
      registryError = `Google AI Studio HTTP ${regRes.status}: ${txt.slice(0, 180)}`;
    }
  } catch (err) {
    registryError = describeNetworkError(err).message;
  }

  try {
    await callGeminiRaw({
      parts: [{ text: 'Reply with OK' }],
      temperature: 0,
      maxOutputTokens: 64,
      timeoutMs: 18000
    });
    return lastGeminiDiagnostic || { ok: true, endpoint: 'Google AI Studio', model: env.GEMINI_MODEL, latencyMs: Date.now() - t0 };
  } catch (err) {
    const baseErr =
      lastGeminiDiagnostic?.error ||
      (err instanceof Error ? err.message : 'Gemini verification failed');

    if (registryOk && /aborted|timeout|HTTP 503|HTTP 429/i.test(baseErr)) {
      return {
        ok: false,
        endpoint: 'Google AI Studio',
        model: lastGeminiDiagnostic?.model || env.GEMINI_MODEL,
        latencyMs: Date.now() - t0,
        error: `API key is valid, but Gemini inference is temporarily busy (${baseErr.replace(/\s+/g, ' ').slice(0, 120)}).`
      };
    }

    const finalErr = registryError && !registryOk ? `${registryError} (${baseErr})` : baseErr;
    const hint = /HTTP 400|HTTP 401|HTTP 403/i.test(finalErr)
      ? ' — Please check GEMINI_API_KEY in aetheria/.env (get a free key at https://aistudio.google.com/apikey).'
      : '';
    return {
      ...(lastGeminiDiagnostic || { ok: false }),
      ok: false,
      error: `${finalErr}${hint}`
    };
  }
}

function normalizeOraclePayload(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = { ...(raw as Record<string, unknown>) };

  obj.title = String(obj.title || 'Clean-Air Action Protocol').trim() || 'Clean-Air Action Protocol';
  obj.summary = String(obj.summary || 'Practical steps tailored to your current air quality and home setup.').trim() || 'Practical steps tailored to your current air quality and home setup.';
  obj.evidenceNote = String(obj.evidenceNote || 'Based on WHO air quality guidelines and peer-reviewed indoor filtration evidence.').trim() || 'Based on WHO air quality guidelines and peer-reviewed indoor filtration evidence.';

  const urg = String(obj.urgency || '').toLowerCase();
  obj.urgency = ['immediate', 'today', 'this_week', 'info'].includes(urg)
    ? urg
    : /high|urgent|now|critical/.test(urg)
      ? 'immediate'
      : /week/.test(urg)
        ? 'this_week'
        : 'today';

  if (Array.isArray(obj.steps) && obj.steps.length > 0) {
    obj.steps = obj.steps.slice(0, 6).map((s, idx) => {
      const step = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
      return {
        n: Math.max(1, Math.round(Number(step.n) || idx + 1)),
        label: String(step.label || `Step ${idx + 1}`).trim() || `Step ${idx + 1}`,
        detail: String(step.detail || step.label || 'Follow this clean-air step today.').trim() || 'Follow this clean-air step today.'
      };
    });
  } else {
    obj.steps = [
      {
        n: 1,
        label: 'Check live AQI & seal indoor air',
        detail: 'Close drafty windows during high PM2.5 and run HEPA or MERV-13 filtration.'
      }
    ];
  }

  if (Array.isArray(obj.impact) && obj.impact.length > 0) {
    obj.impact = obj.impact.slice(0, 4).map((item) => {
      const imp = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const kind = String(imp.kind || '').toLowerCase();
      return {
        metric: String(imp.metric || 'Air Impact').trim() || 'Air Impact',
        value: String(imp.value || 'Estimated improvement').trim() || 'Estimated improvement',
        basis: String(imp.basis || 'Evidence-based clean-air model estimate').trim() || 'Evidence-based clean-air model estimate',
        kind: ['health', 'money', 'carbon', 'time'].includes(kind)
          ? kind
          : /cost|save|money|inr|usd|rupee|dollar/.test(kind)
            ? 'money'
            : /co2|carbon|emission/.test(kind)
              ? 'carbon'
              : /time|min|hour/.test(kind)
                ? 'time'
                : 'health',
        isEstimate: imp.isEstimate !== false
      };
    });
  } else {
    obj.impact = [
      {
        metric: 'Indoor PM2.5 Exposure',
        value: 'Est. -50% to -75%',
        basis: 'Sealed room + mechanical filtration mass-balance estimate',
        kind: 'health',
        isEstimate: true
      }
    ];
  }

  if (obj.remedy && typeof obj.remedy === 'object') {
    const rem = obj.remedy as Record<string, unknown>;
    const ev = String(rem.evidence || '').toLowerCase();
    obj.remedy = {
      title: String(rem.title || 'Evidence Note').trim() || 'Evidence Note',
      text: String(rem.text || 'Use mechanical HEPA/MERV-13 filtration and plain saline nasal rinse if airways feel irritated.').trim() || 'Use mechanical HEPA/MERV-13 filtration and plain saline nasal rinse if airways feel irritated.',
      evidence: ['strong', 'moderate', 'weak'].includes(ev)
        ? ev
        : /high/.test(ev)
          ? 'strong'
          : /low|minimal|none/.test(ev)
            ? 'weak'
            : 'moderate'
    };
  } else {
    obj.remedy = {
      title: 'Practical Air Care',
      text: 'Mechanical HEPA/MERV-13 filtration removes fine PM2.5; plain saline rinse helps soothe dry airways.',
      evidence: 'strong'
    };
  }

  if (obj.confidence && typeof obj.confidence === 'object') {
    const conf = obj.confidence as Record<string, unknown>;
    const lvl = String(conf.level || '').toLowerCase();
    obj.confidence = {
      level: ['high', 'medium', 'low'].includes(lvl)
        ? lvl
        : /very|strong/.test(lvl)
          ? 'high'
          : 'medium',
      reason: String(conf.reason || 'Based on live air readings and household profile').trim() || 'Based on live air readings and household profile'
    };
  } else {
    obj.confidence = {
      level: 'medium',
      reason: 'Based on live air readings and household profile'
    };
  }

  if (Array.isArray(obj.followUps)) {
    const cleaned = obj.followUps.map((f) => String(f)).filter(Boolean).slice(0, 4);
    obj.followUps = cleaned.length > 0 ? cleaned : ['When should I open windows today?'];
  } else {
    obj.followUps = ['When should I open windows today?', 'How do I build a DIY MERV-13 filter?'];
  }

  if (Array.isArray(obj.actions)) {
    obj.actions = obj.actions.map((a) => {
      const act = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
      const t = String(act.type || 'none');
      return {
        type: ['open_route', 'open_health', 'open_alert', 'set_reminder', 'none'].includes(t) ? t : 'none',
        label: String(act.label || 'Open').trim() || 'Open',
        payload: act.payload && typeof act.payload === 'object' ? act.payload : {}
      };
    });
  } else {
    obj.actions = [];
  }

  return obj;
}

async function callGeminiJsonValidated<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  params: {
    systemInstruction?: string;
    prompt: string;
    history?: Array<{ role: 'user' | 'model'; text: string }>;
    extraParts?: Array<Record<string, unknown>>;
    temperature?: number;
    normalize?: (raw: unknown) => unknown;
  }
): Promise<T> {
  const parts: Array<Record<string, unknown>> = [{ text: params.prompt }, ...(params.extraParts || [])];
  const raw1 = await callGeminiRaw({
    systemInstruction: params.systemInstruction,
    parts,
    history: params.history,
    responseMimeType: 'application/json',
    temperature: params.temperature ?? 0.3
  });

  try {
    const parsed1 = JSON.parse(stripJsonFences(raw1));
    return schema.parse(params.normalize ? params.normalize(parsed1) : parsed1);
  } catch (firstErr) {
    // Retry once asking Gemini to repair the JSON to match schema
    const repairPrompt = `Your previous output failed JSON schema validation (${firstErr instanceof Error ? firstErr.message : 'invalid JSON'}). Return ONLY corrected valid JSON matching the exact schema requested. Previous output:\n${raw1.slice(0, 1500)}`;
    const raw2 = await callGeminiRaw({
      systemInstruction: params.systemInstruction,
      parts: [{ text: repairPrompt }],
      responseMimeType: 'application/json',
      temperature: 0.1
    });
    const parsed2 = JSON.parse(stripJsonFences(raw2));
    return schema.parse(params.normalize ? params.normalize(parsed2) : parsed2);
  }
}

function buildQuestionAwareFallback(params: {
  message: string;
  profile: UserProfile;
  air: AirQualityData | null;
  errMsg: string;
  missingKey: boolean;
}): OracleResponse {
  const q = params.message.toLowerCase();
  const pm25 = params.air?.pm25 ?? 60;
  const aqi = params.air?.aqi ?? 140;
  const loc = params.air?.locationName || 'your area';
  const wind = params.air?.windSpeed ?? 2;
  const isHazardous = aqi >= 151;
  const isSensitive = params.profile.householdGroups.some((g) => ['asthma', 'copd', 'infant', 'elderly', 'child'].includes(g));
  const safetyNote = isSensitive
    ? 'General guidance only, not medical advice. Seek urgent emergency care for wheezing, chest pain, or infant breathing distress.'
    : null;
  const confidenceReason = params.missingKey
    ? 'Rule-based fallback using live air readings (set GEMINI_API_KEY for full GenAI synthesis)'
    : `Fallback after Gemini API error: ${params.errMsg}`;

  if (/commute|metro|bike|cycle|walk|travel|bus|car|route/.test(q)) {
    return {
      title: `Smart Commute Guidance for ${loc} (AQI ${aqi})`,
      urgency: isHazardous ? 'immediate' : 'today',
      summary: `At PM2.5 ${pm25} µg/m³ (US AQI ${aqi}) in ${loc}, cycling or open motorbike riding increases inhaled dose by ~1.4–1.65× due to heavier breathing near tailpipes. Choosing underground metro/rail or a low-traffic side street cuts exposure significantly.`,
      assemblyTime: 'Before leaving',
      steps: [
        {
          n: 1,
          label: 'Switch from open road cycling/bike',
          detail: `Use enclosed metro/rail (0.55× exposure) or the Clean-Air Route navigator to avoid arterial diesel corridors.`
        },
        {
          n: 2,
          label: aqi >= 100 ? 'Wear a snug N95 / FFP2 mask' : 'Time departure with wind',
          detail: aqi >= 100
            ? 'Pinch the nose bridge firmly so air does not leak around cheeks during roadside waits.'
            : `Current wind is ${wind} m/s; check the 3-hour forecast window before heading out.`
        },
        {
          n: 3,
          label: 'Wash face & hands on arrival',
          detail: 'Remove outer dust and rinse eyes/nose with clean water or plain saline when stepping indoors.'
        }
      ],
      impact: [
        {
          metric: 'Metro vs Motorbike/Cycle',
          value: 'Est. -60% to -70% inhaled PM2.5',
          basis: 'Lower breathing minute-ventilation + enclosed cabin vs roadside exhaust plume',
          kind: 'health',
          isEstimate: true
        },
        {
          metric: 'Car-to-Metro CO₂ Shift',
          value: 'Est. -1.36 kg CO₂ / 10 km',
          basis: 'DEFRA/CEA transit emission factors (0.171 vs 0.035 kg CO₂e/km)',
          kind: 'carbon',
          isEstimate: true
        }
      ],
      remedy: {
        title: 'Clean-Air Route Planner & Timing',
        text: 'Use the Clean-Air Route tool to compare exposure (Concentration × Time) on real streets before starting your trip.',
        evidence: 'strong'
      },
      evidenceNote: 'Roadside PM2.5 and NO₂ drop steeply 50–150m away from major highways; tight-fitting N95/FFP2 respirators filter ≥95% of fine particulates.',
      safetyNote,
      confidence: { level: 'medium', reason: confidenceReason },
      followUps: [
        'When is the cleanest hour to step outside today?',
        'How do I check if my N95 mask seals properly?',
        'What should I do indoors when I get home?'
      ],
      actions: [
        { type: 'open_route', label: 'Open Real Road Clean-Air Route', payload: {} },
        { type: 'open_health', label: 'Check Vulnerable Profile', payload: {} }
      ]
    };
  }

  if (/cook|stove|kitchen|lpg|wood|coal|induction|smoke/.test(q)) {
    return {
      title: `Low-Emission Kitchen & Stove Protocol`,
      urgency: params.profile.fuel === 'wood' || params.profile.fuel === 'coal' ? 'immediate' : 'today',
      summary: `When outdoor air in ${loc} is already at AQI ${aqi} (PM2.5 ${pm25} µg/m³), indoor cooking smoke gets trapped inside sealed rooms. Exhaust ventilation and clean-fuel habits prevent dangerous indoor PM2.5 and NO₂ spikes.`,
      assemblyTime: '2 mins',
      steps: [
        {
          n: 1,
          label: 'Turn on kitchen exhaust & cover pots',
          detail: 'Run the range hood or exhaust fan before lighting the stove and keep lids on pots to cut moisture, oil aerosols, and NO₂.'
        },
        {
          n: 2,
          label: 'Avoid solid fuels & dry-charring indoors',
          detail: 'Never burn wood, charcoal, incense, or candles indoors; use induction or well-ventilated LPG on medium heat.'
        },
        {
          n: 3,
          label: 'Run filtration for 20 mins post-cooking',
          detail: 'Keep the bedroom door shut while cooking and run HEPA/MERV-13 filtration until cooking haze clears.'
        }
      ],
      impact: [
        {
          metric: 'Kitchen NO₂ & Aerosol Cut',
          value: 'Est. -50% to -65%',
          basis: 'Active range hood exhaust + covered pots vs unvented gas/solid-fuel frying',
          kind: 'health',
          isEstimate: true
        },
        {
          metric: 'Solid Fuel to Induction',
          value: 'Est. -180 µg/m³ indoor peak',
          basis: 'WHO Indoor Air Quality Guidelines for household fuel combustion',
          kind: 'health',
          isEstimate: true
        }
      ],
      remedy: {
        title: 'Honest Check on Simmer Pots',
        text: 'Simmering water with spices adds pleasant scent/humidity, but does NOT remove PM2.5 particles—only exhaust and HEPA/MERV-13 filtration remove particulates.',
        evidence: 'moderate'
      },
      evidenceNote: 'WHO IAQ guidelines confirm unvented solid fuels and unvented gas searing are top indoor drivers of PM2.5 and NO₂.',
      safetyNote,
      confidence: { level: 'medium', reason: confidenceReason },
      followUps: [
        'How do I build an affordable box-fan air purifier?',
        'When is it safe to open windows for fresh air?',
        'Compare LPG vs induction daily cost'
      ],
      actions: [
        { type: 'set_reminder', label: 'Remind me to vent after cooking', payload: {} },
        { type: 'open_health', label: 'Check Household Shield', payload: {} }
      ]
    };
  }

  if (/asthma|child|baby|infant|elder|breathe|cough|wheeze|school|safe.*outside/.test(q)) {
    return {
      title: `Sensitive Household Protection (AQI ${aqi} in ${loc})`,
      urgency: aqi > 100 ? 'immediate' : 'today',
      summary: `Live readings in ${loc} show US AQI ${aqi} (PM2.5 ${pm25} µg/m³, ${params.air?.whoMultiple ?? Math.round((pm25 / 15) * 10) / 10}× WHO 24h limit). For children, seniors, and asthma/COPD patients, keeping a sealed, filtered bedroom and shifting outdoor play indoors is the highest-impact protection.`,
      assemblyTime: '5 mins',
      steps: [
        {
          n: 1,
          label: 'Keep outdoor play & PE indoors',
          detail: aqi > 100
            ? 'Request indoor recess/PE today—children breathe faster during play and inhale more PM2.5 per kg body weight.'
            : 'Keep outdoor walks gentle and away from busy traffic junctions.'
        },
        {
          n: 2,
          label: 'Maintain a clean-air sleep sanctuary',
          detail: 'Seal bedroom window/door gaps and run a HEPA or DIY MERV-13 box-fan purifier continuously overnight.'
        },
        {
          n: 3,
          label: 'Keep prescribed reliever & spacer handy',
          detail: 'Check remaining inhaler doses in Health Shield and follow your doctor’s written asthma/COPD action plan.'
        }
      ],
      impact: [
        {
          metric: 'Clean-Room PM2.5 Drop',
          value: 'Est. -55% to -75%',
          basis: 'Sealed bedroom + continuous CADR filtration vs unsealed ambient air',
          kind: 'health',
          isEstimate: true
        },
        {
          metric: 'WHO Guideline Ratio',
          value: `${params.air?.whoMultiple ?? Math.round((pm25 / 15) * 10) / 10}× WHO 24h limit`,
          basis: 'Live outdoor PM2.5 divided by 15 µg/m³ WHO 2021 24-hour guideline',
          kind: 'health',
          isEstimate: true
        }
      ],
      remedy: {
        title: 'Saline Nasal Rinse & Hydration',
        text: 'Isotonic saline nasal spray/rinse and warm fluids soothe irritated airways. Avoid eucalyptus steam or essential oils for asthma/infants.',
        evidence: 'moderate'
      },
      evidenceNote: 'Mechanical HEPA/MERV-13 filtration and avoiding outdoor exertion during AQI > 100 have strong clinical evidence for reducing asthma exacerbations.',
      safetyNote: 'General guidance only, not medical advice. Call emergency services immediately for severe wheezing, chest tightness, blue lips, or infant breathing distress.',
      confidence: { level: 'medium', reason: confidenceReason },
      followUps: [
        'Draft a school indoor-recess advisory message',
        'How do I build a DIY MERV-13 box-fan filter?',
        'What is the best ventilation window today?'
      ],
      actions: [
        { type: 'open_health', label: 'Open Health Shield', payload: {} },
        { type: 'open_alert', label: 'Send School Advisory', payload: {} }
      ]
    };
  }

  if (/window|ventilat|open.*air|fresh air|cleanest hour/.test(q)) {
    const next12 = params.air?.hourly?.slice(0, 12) || [];
    const bestHour = next12.reduce(
      (best, curr) => (!best || curr.pm25 < best.pm25 ? curr : best),
      next12[0]
    );
    const bestLabel = bestHour
      ? new Date(bestHour.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : 'early afternoon (1:00–3:00 PM)';
    const bestPm = bestHour?.pm25 ?? pm25;
    const bestBlh = bestHour?.boundaryLayerHeight ?? params.air?.boundaryLayerHeight ?? 420;
    const bestWind = bestHour?.windSpeed ?? wind;

    return {
      title: `Best Ventilation Window for ${loc}`,
      urgency: aqi > 150 ? 'immediate' : 'today',
      summary: `In ${loc}, current outdoor PM2.5 is ${pm25} µg/m³ (AQI ${aqi}). ${bestHour
          ? `Forecast data shows the cleanest dispersion around ${bestLabel} (PM2.5 ~${bestPm} µg/m³, wind ${bestWind} m/s, boundary layer ${bestBlh}m).`
          : 'Mid-afternoon typically provides maximum thermal mixing and boundary-layer height.'
        } Ventilate briefly during that window, then reseal before evening cooling.`,
      assemblyTime: '20–30 min window',
      steps: [
        {
          n: 1,
          label: `Wait until ${bestLabel}`,
          detail: `Avoid opening windows during early morning or evening thermal inversions when ground PM2.5 spikes.`
        },
        {
          n: 2,
          label: 'Cross-ventilate for 15–25 minutes',
          detail: 'Open opposite windows to flush indoor CO₂ and cooking moisture quickly without letting smog linger.'
        },
        {
          n: 3,
          label: 'Reseal & run filtration immediately after',
          detail: 'Close latches, block door gaps, and run HEPA or DIY MERV-13 filtration for 30 minutes to scrub incoming particles.'
        }
      ],
      impact: [
        {
          metric: 'Optimal Outdoor PM2.5',
          value: `Est. ${bestPm} µg/m³ at ${bestLabel}`,
          basis: 'Hourly Open-Meteo PM2.5 and atmospheric boundary-layer forecast',
          kind: 'time',
          isEstimate: true
        },
        {
          metric: 'Post-Ventilation Scrub',
          value: 'Est. -55% to -75% PM2.5',
          basis: 'Resealing room envelope + running CADR filtration for 30 minutes',
          kind: 'health',
          isEstimate: true
        }
      ],
      remedy: {
        title: 'Monitor Wind & Boundary Layer',
        text: 'Wind speeds above 2.5 m/s and boundary-layer height above 400m dramatically speed up urban smog dispersion.',
        evidence: 'strong'
      },
      evidenceNote: 'Timed short cross-ventilation prevents indoor CO₂ buildup while minimizing cumulative PM2.5 infiltration.',
      safetyNote,
      confidence: { level: 'medium', reason: confidenceReason },
      followUps: [
        'How do I build a DIY MERV-13 filter?',
        'Is metro safer than cycling right now?',
        'How do I keep my bedroom sealed overnight?'
      ],
      actions: [
        { type: 'set_reminder', label: `Remind me at ${bestLabel}`, payload: {} },
        { type: 'open_alert', label: 'Check Inversion Physics', payload: {} }
      ]
    };
  }

  if (/diy|merv|box.?fan|corsi|purifier|hepa|filter/.test(q)) {
    return {
      title: 'DIY Box-Fan MERV-13 Purifier Guide',
      urgency: isHazardous ? 'immediate' : 'today',
      summary: `A 20-inch box fan paired with a pleated MERV-13 (or F7/F8) furnace filter achieves 250–300 m³/h Clean Air Delivery Rate at roughly a quarter of the price of a commercial HEPA purifier—cutting bedroom PM2.5 in ${loc} by 50–80%.`,
      assemblyTime: '15 mins',
      steps: [
        {
          n: 1,
          label: 'Check filter airflow arrow',
          detail: 'Place the MERV-13 filter on the INTAKE (back) side of the box fan with the airflow arrow pointing into the fan blades.'
        },
        {
          n: 2,
          label: 'Seal all 4 edges tightly',
          detail: 'Use wide painter’s/duct tape or cardboard shrouds around the frame edges so dirty air cannot bypass the filter.'
        },
        {
          n: 3,
          label: 'Run on Low or Medium in a closed room',
          detail: 'Keep the fan 30 cm away from walls/curtains and keep bedroom windows/doors closed for fastest PM2.5 drawdown.'
        }
      ],
      impact: [
        {
          metric: 'Bedroom PM2.5 Reduction',
          value: 'Est. -50% to -80% in 45 mins',
          basis: 'UC Davis / EPA chamber testing (~270 m³/h CADR in a 36 m³ room)',
          kind: 'health',
          isEstimate: true
        },
        {
          metric: 'Upfront Cost Savings',
          value: 'Est. 75% cheaper than HEPA unit',
          basis: 'Standard fan + MERV-13 pleated filter vs retail HEPA purifier',
          kind: 'money',
          isEstimate: true
        }
      ],
      remedy: {
        title: 'Filter Replacement & Safety Check',
        text: 'Use a modern fan with a thermal fuse, never block motor vents, and replace the MERV-13 filter when it turns dark grey (every 2–4 months in heavy smog).',
        evidence: 'strong'
      },
      evidenceNote: 'Peer-reviewed indoor air studies confirm taped MERV-13 box-fan purifiers match mid-range commercial HEPA CADR for fine PM2.5.',
      safetyNote,
      confidence: { level: 'medium', reason: confidenceReason },
      followUps: [
        'When should I open windows today?',
        'How do I seal drafty windows cheaply?',
        'Do indoor plants clean winter smog?'
      ],
      actions: [
        { type: 'open_health', label: 'Check Household Shield', payload: {} },
        { type: 'set_reminder', label: 'Remind me to check filter', payload: {} }
      ]
    };
  }

  if (/mask|n95|ffp2|kf94|respirator|seal/.test(q)) {
    return {
      title: 'N95 / FFP2 Mask Fit & Seal Check',
      urgency: aqi >= 100 ? 'immediate' : 'today',
      summary: `At ${loc}'s current PM2.5 (${pm25} µg/m³, AQI ${aqi}), a well-sealed N95, FFP2, or KF94 respirator filters ≥94–95% of fine soot. Cloth and loose blue surgical masks leak around the nose and cheeks, letting up to 50–70% of fine PM2.5 bypass.`,
      assemblyTime: '1 min',
      steps: [
        {
          n: 1,
          label: 'Mould the metal nose wire with both hands',
          detail: 'Press the nose clip down along both sides of your nose bridge—never pinch with one hand into a sharp peak.'
        },
        {
          n: 2,
          label: 'Run the positive-pressure exhale check',
          detail: 'Cup hands gently over the mask edges and exhale sharply; if air puffs up toward your eyes/glasses, readjust the nose wire and strap tension.'
        },
        {
          n: 3,
          label: 'Replace when damp or straps loosen',
          detail: 'Never wash disposable N95/FFP2 masks with water or soap, as that destroys their electrostatic melt-blown filter charge.'
        }
      ],
      impact: [
        {
          metric: 'Inhaled PM2.5 Reduction',
          value: 'Est. -75% to -95%',
          basis: 'NIOSH/EN149 electrostatic filtration efficiency with proper facial seal',
          kind: 'health',
          isEstimate: true
        },
        {
          metric: 'Cloth vs N95 Gap',
          value: 'Est. 3× better protection',
          basis: 'Sub-micron PM2.5 penetrates woven cotton and leaks around unsealed surgical masks',
          kind: 'health',
          isEstimate: true
        }
      ],
      remedy: {
        title: 'Eyewear Fog Test',
        text: 'If your glasses fog immediately when wearing a mask, warm unfiltered air is leaking upward along the nose bridge—tighten the upper strap and re-mould the wire.',
        evidence: 'strong'
      },
      evidenceNote: 'Electrostatic N95/FFP2/KF94 respirators have strong clinical evidence against PM2.5; facial hair under the seal reduces fit.',
      safetyNote,
      confidence: { level: 'medium', reason: confidenceReason },
      followUps: [
        'Is metro safer than cycling right now?',
        'Plan a low-exposure road route',
        'How do I protect children who cannot wear tight masks?'
      ],
      actions: [
        { type: 'open_route', label: 'Open Clean-Air Road Route', payload: {} },
        { type: 'open_health', label: 'Check Vulnerable Profile', payload: {} }
      ]
    };
  }

  if (/plant|simmer|humidif|myth|salt lamp|candle|incense/.test(q)) {
    return {
      title: 'Honest Evidence Check: Plants, Simmer Pots & Myths',
      urgency: 'info',
      summary: `While houseplants and humidifiers add comfort, peer-reviewed studies show they remove less than 2% of indoor PM2.5 in real homes—and burning incense, candles, or essential oils actually adds dangerous indoor PM2.5 and VOCs.`,
      assemblyTime: '2 mins',
      steps: [
        {
          n: 1,
          label: 'Use mechanical filtration for PM2.5',
          detail: 'Only HEPA or MERV-13 pleated filters physically capture fine combustion particles from room air.'
        },
        {
          n: 2,
          label: 'Avoid burning incense, candles, or camphor',
          detail: 'Even "natural" smoke releases ultrafine soot and PAHs inside sealed rooms.'
        },
        {
          n: 3,
          label: 'Keep plants for wellbeing, not smog scrubbing',
          detail: 'Wipe dust off plant leaves weekly with a damp cloth and avoid overwatering to prevent indoor mould.'
        }
      ],
      impact: [
        {
          metric: 'Houseplants PM2.5 Removal',
          value: 'Est. <2% in real rooms',
          basis: 'Cummings & Waring (2019) review of chamber vs real-room CADR',
          kind: 'health',
          isEstimate: true
        },
        {
          metric: 'HEPA / MERV-13 Removal',
          value: 'Est. -55% to -80% PM2.5',
          basis: 'Mechanical filtration CADR mass-balance model',
          kind: 'health',
          isEstimate: true
        }
      ],
      remedy: {
        title: 'Plain Saline & Damp Mopping',
        text: 'Wet-mopping floors and wiping surfaces with a damp microfiber cloth traps settled road dust without kicking it back into the air.',
        evidence: 'strong'
      },
      evidenceNote: 'Classic NASA plant studies tested sealed small boxes for VOCs—not open homes during urban PM2.5 smog episodes.',
      safetyNote,
      confidence: { level: 'medium', reason: confidenceReason },
      followUps: [
        'How do I build a DIY MERV-13 filter?',
        'When should I open windows today?',
        'What cooking habits lower indoor pollution?'
      ],
      actions: [
        { type: 'open_health', label: 'Check Household Shield', payload: {} }
      ]
    };
  }

  if (/current.*(air|aqi|pm|smog|wind)|air quality|inversion|status|forecast/.test(q)) {
    const inv = params.air?.inversionDetected;
    const blh = params.air?.boundaryLayerHeight ?? 420;
    return {
      title: `Live Air & Inversion Report for ${loc}`,
      urgency: isHazardous ? 'immediate' : 'today',
      summary: `${loc} is currently at US AQI ${aqi} (PM2.5 ${pm25} µg/m³, ${params.air?.whoMultiple ?? Math.round((pm25 / 15) * 10) / 10}× the WHO 24-hour guideline). Wind speed is ${wind} m/s with a ${blh}m boundary layer${inv ? ' — an active thermal inversion is trapping surface smog.' : '.'}`,
      assemblyTime: 'Live telemetry',
      steps: [
        {
          n: 1,
          label: aqi > 100 ? 'Keep bedrooms sealed & filtered' : 'Normal precautions with ventilation',
          detail: aqi > 100
            ? 'Close drafty windows and run HEPA or DIY MERV-13 filtration indoors.'
            : 'Air quality is moderate—brief cross-ventilation is fine away from peak traffic.'
        },
        {
          n: 2,
          label: 'Protect high-risk household members',
          detail: 'Check Health Shield thresholds for children, seniors, and anyone with asthma/COPD.'
        },
        {
          n: 3,
          label: 'Time outdoor errands with wind dispersion',
          detail: `Current wind is ${wind} m/s; check the 12-hour PM2.5 forecast chart on Sanctuary before stepping out.`
        }
      ],
      impact: [
        {
          metric: 'WHO 24h Guideline Ratio',
          value: `${params.air?.whoMultiple ?? Math.round((pm25 / 15) * 10) / 10}× limit (15 µg/m³)`,
          basis: `Live ${params.air?.source || 'station/Open-Meteo'} reading`,
          kind: 'health',
          isEstimate: true
        },
        {
          metric: 'Atmospheric Mixing Height',
          value: `${blh} m (${inv ? 'Inversion Active' : 'Normal Mixing'})`,
          basis: 'Open-Meteo planetary boundary-layer height + 10m wind speed',
          kind: 'health',
          isEstimate: true
        }
      ],
      remedy: {
        title: inv ? 'Thermal Inversion Watch' : 'Clean-Air Timing',
        text: params.air?.inversionReason || 'Track hourly boundary-layer height and wind speed on the Inversion Alert screen.',
        evidence: 'strong'
      },
      evidenceNote: 'WHO 2021 guidelines set 15 µg/m³ as the 24-hour PM2.5 benchmark; shallow boundary layers (<250m) trap vehicle and stove emissions near ground level.',
      safetyNote,
      confidence: { level: 'high', reason: `Based on live telemetry (${params.air?.source || 'Open-Meteo / WAQI'})` },
      followUps: [
        'When should I open windows today?',
        'Is metro safer than cycling right now?',
        'How do I protect my family tonight?'
      ],
      actions: [
        { type: 'open_alert', label: 'Open Inversion Alert', payload: {} },
        { type: 'open_route', label: 'Find Clean-Air Road Route', payload: {} }
      ]
    };
  }

  return {
    title: params.missingKey
      ? 'Offline-Safe Clean-Air Guidance (Gemini Key Needed for Live AI)'
      : `Clean-Air Action Plan for ${loc} (AQI ${aqi})`,
    urgency: isHazardous ? 'immediate' : 'today',
    summary: params.missingKey
      ? `GEMINI_API_KEY is not configured on the server, so this guidance uses Aetheria's evidence rules for ${loc} (AQI ${aqi}, PM2.5 ${pm25} µg/m³). Add a valid key in aetheria/.env for live AI answers.`
      : `Live readings in ${loc} show US AQI ${aqi} (PM2.5 ${pm25} µg/m³). Live AI could not be reached (${params.errMsg}), so here is targeted evidence-based guidance.`,
    assemblyTime: '5 mins',
    steps: [
      {
        n: 1,
        label: 'Seal main bedroom gaps',
        detail: 'Close windows and place damp rolled towels or weatherstripping along bottom door and sash gaps.'
      },
      {
        n: 2,
        label: 'Run filtration or DIY box-fan filter',
        detail: 'Run a HEPA purifier or strap a MERV-13 filter onto a box fan on medium speed inside the closed room.'
      },
      {
        n: 3,
        label: 'Avoid indoor combustion',
        detail: 'Use exhaust hood while cooking; avoid candles, incense, or unvented wood/coal heating.'
      }
    ],
    impact: [
      {
        metric: 'Indoor PM2.5 drop',
        value: 'Est. -55% to -75%',
        basis: 'Box-fan + MERV-13 or HEPA CADR in a ~36 m³ closed room',
        kind: 'health',
        isEstimate: true
      },
      {
        metric: 'DIY vs Commercial Purifier',
        value: 'Est. 75% lower upfront cost',
        basis: 'MERV-13 filter + standard box fan vs mid-range HEPA unit',
        kind: 'money',
        isEstimate: true
      }
    ],
    remedy: {
      title: 'Warm saline rinse & hydration',
      text: 'Plain saline nasal rinse and warm fluids help soothe irritated upper airways. Note: steam or simmering pots do not remove fine PM2.5 from room air.',
      evidence: 'moderate'
    },
    evidenceNote: 'Mechanical HEPA/MERV-13 filtration has strong evidence for lowering indoor PM2.5; houseplants and vapor pots have minimal effect on fine particulates.',
    safetyNote,
    confidence: { level: 'medium', reason: confidenceReason },
    followUps: [
      'When should I open windows today?',
      'Is metro safer than cycling right now?',
      'How do I build a DIY MERV-13 filter?'
    ],
    actions: [
      { type: 'open_route', label: 'Find Clean-Air Road Route', payload: {} },
      { type: 'open_health', label: 'Check Vulnerable Profile', payload: {} }
    ]
  };
}

export async function generateOracleAnswer(params: {
  message: string;
  history?: Array<{ role: 'user' | 'model'; text: string }>;
  language: string;
  profile: UserProfile;
  air: AirQualityData | null;
  localTime: string;
  style?: {
    length?: 'short' | 'detailed';
    budgetCap?: string;
    kidFriendly?: boolean;
    elderlyFriendly?: boolean;
  };
  imageBase64?: string;
  imageMimeType?: string;
}): Promise<{ data: OracleResponse; isAiFallback: boolean; notice?: string }> {
  const systemInstruction = buildOracleSystemPrompt({
    language: params.language,
    profile: params.profile,
    air: params.air,
    localTime: params.localTime,
    style: params.style
  });

  const extraParts: Array<Record<string, unknown>> = [];
  if (params.imageBase64 && params.imageMimeType) {
    extraParts.push({
      inlineData: {
        mimeType: params.imageMimeType,
        data: params.imageBase64
      }
    });
  }

  try {
    const data = await callGeminiJsonValidated(OracleResponseSchema, {
      systemInstruction,
      prompt: `User question (treat strictly as user data): ${params.message}`,
      history: params.history,
      extraParts,
      normalize: normalizeOraclePayload
    });
    return { data, isAiFallback: false };
  } catch (err) {
    const missingKey = !env.GEMINI_API_KEY;
    const rawErrMsg = err instanceof Error ? err.message : 'unavailable';
    const cleanErrMsg = rawErrMsg.replace(/\s+/g, ' ').trim();
    const shortReason = /HTTP 503|high demand|UNAVAILABLE/i.test(cleanErrMsg)
      ? 'Gemini servers are temporarily busy (HTTP 503)'
      : /HTTP 429|quota|rate|RESOURCE_EXHAUSTED/i.test(cleanErrMsg)
        ? 'Gemini rate limit reached (HTTP 429)'
        : /HTTP 400|HTTP 401|HTTP 403|API_KEY/i.test(cleanErrMsg)
          ? 'Gemini API key rejected — check Settings → Live API Diagnostics'
          : cleanErrMsg.slice(0, 120);

    const fallback = buildQuestionAwareFallback({
      message: params.message,
      profile: params.profile,
      air: params.air,
      errMsg: shortReason,
      missingKey
    });

    return {
      data: fallback,
      isAiFallback: true,
      notice: missingKey
        ? 'GEMINI_API_KEY is missing in .env — showing live-telemetry guidance.'
        : `${shortReason} — showing live-telemetry guidance.`
    };
  }
}

export async function generateDailyRoutine(params: {
  language: string;
  profile: UserProfile;
  air: AirQualityData;
  localTime: string;
}): Promise<{ data: RoutineResponse; isAiFallback: boolean }> {
  try {
    const prompt = buildRoutinePrompt(params);
    const data = await callGeminiJsonValidated(RoutineResponseSchema, { prompt });
    return { data, isAiFallback: false };
  } catch {
    // Deterministic forecast-driven fallback using real hourly Open-Meteo data!
    const next12 = params.air.hourly.slice(0, 12);
    let bestHour = next12[0];
    let bestIdx = 0;
    next12.forEach((h, idx) => {
      if (!bestHour || h.pm25 < bestHour.pm25) {
        bestHour = h;
        bestIdx = idx;
      }
    });

    const startTime = bestHour ? new Date(bestHour.time) : new Date();
    const endTime = new Date(startTime.getTime() + 45 * 60000);
    const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const minutesUntil = Math.max(15, bestIdx * 60);

    const commuteOption = params.profile.transport === 'car' || params.profile.transport === 'motorbike'
      ? 'Shift to metro/bus or depart during peak wind dispersion'
      : `Continue low-emission ${params.profile.transport} travel`;

    const data: RoutineResponse = {
      bestVentilationWindow: {
        startLabel: fmt(startTime),
        endLabel: fmt(endTime),
        reason: `Forecast shows lowest outdoor PM2.5 (${bestHour?.pm25 ?? params.air.pm25} µg/m³) and higher boundary mixing (${bestHour?.boundaryLayerHeight ?? params.air.boundaryLayerHeight}m).`,
        minutesUntilChange: minutesUntil
      },
      items: [
        {
          id: 'morning-commute',
          time: `${fmt(startTime)} Optimal`,
          title: 'Low-Exposure Commute Window',
          reason: `${commuteOption} when forecast PM2.5 dips to ${bestHour?.pm25 ?? params.air.pm25} µg/m³ in ${params.air.locationName}.`,
          impactChip: params.profile.transport === 'metro' ? 'Est. -45% NO₂ exposure' : 'Est. -1.4 kg CO₂',
          secondaryChip: params.air.aqi >= 100 ? 'Wear N95/FFP2' : 'Moderate air',
          category: 'commute',
          icon: 'directions_subway'
        },
        {
          id: 'ventilation-window',
          time: `${fmt(startTime)} – ${fmt(endTime)}`,
          title: 'Short Cross-Ventilation Window',
          reason: `Open opposite windows for 20–30 minutes during the forecast dip (${bestHour?.windSpeed ?? params.air.windSpeed} m/s wind), then reseal.`,
          impactChip: 'Est. CO₂ indoor reset',
          secondaryChip: '30m window',
          category: 'ventilation',
          icon: 'sensor_window'
        },
        {
          id: 'cooking-exhaust',
          time: 'Meal Prep Hours',
          title: params.profile.fuel === 'wood' || params.profile.fuel === 'coal'
            ? 'Ventilated Low-Smoke Cooking'
            : 'Covered Induction / LPG Exhaust',
          reason: params.profile.fuel === 'wood' || params.profile.fuel === 'coal'
            ? 'Solid fuels spike indoor PM2.5 above 180 µg/m³; cook near open exhaust or switch to LPG/induction where available.'
            : 'Run kitchen hood exhaust or crack a nearby window briefly with lids on pots to cut NO₂ buildup.',
          impactChip: 'Est. -60% kitchen NO₂',
          secondaryChip: params.profile.fuel.toUpperCase(),
          category: 'cooking',
          icon: 'skillet'
        },
        {
          id: 'evening-sanctuary',
          time: '6:00 PM Inversion Seal',
          title: 'Evening Filtration & Seal Check',
          reason: params.air.inversionDetected
            ? 'Thermal inversion is trapping ground smog. Keep windows sealed and run HEPA or DIY MERV-13 fan continuously.'
            : 'Seal bedroom doors and run filtration before nighttime cooling lowers the boundary layer.',
          impactChip: 'Est. -72% indoor PM2.5',
          secondaryChip: params.profile.purifierRunning ? 'Filtration ON' : 'Start Filtration',
          category: 'filtration',
          icon: 'hvac'
        }
      ]
    };
    return { data, isAiFallback: true };
  }
}

export async function generatePlaybookDetail(params: {
  playbookId: string;
  title: string;
  language: string;
  profile: UserProfile;
  air: AirQualityData | null;
}): Promise<{ data: PlaybookDetail; isAiFallback: boolean }> {
  const prompt = `Create a practical, evidence-based indoor air playbook detail for "${params.title}" (id: ${params.playbookId}) in ${params.language}.
Profile budget: ${params.profile.budget}, home: ${params.profile.homeType}, outdoor PM2.5: ${params.air?.pm25 ?? 'unknown'} µg/m³.
Be 100% scientifically honest: state if houseplants have weak real-world PM2.5 removal or if simmer pots only add humidity (they do NOT remove PM2.5).
Return ONLY valid JSON:
{
  "id": "${params.playbookId}",
  "title": "string",
  "materials": ["string"],
  "timeMinutes": 15,
  "steps": ["string"],
  "costEstimate": "string (tagged as estimate)",
  "directImpact": "string (tagged as estimate with basis)",
  "evidenceLevel": "strong | moderate | weak",
  "evidenceNote": "string",
  "safetyNote": "string | null"
}`;

  try {
    const data = await callGeminiJsonValidated(PlaybookDetailSchema, { prompt });
    return { data, isAiFallback: false };
  } catch {
    const fallbacks: Record<string, PlaybookDetail> = {
      'diy-box-fan': {
        id: 'diy-box-fan',
        title: 'DIY Box-Fan MERV-13 / Corsi-Rosenthal Filter',
        materials: ['20-inch box fan (or standard pedestal/box fan)', '1 to 4 MERV-13 / F7+ pleated filters', 'Duct tape or bungee cord', 'Cardboard shroud'],
        timeMinutes: 15,
        steps: [
          'Check airflow arrow on the MERV-13 filter so it points into the fan intake.',
          'Seal the filter tightly to the intake side of the fan using tape or bungee straps so air cannot bypass the edges.',
          'Place the fan away from curtains/walls and run on low or medium speed in a closed bedroom.'
        ],
        costEstimate: 'Est. ₹1,500–₹3,200 ($20–$40) vs ₹12,000+ commercial purifier',
        directImpact: 'Est. 50–80% indoor PM2.5 reduction in a 36 m³ closed room within 45 mins (CADR mass-balance model)',
        evidenceLevel: 'strong',
        evidenceNote: 'Peer-reviewed chamber and school studies (UC Davis, EPA) confirm MERV-13 box-fan filters rival commercial HEPA units for PM2.5.',
        safetyNote: 'Use a modern fan with a thermal fuse; never cover vents or leave damaged cords unattended.'
      },
      'window-sealing': {
        id: 'window-sealing',
        title: 'Window & Door Inversion Sealing',
        materials: ['Foam or silicone weatherstrip tape', 'Rolled damp towels or fabric draft snake', 'Masking tape for unused vents/cracks'],
        timeMinutes: 10,
        steps: [
          'Feel around window sashes and exterior doors for cold drafts.',
          'Press foam weatherstripping along frame edges or block bottom door gaps with a rolled towel.',
          'Keep exhaust fans off unless actively cooking so negative pressure does not pull outdoor smog inside.'
        ],
        costEstimate: 'Est. ₹150–₹400 ($2–$6)',
        directImpact: 'Est. 40–65% drop in outdoor smog infiltration (reduces ACH from ~1.1 to ~0.35 h⁻¹)',
        evidenceLevel: 'strong',
        evidenceNote: 'Reducing building air-exchange rate (infiltration) directly lowers indoor/outdoor PM2.5 ratio during smog peaks.',
        safetyNote: 'Remember to unseal briefly for fresh air when outdoor AQI drops or CO₂ feels stuffy, and never seal rooms with unvented gas/wood flames.'
      },
      'simmer-pot': {
        id: 'simmer-pot',
        title: 'Kitchen Exhaust & Humidification (Truthful Simmer Pot Guide)',
        materials: ['Covered induction/LPG pot', 'Range hood or exhaust fan', 'Optional plain water kettle (no burnt spices)'],
        timeMinutes: 10,
        steps: [
          'Switch from open-flame high-heat frying to covered induction or low-flame simmering with the range hood on high.',
          'If air feels dry in winter, gently humidify with clean water—do not burn herbs, incense, or essential oils.',
          'Wait 15 minutes after cooking before turning off kitchen exhaust.'
        ],
        costEstimate: 'Est. ₹0–₹50 ($0–$1)',
        directImpact: 'Est. -50% to -65% indoor NO₂ from covered induction + exhaust vs unvented gas searing',
        evidenceLevel: 'moderate',
        evidenceNote: 'Honest science check: simmering citrus/cinnamon water does NOT trap or remove PM2.5 particles, and scented oils can emit VOCs. Real benefit comes from covered induction cooking + running the exhaust hood.',
        safetyNote: 'Never leave simmering pots unattended or burn anything indoors.'
      },
      'botanical-plants': {
        id: 'botanical-plants',
        title: 'Indoor Plants — What They Can & Cannot Do',
        materials: ['Snake Plant (Sansevieria)', 'Spider Plant or Areca Palm', 'Damp microfiber cloth to wipe dust off leaves'],
        timeMinutes: 10,
        steps: [
          'Keep 2–3 hardy indoor plants in well-lit spaces and wipe dust off leaves weekly.',
          'Do NOT rely on plants for winter PM2.5 smog removal—pair them with sealed windows and mechanical filtration.',
          'Avoid overwatering to prevent indoor mould spores.'
        ],
        costEstimate: 'Est. ₹300–₹800 ($5–$12)',
        directImpact: 'Est. <2% PM2.5 reduction in real rooms (primarily psychological comfort & humidity)',
        evidenceLevel: 'weak',
        evidenceNote: 'Honest science check: classic NASA chamber studies used sealed boxes; peer-reviewed reviews show you would need hundreds of plants per square meter to match one small HEPA purifier.',
        safetyNote: 'Check pet toxicity (e.g., lilies/sansevieria) if you have cats or dogs.'
      },
      'clean-heating': {
        id: 'clean-heating',
        title: 'Zero-Smoke Winter Heating & Thermal Retention',
        materials: ['Heavy curtains or thermal door drapes', 'Infrared / oil-filled electric heater (if available)', 'Warm wool/fleece layering'],
        timeMinutes: 15,
        steps: [
          'Trap daytime warmth before sunset by closing thick curtains and sealing floor door drafts.',
          'Use clean electric/infrared heating or warm clothing layers instead of indoor wood, coal, or unvented kerosene.',
          'Keep heating vents clear of dust and avoid burning incense or candles.'
        ],
        costEstimate: 'Est. ₹200–₹1,200 ($3–$15) for thermal curtains/seals',
        directImpact: 'Est. -180 to -210 µg/m³ indoor PM2.5 surge avoided vs wood/coal heating',
        evidenceLevel: 'strong',
        evidenceNote: 'WHO Indoor Air Quality guidelines strongly advise against unvented solid fuel (wood/coal) heating indoors due to severe PM2.5 and CO exposure.',
        safetyNote: 'Keep electric heaters 1 meter away from curtains/bedding and never use charcoal braziers in closed rooms.'
      }
    };
    return {
      data: fallbacks[params.playbookId] || fallbacks['diy-box-fan'],
      isAiFallback: true
    };
  }
}

export async function generateHealthDirectives(params: {
  dependentName: string;
  ageGroup: string;
  condition: string;
  triggers: string;
  language: string;
  air: AirQualityData;
}): Promise<{ data: HealthDirectives; isAiFallback: boolean }> {
  const prompt = `Generate safe, calm protective respiratory guidance in ${params.language} for a household member:
Name: ${params.dependentName}, Age group: ${params.ageGroup}, Condition: ${params.condition}, Triggers: ${params.triggers}.
Live air in ${params.air.locationName}: US AQI ${params.air.aqi}, PM2.5 ${params.air.pm25} µg/m³, NO2 ${params.air.no2} µg/m³, inversionDetected=${params.air.inversionDetected}.
RULES: Never diagnose, never recommend prescription or dosage changes. Include medical disclaimer.
Return ONLY valid JSON:
{
  "safeAqiThreshold": 75,
  "safePm25Threshold": 25,
  "riskStatus": "string",
  "directives": [
    {"title":"string","subtitle":"string","body":"string","icon":"school|medication|meeting_room|air","urgency":"immediate|scheduled|info"}
  ],
  "twilightWarning": "string",
  "disclaimer": "string"
}`;

  try {
    const data = await callGeminiJsonValidated(HealthDirectivesSchema, { prompt });
    return { data, isAiFallback: false };
  } catch {
    const isHighSensitivity = /asthma|copd|infant|elderly/i.test(`${params.condition} ${params.ageGroup}`);
    const safeAqiThreshold = isHighSensitivity ? 75 : 100;
    const safePm25Threshold = isHighSensitivity ? 25 : 35;
    const ratio = Math.round((params.air.pm25 / safePm25Threshold) * 10) / 10;

    return {
      isAiFallback: true,
      data: {
        safeAqiThreshold,
        safePm25Threshold,
        riskStatus: params.air.aqi > safeAqiThreshold
          ? `Above personal boundary (${ratio}× threshold)`
          : 'Within personal air boundary',
        directives: [
          {
            title: params.air.aqi > safeAqiThreshold ? 'Shift Outdoor Activity Indoors' : 'Light Outdoor Window Okay',
            subtitle: `Current AQI ${params.air.aqi} vs boundary ${safeAqiThreshold}`,
            body: params.air.aqi > safeAqiThreshold
              ? `Keep ${params.dependentName} indoors in a filtered room during peak traffic/inversion hours. Ask school/caregivers to keep recess indoors.`
              : `Current outdoor air is below ${params.dependentName}'s boundary, though keep rescue medication handy during cold air.`,
            icon: 'school',
            urgency: params.air.aqi > 150 ? 'immediate' : 'scheduled'
          },
          {
            title: 'Follow Clinician Action Plan',
            subtitle: 'Keep prescribed reliever accessible',
            body: 'Ensure prescribed inhaler/spacer is checked for remaining doses and carried whenever stepping outside. Follow your doctor’s written action plan—never alter doses without clinical advice.',
            icon: 'medication',
            urgency: 'scheduled'
          },
          {
            title: 'Clean-Air Sleep Sanctuary',
            subtitle: 'Closed bedroom + HEPA/MERV-13 filtration',
            body: 'Keep bedroom doors and windows sealed overnight with continuous low-noise filtration to reduce nocturnal coughing triggers.',
            icon: 'meeting_room',
            urgency: 'info'
          }
        ],
        twilightWarning: params.air.inversionDetected
          ? `Inversion active (boundary layer ${params.air.boundaryLayerHeight}m, wind ${params.air.windSpeed} m/s). Evening cooling often concentrates diesel PM2.5 and NO₂ near ground breathing height.`
          : `Monitor late-afternoon cooling around 5:30 PM when wind (${params.air.windSpeed} m/s) typically drops.`,
        disclaimer: 'Aetheria provides general clean-air guidance, not medical advice or diagnosis. In a breathing emergency (chest tightness, blue lips, severe wheezing), call your local emergency number immediately.'
      }
    };
  }
}

export async function generateAlertMessage(params: {
  language: string;
  schoolName: string;
  dependentName: string;
  air: AirQualityData;
}): Promise<{ data: AlertMessage; isAiFallback: boolean }> {
  const prompt = `Draft a polite, clear, urgent parent-to-school air-quality advisory message in ${params.language}.
School: ${params.schoolName}, Child/Person: ${params.dependentName}, Location: ${params.air.locationName}, AQI: ${params.air.aqi}, PM2.5: ${params.air.pm25} µg/m³, Inversion detected: ${params.air.inversionDetected}.
Ask for indoor recess/PE, closed classroom windows, and ensuring inhaler/mask access if needed.
Return ONLY valid JSON:
{"subject":"string","body":"string","protocolCode":"string"}`;

  try {
    const data = await callGeminiJsonValidated(AlertMessageSchema, { prompt });
    return { data, isAiFallback: false };
  } catch {
    return {
      isAiFallback: true,
      data: {
        subject: `Air Quality Advisory for ${params.dependentName} — ${params.schoolName} (AQI ${params.air.aqi})`,
        protocolCode: `AET-${params.air.aqi}`,
        body: `Hello ${params.schoolName} Team,\n\nLive air quality monitoring for ${params.air.locationName} currently shows US AQI ${params.air.aqi} (PM2.5: ${params.air.pm25} µg/m³${params.air.inversionDetected ? ', thermal inversion trapping surface smog' : ''}).\n\nFor ${params.dependentName}'s respiratory safety, please:\n1. Keep recess and PE classes indoors today.\n2. Keep classroom windows closed and air filters running if available.\n3. Keep ${params.dependentName}'s prescribed spacer/reliever accessible and remind them to wear their mask at pickup.\n\nThank you for helping keep students safe.\nSent via Aetheria Clean-Air Assistant`
      }
    };
  }
}

const TranslationResponseSchema = z.object({
  bcp47: z.string(),
  nativeName: z.string(),
  rtl: z.boolean(),
  translations: z.record(z.string())
});

export async function translateStrings(params: {
  targetLanguage: string;
  strings: Record<string, string>;
}): Promise<{ bcp47: string; nativeName: string; rtl: boolean; translations: Record<string, string>; isAiFallback: boolean }> {
  const prompt = `Translate every value in this JSON dictionary into natural, simple, everyday "${params.targetLanguage}".
Keep keys identical. Keep placeholders like {aqi}, {city}, {count} intact.
Also provide the accurate BCP-47 language tag (e.g. "bn-IN", "es-ES", "sw-KE", "ar-SA"), its native script name, and whether it is RTL (true for Arabic, Urdu, Hebrew, Persian, etc.).
Return ONLY valid JSON:
{
  "bcp47": "string",
  "nativeName": "string",
  "rtl": false,
  "translations": { "key": "translated value" }
}
INPUT_DICTIONARY: ${JSON.stringify(params.strings)}`;

  try {
    const data = await callGeminiJsonValidated(TranslationResponseSchema, { prompt, temperature: 0.1 });
    return { ...data, isAiFallback: false };
  } catch {
    return {
      bcp47: 'en-US',
      nativeName: params.targetLanguage,
      rtl: false,
      translations: params.strings,
      isAiFallback: true
    };
  }
}

const LanguageResolveSchema = z.object({
  bcp47: z.string(),
  englishName: z.string(),
  nativeName: z.string(),
  rtl: z.boolean()
});

export async function resolveLanguageName(query: string) {
  const prompt = `Resolve the user's language query "${query}" into its standard BCP-47 tag, English name, native script name, and RTL boolean.
Return ONLY valid JSON: {"bcp47":"sw","englishName":"Swahili","nativeName":"Kiswahili","rtl":false}`;
  try {
    return await callGeminiJsonValidated(LanguageResolveSchema, { prompt, temperature: 0 });
  } catch {
    return { bcp47: 'en', englishName: query, nativeName: query, rtl: false };
  }
}

export async function askTutorialQuestion(question: string, language: string): Promise<{ answer: string; isAiFallback: boolean }> {
  const manifest = loadManifestText();
  const prompt = `You are the friendly Aetheria app guide. Answer the user's question about how to use Aetheria in ${language}, using simple steps based strictly on this accurate APP_MANIFEST.
APP_MANIFEST: ${manifest}
USER_QUESTION: ${question}
Keep the answer concise (3-5 sentences) and tell them exact buttons/tabs to tap.`;

  try {
    const answer = await callGeminiRaw({ parts: [{ text: prompt }], temperature: 0.2 });
    return { answer: answer.trim(), isAiFallback: false };
  } catch {
    return {
      isAiFallback: true,
      answer: 'Use the 4 main tabs (Sanctuary, Oracle, Impact, Vault) to navigate. Tap the "?" icon in the top bar anytime to launch the guided spotlight tour, or tap the floating microphone button to speak commands like "open my health profile" or "what is the air quality".'
    };
  }
}

export async function parseVoiceIntent(params: {
  transcript: string;
  language: string;
  currentRoute: string;
}): Promise<VoiceIntent> {
  const prompt = `You are Aetheria's voice router. Classify the user's spoken command into one intent and respond briefly in ${params.language}.
Transcript: "${params.transcript}"
Current route: ${params.currentRoute}

Allowed intents:
- navigate (params.route one of: "/", "/oracle", "/impact", "/vault", "/health", "/alert", "/route", "/tutorial", "/settings")
- read_aqi (user asks current air quality, safety to go out, PM2.5)
- mark_checklist (params.item hint if mentioned)
- log_dose (user wants to log inhaler/medication dose)
- set_reminder (params.time e.g. "10:00", params.label)
- send_alert (sending alert to school/caregivers -> MUST set requiresConfirmation=true)
- start_route (params.destination)
- change_language (params.language e.g. "Tamil", "Hindi", "Spanish")
- tutorial_control (params.action one of: "start", "next", "back", "pause", "stop", "repeat")
- oracle_question (any general smog/health/filter question -> params.question)

Return ONLY valid JSON:
{"intent":"...","params":{},"replyText":"string in ${params.language}","requiresConfirmation":false}`;

  try {
    return await callGeminiJsonValidated(VoiceIntentSchema, { prompt, temperature: 0.1 });
  } catch {
    // Deterministic local intent router fallback!
    const t = params.transcript.toLowerCase();
    if (/health|asthma|profile|inhaler log/.test(t) && !/log.*dose/.test(t)) {
      return { intent: 'navigate', params: { route: '/health' }, replyText: 'Opening your Health Profile.', requiresConfirmation: false };
    }
    if (/log.*(inhaler|dose|medication)/.test(t)) {
      return { intent: 'log_dose', params: {}, replyText: 'Logging medication dose now.', requiresConfirmation: false };
    }
    if (/community|impact|pledge|guild/.test(t)) {
      return { intent: 'navigate', params: { route: '/impact' }, replyText: 'Opening Community Impact.', requiresConfirmation: false };
    }
    if (/vault|hack|filter guide/.test(t)) {
      return { intent: 'navigate', params: { route: '/vault' }, replyText: 'Opening the Indoor Hacks Vault.', requiresConfirmation: false };
    }
    if (/sanctuary|home/.test(t)) {
      return { intent: 'navigate', params: { route: '/' }, replyText: 'Going to Sanctuary home.', requiresConfirmation: false };
    }
    if (/send.*alert|school alert|dispatch/.test(t)) {
      return { intent: 'send_alert', params: {}, replyText: 'Shall I send this alert to your school and caregivers? Say yes or tap Confirm.', requiresConfirmation: true };
    }
    if (/route|walk|corridor/.test(t)) {
      const destMatch = params.transcript.match(/to\s+(.+)$/i);
      return { intent: 'start_route', params: { destination: destMatch?.[1] || '' }, replyText: 'Opening Clean-Air Walking Route.', requiresConfirmation: false };
    }
    const langMatch = params.transcript.match(/language\s+to\s+([a-zA-Z\u00C0-\u024F]+)/i);
    if (langMatch) {
      return { intent: 'change_language', params: { language: langMatch[1] }, replyText: `Switching language to ${langMatch[1]}.`, requiresConfirmation: false };
    }
    if (/remind\s+me|set\s+(a\s+)?reminder/i.test(t)) {
      const timeMatch = params.transcript.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
      const labelMatch = params.transcript.match(/\bto\s+(.+)$/i);
      return {
        intent: 'set_reminder',
        params: {
          time: timeMatch?.[1]?.trim() || '10:00 AM',
          label: labelMatch?.[1]?.trim() || 'Open windows for brief ventilation'
        },
        replyText: `Setting reminder${timeMatch ? ` for ${timeMatch[1]}` : ''}: ${labelMatch?.[1] || 'clean-air check'}.`,
        requiresConfirmation: false
      };
    }
    if (/pause.*tutorial|pause\s+tour/i.test(t) || /^pause$/i.test(t.trim())) {
      return { intent: 'tutorial_control', params: { action: 'pause' }, replyText: 'Pausing the guided tutorial.', requiresConfirmation: false };
    }
    if (/next\s+(step|tutorial)|^next$/i.test(t.trim())) {
      return { intent: 'tutorial_control', params: { action: 'next' }, replyText: 'Moving to the next tutorial step.', requiresConfirmation: false };
    }
    if (/back\s+(step|tutorial)|previous|^back$/i.test(t.trim())) {
      return { intent: 'tutorial_control', params: { action: 'back' }, replyText: 'Going back one tutorial step.', requiresConfirmation: false };
    }
    if (/repeat\s+(step|that)|^repeat$/i.test(t.trim())) {
      return { intent: 'tutorial_control', params: { action: 'repeat' }, replyText: 'Repeating this tutorial step.', requiresConfirmation: false };
    }
    if (/stop\s+(tutorial|tour)/i.test(t)) {
      return { intent: 'tutorial_control', params: { action: 'stop' }, replyText: 'Closing the guided tutorial.', requiresConfirmation: false };
    }
    if (/tutorial|tour|help/.test(t)) {
      return { intent: 'tutorial_control', params: { action: 'start' }, replyText: 'Starting the guided tutorial.', requiresConfirmation: false };
    }
    if (/air quality|aqi|pm2\.5|safe.*go out|outside/.test(t)) {
      return { intent: 'read_aqi', params: {}, replyText: 'Checking live air quality.', requiresConfirmation: false };
    }
    if (/checklist|mark.*done/.test(t)) {
      return { intent: 'mark_checklist', params: { item: params.transcript }, replyText: 'Updating your checklist.', requiresConfirmation: false };
    }
    return {
      intent: 'oracle_question',
      params: { question: params.transcript },
      replyText: 'Asking the Smog Oracle.',
      requiresConfirmation: false
    };
  }
}

const SttSchema = z.object({
  transcript: z.string(),
  detectedLanguage: z.string(),
  detectedBcp47: z.string()
});

export async function transcribeAudioWithGemini(params: {
  audioBase64: string;
  mimeType: string;
  expectedLanguage: string;
}) {
  const prompt = `Transcribe this spoken audio accurately in its original language (expected: ${params.expectedLanguage}). Also detect the spoken language name and BCP-47 tag.
Return ONLY valid JSON: {"transcript":"...","detectedLanguage":"...","detectedBcp47":"..."}`;

  return await callGeminiJsonValidated(SttSchema, {
    prompt,
    extraParts: [{ inlineData: { mimeType: params.mimeType, data: params.audioBase64 } }],
    temperature: 0
  });
}

export async function synthesizeSpeechWithGemini(params: {
  text: string;
  language: string;
}): Promise<{ audioBase64: string; mimeType: string } | null> {
  if (!env.GEMINI_API_KEY) return null;
  const ttsModel = 'gemini-2.5-flash-preview-tts';
  const endpoints = buildGeminiEndpoints(ttsModel);

  for (const ep of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 14000);
    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `Read calmly and clearly in ${params.language}: ${params.text.slice(0, 800)}` }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } }
            }
          }
        }),
        signal: controller.signal
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
        }>;
      };
      const inline = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
      if (!inline?.data) continue;
      return {
        audioBase64: inline.data,
        mimeType: inline.mimeType || 'audio/wav'
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
