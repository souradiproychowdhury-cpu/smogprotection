# Aetheria — GenAI Clean-Air & Winter Smog Assistant

Aetheria helps families and communities navigate severe winter smog and urban air pollution with live air-quality telemetry, personalized low-emission daily routines, transparent impact math, DIY clean-air playbooks, asthma/COPD safety shields, thermal inversion school alerts, clean-air walking routes, and a multilingual voice assistant & spotlight tutorial.

---

## Get Your Keys in 5 Minutes

Copy `.env.example` to `.env` inside `aetheria/`:

```bash
cp .env.example .env
```

Keys in order of priority:

1. **`GEMINI_API_KEY` (REQUIRED for GenAI)**
   - **Used for:** Smog Oracle chat, daily routine generation, impact explanations, full UI & tutorial translation into any language, room/filter/stove photo scan, Ask-the-Tutorial Q&A, and Gemini STT/TTS fallback.
   - **Get it:** https://aistudio.google.com/apikey
   - **Configurable model:** `GEMINI_MODEL=gemini-2.5-flash` (default)
   - *Note:* If missing, Aetheria degrades gracefully using built-in deterministic evidence-based guidance and displays a Setup Check notice.

2. **`WAQI_TOKEN` (Optional — Recommended for Indian/Asian cities)**
   - **Used for:** Station-level real-time AQI readings (falls back to no-key Open-Meteo Air Quality & Weather if omitted).
   - **Get it:** https://aqicn.org/data-platform/token/

3. **`ORS_API_KEY` (Optional — Recommended for walking routes)**
   - **Used for:** Multi-corridor walking route alternatives on the Clean-Air Route screen (falls back to OSRM / geometric corridor estimator if omitted).
   - **Get it:** https://openrouteservice.org/dev/#/signup

4. **`VAPID_PUBLIC_KEY` & `VAPID_PRIVATE_KEY` (Optional — Web Push)**
   - **Used for:** Background Web Push smog & thermal inversion alerts (falls back to local browser notifications if omitted).
   - **Generate:** Run `npm run gen:vapid` inside `aetheria/`.

### Exact `.env` template

```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
WAQI_TOKEN=
ORS_API_KEY=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:sanctuary@aetheria.local
PORT=3000
FRONTEND_ORIGIN=http://localhost:5173
DATABASE_PATH=./data.db
EMERGENCY_NUMBER=112
```

---

## Running Locally

```bash
cd aetheria
npm install
npm run dev
```

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:3000
- **Setup Check Page:** http://localhost:5173/settings

### Build & Production Start

```bash
npm run build
npm start
```

### Run Tests

```bash
npm test
```

---

## Architecture & Transparency

- **Zero exposed keys:** All third-party API calls (`Gemini`, `WAQI`, `ORS`, `Open-Meteo`) run exclusively on the Express backend (`server/`).
- **US AQI Spectrum Mapping (`shared/src/aqi.ts`):**
  - `0–25`: Sovereign Pristine (Emerald)
  - `26–75`: Temperate Shift (Teal/Cyan)
  - `76–150`: Smog Intrusion (Imperial Amber)
  - `151+`: Hazardous Sovereign Breach (Crimson)
- **Impact Engine (`shared/src/impact.ts`):** Single-zone steady-state CADR mass-balance model and DEFRA/CEA emission factors; every number in the UI is labeled **Estimate** and opens a **How We Calculated This** breakdown modal.
- **SQLite Storage:** Uses Node.js built-in `node:sqlite` (`DatabaseSync`) so no C++ native build tools are required.
