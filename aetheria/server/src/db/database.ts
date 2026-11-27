import { DatabaseSync } from 'node:sqlite';
import { env } from '../config/env.js';

const db = new DatabaseSync(env.DATABASE_PATH);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS pledges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    area TEXT NOT NULL,
    pledge_type TEXT NOT NULL,
    pledge_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(device_id, pledge_type, pledge_date)
  );

  CREATE TABLE IF NOT EXISTS saved_plays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    play_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(device_id, play_id)
  );

  CREATE TABLE IF NOT EXISTS alert_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    area TEXT NOT NULL,
    recipient TEXT NOT NULL,
    channel TEXT NOT NULL,
    message_body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    subscription_json TEXT NOT NULL,
    area TEXT NOT NULL,
    alert_type TEXT NOT NULL DEFAULT 'inversion',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS solidarity_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL UNIQUE,
    area TEXT NOT NULL,
    contact_hint TEXT,
    consent_given INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
`);

export interface PledgeItemSummary {
  type: string;
  title: string;
  description: string;
  windowLabel: string;
  icon: string;
  co2KgEstimate: number;
  pm25ImpactLabel: string;
  seedCount: number;
  realCount: number;
  totalCount: number;
  userPledgedToday: boolean;
}

const PLEDGE_CATALOG = [
  {
    type: 'stove_curfew',
    title: 'Clean Cooking & Stove Curfew',
    description: 'Avoid solid-fuel/wood burning and switch to LPG/induction during evening inversion hours.',
    windowLabel: '7 PM – 6 AM',
    icon: 'fireplace',
    co2KgEstimate: 2.4,
    pm25ImpactLabel: '-180 µg/m³ indoor peak avoided',
    seedCount: 0
  },
  {
    type: 'no_waste_burning',
    title: 'Zero Open Waste & Leaf Burning',
    description: 'Compost or bag dry leaves and refuse instead of open burning in lanes or yards.',
    windowLabel: 'All Day',
    icon: 'smoke_free',
    co2KgEstimate: 3.1,
    pm25ImpactLabel: 'Prevents toxic dioxin & PM2.5 plumes',
    seedCount: 0
  },
  {
    type: 'no_idle_carpool',
    title: 'No-Idle Engine & Metro / Carpool',
    description: 'Turn off ignition at school gates/signals and choose metro, bus, or shared transit.',
    windowLabel: 'Morning & Dismissal',
    icon: 'directions_subway',
    co2KgEstimate: 1.9,
    pm25ImpactLabel: '-41% curbside NO₂ peak',
    seedCount: 0
  }
];

export function getCommunitySummary(area: string, deviceId?: string) {
  const normalizedArea = area.trim() || 'Local Neighbourhood';
  const today = new Date().toISOString().slice(0, 10);

  // Area-scoped counts so each city/neighbourhood displays its own real verified data
  const areaCountsRows = db
    .prepare(`SELECT pledge_type, COUNT(*) as cnt FROM pledges WHERE lower(area) = lower(?) GROUP BY pledge_type`)
    .all(normalizedArea) as Array<{ pledge_type: string; cnt: number }>;
  const areaMap = new Map(areaCountsRows.map((r) => [r.pledge_type, r.cnt]));

  const totalAreaPledges = Array.from(areaMap.values()).reduce((a, b) => a + b, 0);

  const globalPledgesRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM pledges`)
    .get() as { cnt: number };

  let userPledgedTypes = new Set<string>();
  if (deviceId) {
    const userRows = db
      .prepare(`SELECT pledge_type FROM pledges WHERE device_id = ? AND pledge_date = ?`)
      .all(deviceId, today) as Array<{ pledge_type: string }>;
    userPledgedTypes = new Set(userRows.map((r) => r.pledge_type));
  }

  const areaUniqueDevicesRow = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM (
         SELECT device_id FROM pledges WHERE lower(area) = lower(?)
         UNION
         SELECT device_id FROM solidarity_members WHERE lower(area) = lower(?)
       )`
    )
    .get(normalizedArea, normalizedArea) as { cnt: number };

  const userJoinedSolidarity = deviceId
    ? Boolean(db.prepare(`SELECT 1 FROM solidarity_members WHERE device_id = ?`).get(deviceId))
    : false;

  const isSeed = false;

  const pledges: PledgeItemSummary[] = PLEDGE_CATALOG.map((p) => {
    const realCount = areaMap.get(p.type) ?? 0;
    return {
      ...p,
      seedCount: 0,
      realCount,
      totalCount: realCount,
      userPledgedToday: userPledgedTypes.has(p.type)
    };
  });

  const residentsPledged = areaUniqueDevicesRow.cnt;
  const totalCo2AvoidedKg = Math.round(
    pledges.reduce((sum, p) => sum + p.totalCount * p.co2KgEstimate, 0) * 10
  ) / 10;
  // Transparent heuristic: each active household pledge cuts neighborhood micro-plume emission proxy
  const totalUgM3Avoided = Math.round(totalAreaPledges * 12);
  const adoptionPercent =
    residentsPledged > 0
      ? Math.min(100, Math.round((totalAreaPledges / (residentsPledged * 3)) * 100))
      : 0;

  // Build real area leaderboard from SQLite pledges
  const areaRows = db
    .prepare(
      `SELECT area, COUNT(*) as pledgeCount, COUNT(DISTINCT device_id) as deviceCount
       FROM pledges
       GROUP BY lower(area)
       ORDER BY pledgeCount DESC
       LIMIT 8`
    )
    .all() as Array<{ area: string; pledgeCount: number; deviceCount: number }>;

  const co2ByAreaRows = db
    .prepare(`SELECT area, pledge_type, COUNT(*) as cnt FROM pledges GROUP BY lower(area), pledge_type`)
    .all() as Array<{ area: string; pledge_type: string; cnt: number }>;

  const co2WeightMap = new Map(PLEDGE_CATALOG.map((p) => [p.type, p.co2KgEstimate]));
  const areaCo2Map = new Map<string, number>();
  for (const r of co2ByAreaRows) {
    const key = r.area.toLowerCase();
    const prev = areaCo2Map.get(key) || 0;
    areaCo2Map.set(key, prev + r.cnt * (co2WeightMap.get(r.pledge_type) || 2.0));
  }

  const leaderboard = areaRows.map((row, idx) => {
    const isCurrent = row.area.toLowerCase() === normalizedArea.toLowerCase();
    const co2 = Math.round((areaCo2Map.get(row.area.toLowerCase()) || 0) * 10) / 10;
    const pct = row.deviceCount > 0 ? Math.min(100, Math.round((row.pledgeCount / (row.deviceCount * 3)) * 100)) : 0;
    return {
      id: `area-${idx}-${row.area.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: row.area,
      highlight: `${row.pledgeCount} verified pledge${row.pledgeCount === 1 ? '' : 's'} · ${row.deviceCount} household${row.deviceCount === 1 ? '' : 's'}`,
      adoptionPercent: pct,
      co2AvoidedKg: co2,
      isCurrentArea: isCurrent
    };
  });

  if (!leaderboard.some((l) => l.isCurrentArea)) {
    leaderboard.unshift({
      id: 'local-guild',
      name: normalizedArea,
      highlight: '0 pledges recorded yet — take the first pledge below',
      adoptionPercent: 0,
      co2AvoidedKg: 0,
      isCurrentArea: true
    });
  }

  return {
    area: normalizedArea,
    isSeed,
    seedNotice:
      totalAreaPledges > 0
        ? `Showing ${totalAreaPledges} real verified pledge${totalAreaPledges === 1 ? '' : 's'} from ${residentsPledged} household${residentsPledged === 1 ? '' : 's'} in ${normalizedArea}.`
        : `No pledges recorded yet in ${normalizedArea}${globalPledgesRow.cnt > 0 ? ` (${globalPledgesRow.cnt} verified globally)` : ''}. Take a pledge below to record real household impact.`,
    residentsPledged,
    totalRealPledges: totalAreaPledges,
    totalUgM3Avoided,
    totalCo2AvoidedKg,
    adoptionPercent,
    userJoinedSolidarity,
    pledges,
    leaderboard
  };
}

