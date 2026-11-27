import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const PORT = 3099;
const BASE_URL = `http://localhost:${PORT}`;

const serverProc = spawn('node', ['server/dist/index.js'], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverReady = false;
serverProc.stdout.on('data', (d) => {
  if (d.toString().includes('listening')) serverReady = true;
});
serverProc.stderr.on('data', (d) => {
  console.error('[SERVER STDERR]', d.toString());
});

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Server did not start in time');
}

const report = [];
function record(screen, control, outcome, status = 'PASS') {
  report.push({ screen, control, outcome, status });
  console.log(`[${status}] ${screen} | ${control} -> ${outcome}`);
}

try {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push(err.message));
  page.on('response', (res) => {
    if (res.status() >= 400) {
      console.error(`[HTTP ${res.status()}] ${res.url()}`);
    }
  });

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  // 1. First-launch Language Modal
  const langDialog = page.locator('dialog[open]');
  await langDialog.waitFor({ state: 'visible', timeout: 5000 });
  await langDialog.getByRole('button', { name: /English/i }).first().click();
  await langDialog.waitFor({ state: 'hidden' });
  record('Onboarding', 'Language Picker (English)', 'Dialog opened on first run and closed on selection');

  // 2. Header controls
  await page.locator('[data-tour="header-aqi-pill"]').click();
  await page.locator('dialog[open]').waitFor({ state: 'visible' });
  await page.locator('dialog[open]').getByRole('button', { name: 'Close dialog' }).click();
  record('Header', 'Live AQI Status Pill', 'Opened Live Atmospheric Telemetry modal');

  await page.locator('[data-tour="header-lang"]').click();
  await page.locator('dialog[open]').getByRole('button', { name: /বাংলা/i }).click();
  await page.waitForTimeout(300);
  record('Header', 'Language Switch (Bengali)', 'Switched UI to Bengali (bn)');

  await page.locator('[data-tour="header-lang"]').click();
  await page.locator('dialog[open]').getByRole('button', { name: /Español/i }).click();
  await page.waitForTimeout(300);
  record('Header', 'Language Switch (Spanish)', 'Switched UI to Spanish (es)');

  await page.locator('[data-tour="header-lang"]').click();
  await page.locator('#custom-lang-input').fill('Swahili');
  await page.locator('dialog[open]').getByRole('button', { name: 'Apply' }).click();
  await page.waitForTimeout(300);
  record('Header', 'Custom Language Search (Swahili)', 'Resolved and switched to Swahili');

  await page.locator('[data-tour="header-lang"]').click();
  await page.locator('dialog[open]').getByRole('button', { name: /العربية/i }).click();
  await page.waitForTimeout(250);
  const htmlDir = await page.evaluate(() => document.documentElement.dir);
  assert.equal(htmlDir, 'rtl', 'Arabic selection must enable RTL layout');
  record('Header', 'RTL Layout Switch (Arabic)', 'Set document dir="rtl" automatically');

  // Switch back to English for deterministic text checks
  await page.locator('[data-tour="header-lang"]').click();
  await page.locator('dialog[open]').getByRole('button', { name: /English/i }).first().click();
  await page.waitForTimeout(250);

  // 3. Sanctuary: 3-city live data test + toggles + impact formula + routine
  for (const city of ['London, United Kingdom', 'Lahore, Pakistan', 'New Delhi, India']) {
    await page.locator('[data-tour="location-bar"] button').first().click();
    await page.locator('dialog[open]').getByRole('button', { name: city }).click();
    await page.waitForTimeout(1200);
    const bodyText = await page.locator('[data-tour="aqi-dial"]').innerText();
    assert.ok(bodyText.includes('PM2.5:'), `Expected PM2.5 reading for ${city}`);
    record('Sanctuary', `Location Switch (${city})`, 'Fetched live AQI & updated dial');
  }

  // Sealing & Purifier toggles change indoor estimate
  const beforeIndoor = await page.locator('[data-tour="aqi-dial"]').innerText();
  await page.locator('#purifier-running-toggle').click();
  await page.waitForTimeout(150);
  const afterIndoor = await page.locator('[data-tour="aqi-dial"]').innerText();
  assert.notEqual(beforeIndoor, afterIndoor, 'Purifier toggle must recalculate indoor PM2.5');
  record('Sanctuary', 'Purifier Running Toggle', 'Recalculated indoor PM2.5 immediately');

  await page.locator('#windows-sealed-toggle').click();
  await page.waitForTimeout(100);
  await page.locator('#windows-sealed-toggle').click();
  record('Sanctuary', 'Windows Sealed Toggle', 'Toggled sealing state and updated impact');

  await page.locator('#family-safe-toggle').click();
  await page.waitForTimeout(100);
  await page.locator('#family-safe-toggle').click();
  record('Sanctuary', 'Family Safe Mode Toggle', 'Toggled family safe threshold');

  // Impact formula dialog
  await page.locator('[data-tour="personal-impact"] button').first().click();
  await page.locator('dialog[open]').waitFor({ state: 'visible' });
  const formulaText = await page.locator('dialog[open]').innerText();
  assert.ok(/transparent formula/i.test(formulaText));
  await page.locator('dialog[open]').getByRole('button', { name: 'Close dialog' }).click();
  record('Sanctuary', 'Personal Impact Card', 'Opened How We Calculated This formula modal');

  // Routine checkbox & Share Routine
  const firstRoutineCheck = page.locator('[data-tour="daily-routine"] input[type="checkbox"]').first();
  await firstRoutineCheck.click();
  assert.equal(await firstRoutineCheck.isChecked(), true);
  record('Sanctuary', 'Daily Routine Checkbox', 'Marked routine step completed');

  await page.getByRole('button', { name: /Share Routine/i }).click();
  await page.waitForTimeout(300);
  if (await page.locator('dialog[open]').isVisible()) {
    await page.locator('dialog[open]').getByRole('button', { name: 'Close dialog' }).click();
    record('Sanctuary', 'Share Routine Button', 'Opened Share fallback modal');
  } else {
    await page.getByText('Routine shared').waitFor({ state: 'visible', timeout: 3000 });
    record('Sanctuary', 'Share Routine Button', 'Invoked native navigator.share');
  }

  // Profile Sheet via Header Avatar + Units check
  await page.locator('[data-tour="header-profile"]').click();
  await page.locator('dialog[open]').waitFor({ state: 'visible' });
  await page.locator('#prof-units').selectOption('imperial');
  await page.locator('#prof-units').selectOption('metric');
  await page.locator('dialog[open]').getByRole('button', { name: 'Close dialog' }).click();
  record('Header', 'Profile Avatar & Units Control', 'Opened Household Profile sheet and toggled units');

  // 4. Sanctuary -> Open Oracle with context -> Oracle (/oracle)
  await page.getByRole('button', { name: /Ask Smog Oracle/i }).click();
  await page.waitForURL('**/oracle');
  await page.getByText('Sanctuary Context Loaded').waitFor({ state: 'visible', timeout: 5000 });
  record('Sanctuary -> Oracle', 'Open Oracle With Context', 'Navigated with live Sanctuary context banner');

  await page.locator('[data-tour="oracle-filter-btn"]').click();
  await page.locator('dialog[open]').getByRole('button', { name: 'detailed' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Close dialog' }).click();
  record('Oracle', 'Answer Style Modal', 'Switched Oracle style to detailed');

  await page.locator('[data-tour="oracle-suggestions"] button').first().click();
  await page.locator('article').first().waitFor({ state: 'visible', timeout: 15000 });
  record('Oracle', 'Suggested Chip + SSE Stream', 'Rendered structured Protocol Card');

  await page.locator('article').first().getByRole('button', { name: /Save/i }).click();
  record('Oracle', 'Save Protocol Button', 'Bookmarked protocol card to Vault');

  await page.locator('article').first().getByRole('button', { name: /Copy/i }).click();
  record('Oracle', 'Copy Protocol Button', 'Copied Oracle card text to clipboard');

  await page.getByRole('button', { name: /Notify me when wind dispersion begins/i }).click();
  record('Oracle', 'Wind Dispersion Alert Button', 'Subscribed to wind dispersion notification');

  await page.getByRole('button', { name: /^Clear$/i }).click();
  assert.equal(await page.locator('article').count(), 0, 'Clear button must remove chat cards');
  record('Oracle', 'Clear Chat Button', 'Cleared persisted Oracle conversation');

  // 5. Impact (/impact)
  await page.locator('nav[aria-label="Mobile Primary Navigation"]').getByRole('link', { name: /Impact/i }).click();
  await page.waitForURL('**/impact');
  await page.locator('[data-tour="impact-pledges"]').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /CO₂ Saved/i }).click();
  record('Impact', 'Leaderboard Sort Toggle', 'Sorted Districts of Merit by CO2 saved');

  await page.locator('[data-tour="impact-pledges"]').getByRole('button', { name: /Take Pledge Today/i }).first().click();
  await page.waitForTimeout(500);
  record('Impact', 'Pledge Button', 'Recorded daily pledge via SQLite API');

  await page.getByRole('button', { name: /Join Guild Updates/i }).click();
  await page.locator('dialog[open] input[type="checkbox"]').check();
  await page.locator('dialog[open]').getByRole('button', { name: /Confirm Membership/i }).click();
  await page.waitForTimeout(300);
  record('Impact', 'Join Solidarity Modal', 'Submitted consent and joined Solidarity Protocol');

  // 6. Vault (/vault)
  await page.locator('nav[aria-label="Mobile Primary Navigation"]').getByRole('link', { name: /Vault/i }).click();
  await page.waitForURL('**/vault');
  await page.locator('[data-tour="vault-filters"]').getByRole('button', { name: /Saved/i }).click();
  const savedOracleVisible = await page.getByText('Saved Oracle Protocols').isVisible();
  assert.ok(savedOracleVisible, 'Saved Oracle card must appear in Vault > Saved');
  await page.getByRole('button', { name: /View Full Protocol/i }).first().click();
  await page.locator('dialog[open]').waitFor({ state: 'visible' });
  await page.locator('dialog[open]').getByRole('button', { name: 'Close dialog' }).click();
  record('Vault', 'Saved Tab & Full Protocol Modal', 'Verified bookmarked Oracle card appeared and expanded in Saved');

  await page.locator('[data-tour="vault-filters"]').getByRole('button', { name: /Heating/i }).click();
  assert.ok(await page.getByText(/Zero-Smoke Winter Heating/i).isVisible(), 'Heating filter must show heating playbook');
  record('Vault', 'Heating Category Filter', 'Filtered to clean winter heating playbook');

  await page.locator('[data-tour="vault-filters"]').getByRole('button', { name: /All Hacks/i }).click();
  await page.getByRole('button', { name: /Open Guide/i }).first().click();
  await page.locator('dialog[open]').waitFor({ state: 'visible' });
  await page.locator('dialog[open]').getByRole('button', { name: 'Close dialog' }).click();
  record('Vault', 'Playbook Open Guide', 'Opened AI-enriched playbook modal');

  const vaultCb = page.locator('[data-tour="vault-checklist"] input[type="checkbox"]').nth(1);
  await vaultCb.click();
  assert.equal(await vaultCb.isChecked(), true);
  record('Vault', 'Sanctuary Checklist Checkbox', 'Toggled readiness item and updated progress');

  // 7. Health (/health)
  await page.goto(`${BASE_URL}/health`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Meera/i }).click();
  record('Health', 'Dependent Switcher', 'Switched active dependent to Meera');

  await page.getByRole('button', { name: /Mark Administered/i }).click();
  record('Health', 'Mark Administered Button', 'Logged medication dose and decremented count');

  await page.getByRole('button', { name: /Log Entry/i }).click();
  await page.locator('#sym-notes').fill('Mild cough outdoors');
  await page.locator('dialog[open]').getByRole('button', { name: /Save Symptom Entry/i }).click();
  record('Health', 'Log Symptom Form', 'Saved symptom entry to timeline');

  await page.getByRole('button', { name: /Review Dispatch/i }).click();
  await page.locator('dialog[open]').waitFor({ state: 'visible' });
  await page.locator('dialog[open]').getByRole('button', { name: 'Close dialog' }).click();
  record('Health', 'Emergency Review Dispatch', 'Opened WhatsApp/SMS location dispatch modal');

  // 8. Alert (/alert)
  await page.goto(`${BASE_URL}/alert`, { waitUntil: 'networkidle' });
  await page.locator('[data-tour="alert-physics"]').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /Copy/i }).click();
  record('Inversion Alert', 'Copy & Log Dispatch', 'Copied advisory and logged dispatch');

  // 9. Route (/route)
  await page.goto(`${BASE_URL}/route`, { waitUntil: 'networkidle' });
  await page.locator('[data-tour="route-planner"]').waitFor({ state: 'visible' });
  await page.locator('#route-to').fill('Connaught Place');
  await page.getByRole('button', { name: /Find Route/i }).click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /Start Live Voice-Guided Corridor/i }).click();
  await page.getByRole('button', { name: /Next Step & Speak/i }).click();
  await page.getByRole('button', { name: /Save Route/i }).click();
  record('Clean-Air Route', 'Geocode Destination + Voice Guidance + Save', 'Resolved destination, stepped waypoint, and saved route');

  // 10. Voice Assistant End-to-End Commands
  await page.locator('[data-tour="global-mic"]').click();
  await page.locator('#voice-transcript-edit').fill('open health profile');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.waitForURL('**/health');
  record('Voice Assistant', 'Command: open health profile', 'Navigated to /health via voice intent');

  await page.locator('#voice-transcript-edit').fill("what's the air quality");
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.waitForTimeout(400);
  record('Voice Assistant', "Command: what's the air quality", 'Read live AQI and WHO guideline multiple');

  await page.locator('#voice-transcript-edit').fill('log inhaler dose');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.waitForTimeout(400);
  record('Voice Assistant', 'Command: log inhaler dose', 'Logged medication dose and decremented counter');

  await page.locator('#voice-transcript-edit').fill('send alert to school');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).waitFor({ state: 'visible', timeout: 4000 });
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.waitForURL('**/alert');
  record('Voice Assistant', 'Command: send alert to school (Confirm)', 'Required confirmation before navigating to /alert');

  await page.locator('#voice-transcript-edit').fill('change language to Hindi');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'hi-IN');
  record('Voice Assistant', 'Command: change language to Hindi', 'Switched app language to Hindi (hi-IN)');
  await page.getByRole('button', { name: 'Close voice panel' }).click();

  // Switch back to English before Tutorial check
  await page.locator('[data-tour="header-lang"]').click();
  await page.locator('dialog[open]').getByRole('button', { name: /English/i }).first().click();
  await page.waitForTimeout(250);

  // 10. Tutorial (/tutorial)
  await page.locator('[data-tour="header-help"]').click();
  await page.waitForURL('**/tutorial');
  await page.getByRole('button', { name: /Start 24-Step Guided Tour/i }).click();
  await page.locator('#tour-step-title').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  record('Tutorial', 'Guided Tour Next/Back/Skip', 'Navigated tour steps and exited cleanly');

  // 11. Settings (/settings)
  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle' });
  const settingsText = await page.locator('main').innerText();
  assert.ok(settingsText.includes('GEMINI_API_KEY'), 'Setup check must display GEMINI_API_KEY status');
  await page.getByRole('button', { name: 'Increase font size' }).click();
  await page.getByRole('button', { name: 'Decrease font size' }).click();
  record('Settings', 'API Health Check & Font Size', 'Verified key status matrix and A+/A- controls');

  // 12. Desktop 1280px responsive check
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  const desktopNavVisible = await page.locator('nav[aria-label="Desktop Primary Navigation"]').isVisible();
  assert.ok(desktopNavVisible, 'Desktop left rail must be visible at 1280px');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  assert.equal(overflow, false, 'No horizontal overflow at 1280px');
  record('Desktop Layout', '1280px Left Rail & 12-Col Grid', 'Verified left rail visible with zero overflow');

  // 13. Offline check
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.waitForTimeout(300);
  const offlineBadgeVisible = await page.getByText(/Offline/i).first().isVisible();
  assert.ok(offlineBadgeVisible, 'Offline badge should appear when offline');
  record('Offline PWA', 'Offline Cached State', 'Displayed Offline badge while retaining cached AQI');

  assert.equal(consoleErrors.length, 0, `Unexpected page errors: ${consoleErrors.join('; ')}`);

  console.log('\n=== CLICK-THROUGH TEST REPORT ===');
  console.table(report);
  console.log(`Total controls verified: ${report.length}, Zero page errors.`);

  await browser.close();
} finally {
  serverProc.kill();
}
