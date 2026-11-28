# Aetheria — Smog Protection & Clean-Air Companion

Aetheria is a full-stack air quality intelligence, clean-air routing, health shield, and smog-alert web application.

## Repository Structure

```text
.
├── api/                     # Bundled Vercel serverless API entrypoint (index.mjs)
├── vercel.json              # Root Vercel deployment configuration
├── package.json             # Root workspace convenience scripts
└── aetheria/                # Main application workspace
    ├── client/              # React + Vite + Tailwind + Leaflet frontend
    │   ├── public/          # Static assets, PWA manifest, service worker, frame sequence
    │   └── src/
    │       ├── components/  # Reusable UI components & background animations
    │       ├── i18n/        # Multi-language strings & translation hooks
    │       ├── lib/         # API client, IndexedDB cache, notifications, share helpers
    │       ├── pages/       # Route pages (Sanctuary, Oracle, Impact, Vault, Health, Alert, Route, Tutorial, Settings)
    │       ├── store/       # Zustand global state store
    │       ├── tutorial/    # Interactive tour overlay & steps
    │       └── voice/       # Voice assistant & welcome narration
    ├── server/              # Express + TypeScript backend
    │   └── src/
    │       ├── config/      # Environment & health configuration
    │       ├── db/          # SQLite persistence with serverless fallback
    │       ├── prompts/     # Gemini AI prompt templates
    │       ├── routes/      # REST API endpoints (/api/*)
    │       └── services/    # Air quality, Gemini AI, push notifications, routing
    ├── shared/              # Shared TypeScript schemas, AQI math, and impact calculations
    ├── tutorial/            # App manifest & tour step definitions
    └── tests/               # End-to-end tests
```

## Local Development

```bash
cd aetheria
npm install
npm run dev
```

- Frontend runs on `http://localhost:5173`
- Backend API runs on `http://localhost:3002`

For environment variable setup, copy `aetheria/.env.example` to `aetheria/.env`. See `aetheria/README.md` for full details.
