import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, '../../..');
// Load .env from workspace root (aetheria/.env)
dotenv.config({ path: path.resolve(WORKSPACE_ROOT, '.env') });
dotenv.config();

const rawDbPath = (process.env.DATABASE_PATH || '').trim();
const defaultDbPath = process.env.VERCEL
  ? path.resolve('/tmp', 'data.db')
  : path.resolve(WORKSPACE_ROOT, 'data.db');
const resolvedDbPath = rawDbPath
  ? path.isAbsolute(rawDbPath)
    ? rawDbPath
    : path.resolve(WORKSPACE_ROOT, rawDbPath)
  : defaultDbPath;

export const env = {
  PORT: Number(process.env.PORT || 3002),
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  DATABASE_PATH: resolvedDbPath,
  GEMINI_API_KEY: (process.env.GEMINI_API_KEY || '').trim(),
  GEMINI_MODEL: (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim(),
  WAQI_TOKEN: (process.env.WAQI_TOKEN || '').trim(),
  ORS_API_KEY: (process.env.ORS_API_KEY || '').trim(),
  VAPID_PUBLIC_KEY: (process.env.VAPID_PUBLIC_KEY || '').trim(),
  VAPID_PRIVATE_KEY: (process.env.VAPID_PRIVATE_KEY || '').trim(),
  VAPID_SUBJECT: (process.env.VAPID_SUBJECT || 'mailto:sanctuary@aetheria.local').trim(),
  EMERGENCY_NUMBER: (process.env.EMERGENCY_NUMBER || '112').trim()
};

export interface KeyStatusItem {
  name: string;
  required: boolean;
  present: boolean;
  usedFor: string;
  docsUrl: string;
  activeValueHint?: string;
}

export function getHealthStatus() {
  const keys: KeyStatusItem[] = [
    {
      name: 'GEMINI_API_KEY',
      required: true,
      present: Boolean(env.GEMINI_API_KEY),
      usedFor: 'Oracle chat, daily routine generation, impact explanations, full UI/tutorial translation, room/filter image scan, and Gemini STT/TTS',
      docsUrl: 'https://aistudio.google.com/apikey'
    },
    {
      name: 'WAQI_TOKEN',
      required: false,
      present: Boolean(env.WAQI_TOKEN),
      usedFor: 'Station-level real-time AQI (higher accuracy in Indian/Asian cities; falls back to Open-Meteo)',
      docsUrl: 'https://aqicn.org/data-platform/token/'
    },
    {
      name: 'ORS_API_KEY',
      required: false,
      present: Boolean(env.ORS_API_KEY),
      usedFor: 'Walking-route alternatives for Clean-Air Route navigator (falls back to OSRM/corridor estimator)',
      docsUrl: 'https://openrouteservice.org/dev/#/signup'
    },
    {
      name: 'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY',
      required: false,
      present: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
      usedFor: 'Web-push smog & thermal inversion alerts (run `npm run gen:vapid`; falls back to local browser notifications)',
      docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Push_API'
    }
  ];

  return {
    ok: true,
    timestamp: new Date().toISOString(),
    geminiConfigured: Boolean(env.GEMINI_API_KEY),
    geminiModel: env.GEMINI_MODEL,
    emergencyNumber: env.EMERGENCY_NUMBER,
    vapidPublicKey: env.VAPID_PUBLIC_KEY || null,
    keys
  };
}