export function createPledge(deviceId: string, area: string, pledgeType: string) {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  const existing = db
    .prepare(`SELECT id FROM pledges WHERE device_id = ? AND pledge_type = ? AND pledge_date = ?`)
    .get(deviceId, pledgeType, today);

  if (existing) {
    return { alreadyPledgedToday: true, community: getCommunitySummary(area, deviceId) };
  }

  db.prepare(
    `INSERT INTO pledges (device_id, area, pledge_type, pledge_date, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(deviceId, area.trim() || 'Local Neighbourhood', pledgeType, today, now);

  return { alreadyPledgedToday: false, community: getCommunitySummary(area, deviceId) };
}

export function joinSolidarity(deviceId: string, area: string, contactHint: string | undefined, consentGiven: boolean) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO solidarity_members (device_id, area, contact_hint, consent_given, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET area = excluded.area, contact_hint = excluded.contact_hint, consent_given = excluded.consent_given`
  ).run(deviceId, area.trim() || 'Local Neighbourhood', contactHint || null, consentGiven ? 1 : 0, now);

  return getCommunitySummary(area, deviceId);
}

export function insertAlertLog(params: {
  deviceId: string;
  area: string;
  recipient: string;
  channel: string;
  messageBody: string;
}) {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO alert_log (device_id, area, recipient, channel, message_body, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(params.deviceId, params.area, params.recipient, params.channel, params.messageBody, now);

  return {
    id: info.lastInsertRowid,
    ...params,
    createdAt: now
  };
}

export function getAlertLogs(deviceId: string) {
  return db
    .prepare(
      `SELECT id, area, recipient, channel, message_body as messageBody, created_at as createdAt
       FROM alert_log WHERE device_id = ? ORDER BY id DESC LIMIT 20`
    )
    .all(deviceId);
}

export function savePushSubscription(params: {
  deviceId: string;
  subscription: { endpoint: string; [key: string]: unknown };
  area: string;
  alertType?: string;
}) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO push_subscriptions (device_id, endpoint, subscription_json, area, alert_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET area = excluded.area, alert_type = excluded.alert_type, subscription_json = excluded.subscription_json`
  ).run(
    params.deviceId,
    params.subscription.endpoint,
    JSON.stringify(params.subscription),
    params.area,
    params.alertType || 'inversion',
    now
  );
}

export function getAllPushSubscriptions(deviceId?: string) {
  if (deviceId) {
    return db
      .prepare(`SELECT subscription_json FROM push_subscriptions WHERE device_id = ?`)
      .all(deviceId) as Array<{ subscription_json: string }>;
  }
  return db
    .prepare(`SELECT subscription_json FROM push_subscriptions`)
    .all() as Array<{ subscription_json: string }>;
}

export default db;
