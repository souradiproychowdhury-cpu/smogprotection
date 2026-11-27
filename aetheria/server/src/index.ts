import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { apiRouter } from './routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const app = express();

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

const allowedOrigins = new Set([
  env.FRONTEND_ORIGIN,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  `http://localhost:${env.PORT}`,
  `http://127.0.0.1:${env.PORT}`
]);

app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        allowedOrigins.has(origin) ||
        origin.endsWith('.vercel.app') ||
        (process.env.VERCEL_URL && origin === `https://${process.env.VERCEL_URL}`)
      ) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    }
  })
);

app.use(express.json({ limit: '8mb' }));

// Request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (req.path.startsWith('/api')) {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    max: 180,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.use('/api', apiRouter);

// Global JSON error handler to ensure all unhandled errors return clean JSON
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : 'Internal server error';
  console.error('[API Unhandled Error]:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: message });
  }
});

// Serve built client static files in production
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

if (process.env.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT && !process.argv.some((a) => a.includes('.test.'))) {
  app.listen(env.PORT, () => {
    console.log(`Aetheria backend listening on http://localhost:${env.PORT}`);
    if (!env.GEMINI_API_KEY) {
      console.log('Notice: GEMINI_API_KEY is not set in .env — AI endpoints will serve deterministic fallback responses.');
    }
  });
}

export default app;
