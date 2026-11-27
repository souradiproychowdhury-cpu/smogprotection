import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { lastInsertRowid: number | bigint };
  };
}

let db: SqliteDb | null = null;

try {
  const req = createRequire(import.meta.url);
  const sqlite = req('node:sqlite') as { DatabaseSync: new (p: string) => SqliteDb };
  const instance = new sqlite.DatabaseSync(env.DATABASE_PATH);
  instance.exec('PRAGMA journal_mode = WAL;');
  instance.exec(`
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
  db = instance;
} catch {
  db = null;
}

// Fallback store for serverless runtimes where node:sqlite is unavailable
interface MemoryStore {
  pledges: Array<{ id: number; device_id: string; area: string; pledge_type: string; pledge_date: string; created_at: string }>;
  alert_log: Array<{ id: number; device_id: string; area: string; recipient: string; channel: string; message_body: string; created_at: string }>;
  push_subscriptions: Array<{ device_id: string; endpoint: string; subscription_json: string; area: string; alert_type: string; created_at: string }>;
  solidarity_members: Array<{ device_id: string; area: string; contact_hint: string | null; consent_given: number; created_at: string }>;
  nextId: number;
}

const FALLBACK_PATH = path.resolve('/tmp', 'aetheria-store.json');

function loadStore(): MemoryStore {
  try {
    if (fs.existsSync(FALLBACK_PATH)) {
      return JSON.parse(fs.readFileSync(FALLBACK_PATH, 'utf8')) as MemoryStore;
    }
  } catch {
    // ignore
  }
  return { pledges: [], alert_log: [], push_subscriptions: [], solidarity_members: [], nextId: 1 };
}

let memoryCache: MemoryStore | null = null;

function getStore(): MemoryStore {
  if (!memoryCache) {
    memoryCache = loadStore();
  }
  return memoryCache;
}

function saveStore(store: MemoryStore): void {
  memoryCache = store;
  try {
    fs.writeFileSync(FALLBACK_PATH, JSON.stringify(store));
  } catch {
    // ignore ephemeral fs errors
  }
}

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

  let areaCountsRows: Array<{ pledge_type: string; cnt: number }>;
  let globalPledgesCount: number;
  let userPledgedTypes = new Set<string>();
  let residentsPledged: number;
  let userJoinedSolidarity: boolean;
  let areaRows: Array<{ area: string; pledgeCount: number; deviceCount: number }>;
  let co2ByAreaRows: Array<{ area: string; pledge_type: string; cnt: number }>;

  if (db) {
    areaCountsRows = db
      .prepare(`SELECT pledge_type, COUNT(*) as cnt FROM pledges WHERE lower(area) = lower(?) GROUP BY pledge_type`)
      .all(normalizedArea) as Array<{ pledge_type: string; cnt: number }>;

    globalPledgesCount = (db.prepare(`SELECT COUNT(*) as cnt FROM pledges`).get() as { cnt: number }).cnt;

    if (deviceId) {
      const userRows = db
        .prepare(`SELECT pledge_type FROM pledges WHERE device_id = ? AND pledge_date = ?`)
        .all(deviceId, today) as Array<{ pledge_type: string }>;
      userPledgedTypes = new Set(userRows.map((r) => r.pledge_type));
    }

    residentsPledged = (
      db
        .prepare(
          `SELECT COUNT(*) as cnt FROM (
             SELECT device_id FROM pledges WHERE lower(area) = lower(?)
             UNION
             SELECT device_id FROM solidarity_members WHERE lower(area) = lower(?)
           )`
        )
        .get(normalizedArea, normalizedArea) as { cnt: number }
    ).cnt;

    userJoinedSolidarity = deviceId
      ? Boolean(db.prepare(`SELECT 1 FROM solidarity_members WHERE device_id = ?`).get(deviceId))
      : false;

    areaRows = db
      .prepare(
        `SELECT area, COUNT(*) as pledgeCount, COUNT(DISTINCT device_id) as deviceCount
         FROM pledges
         GROUP BY lower(area)
         ORDER BY pledgeCount DESC
         LIMIT 8`
      )
      .all() as Array<{ area: string; pledgeCount: number; deviceCount: number }>;

    co2ByAreaRows = db
      .prepare(`SELECT area, pledge_type, COUNT(*) as cnt FROM pledges GROUP BY lower(area), pledge_type`)
      .all() as Array<{ area: string; pledge_type: string; cnt: number }>;
  } else {
    const store = getStore();
    const target = normalizedArea.toLowerCase();
    const areaCounts = new Map<string, number>();
    const uniqueDevices = new Set<string>();
    const areaGroups = new Map<string, { area: string; pledgeCount: number; devices: Set<string> }>();
    const co2Groups = new Map<string, { area: string; pledge_type: string; cnt: number }>();

    for (const p of store.pledges) {
      const key = p.area.toLowerCase();
      if (key === target) {
        areaCounts.set(p.pledge_type, (areaCounts.get(p.pledge_type) ?? 0) + 1);
        uniqueDevices.add(p.device_id);
      }
      if (deviceId && p.device_id === deviceId && p.pledge_date === today) {
        userPledgedTypes.add(p.pledge_type);
      }
      const grp = areaGroups.get(key) ?? { area: p.area, pledgeCount: 0, devices: new Set<string>() };
      grp.pledgeCount += 1;
      grp.devices.add(p.device_id);
      areaGroups.set(key, grp);

      const co2Key = `${key}::${p.pledge_type}`;
      const cGrp = co2Groups.get(co2Key) ?? { area: p.area, pledge_type: p.pledge_type, cnt: 0 };
      cGrp.cnt += 1;
      co2Groups.set(co2Key, cGrp);
    }

    for (const m of store.solidarity_members) {
      if (m.area.toLowerCase() === target) {
        uniqueDevices.add(m.device_id);
      }
    }

    areaCountsRows = Array.from(areaCounts.entries()).map(([pledge_type, cnt]) => ({ pledge_type, cnt }));
    globalPledgesCount = store.pledges.length;
    residentsPledged = uniqueDevices.size;
    userJoinedSolidarity = deviceId
      ? store.solidarity_members.some((m) => m.device_id === deviceId)
      : false;
    areaRows = Array.from(areaGroups.values())
      .map((g) => ({ area: g.area, pledgeCount: g.pledgeCount, deviceCount: g.devices.size }))
      .sort((a, b) => b.pledgeCount - a.pledgeCount)
      .slice(0, 8);
    co2ByAreaRows = Array.from(co2Groups.values());
  }

  const areaMap = new Map(areaCountsRows.map((r) => [r.pledge_type, r.cnt]));
  const totalAreaPledges = Array.from(areaMap.values()).reduce((a, b) => a + b, 0);

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

  const totalCo2AvoidedKg =
    Math.round(pledges.reduce((sum, p) => sum + p.totalCount * p.co2KgEstimate, 0) * 10) / 10;
  const totalUgM3Avoided = Math.round(totalAreaPledges * 12);
  const adoptionPercent =
    residentsPledged > 0
      ? Math.min(100, Math.round((totalAreaPledges / (residentsPledged * 3)) * 100))
      : 0;

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
    isSeed: false,
    seedNotice:
      totalAreaPledges > 0
        ? `Showing ${totalAreaPledges} real verified pledge${totalAreaPledges === 1 ? '' : 's'} from ${residentsPledged} household${residentsPledged === 1 ? '' : 's'} in ${normalizedArea}.`
        : `No pledges recorded yet in ${normalizedArea}${globalPledgesCount > 0 ? ` (${globalPledgesCount} verified globally)` : ''}. Take a pledge below to record real household impact.`,
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
  const normalizedArea = area.trim() || 'Local Neighbourhood';

  if (db) {
    const existing = db
      .prepare(`SELECT id FROM pledges WHERE device_id = ? AND pledge_type = ? AND pledge_date = ?`)
      .get(deviceId, pledgeType, today);

    if (existing) {
      return { alreadyPledgedToday: true, community: getCommunitySummary(area, deviceId) };
    }

    db.prepare(
      `INSERT INTO pledges (device_id, area, pledge_type, pledge_date, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(deviceId, normalizedArea, pledgeType, today, now);
  } else {
    const store = getStore();
    const existing = store.pledges.find(
      (p) => p.device_id === deviceId && p.pledge_type === pledgeType && p.pledge_date === today
    );
    if (existing) {
      return { alreadyPledgedToday: true, community: getCommunitySummary(area, deviceId) };
    }
    store.pledges.push({
      id: store.nextId++,
      device_id: deviceId,
      area: normalizedArea,
      pledge_type: pledgeType,
      pledge_date: today,
      created_at: now
    });
    saveStore(store);
  }

  return { alreadyPledgedToday: false, community: getCommunitySummary(area, deviceId) };
}

export function joinSolidarity(deviceId: string, area: string, contactHint: string | undefined, consentGiven: boolean) {
  const now = new Date().toISOString();
  const normalizedArea = area.trim() || 'Local Neighbourhood';

  if (db) {
    db.prepare(
      `INSERT INTO solidarity_members (device_id, area, contact_hint, consent_given, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET area = excluded.area, contact_hint = excluded.contact_hint, consent_given = excluded.consent_given`
    ).run(deviceId, normalizedArea, contactHint || null, consentGiven ? 1 : 0, now);
  } else {
    const store = getStore();
    const idx = store.solidarity_members.findIndex((m) => m.device_id === deviceId);
    const entry = {
      device_id: deviceId,
      area: normalizedArea,
      contact_hint: contactHint || null,
      consent_given: consentGiven ? 1 : 0,
      created_at: now
    };
    if (idx >= 0) store.solidarity_members[idx] = entry;
    else store.solidarity_members.push(entry);
    saveStore(store);
  }

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
  if (db) {
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

  const store = getStore();
  const id = store.nextId++;
  store.alert_log.push({
    id,
    device_id: params.deviceId,
    area: params.area,
    recipient: params.recipient,
    channel: params.channel,
    message_body: params.messageBody,
    created_at: now
  });
  saveStore(store);
  return { id, ...params, createdAt: now };
}

export function getAlertLogs(deviceId: string) {
  if (db) {
    return db
      .prepare(
        `SELECT id, area, recipient, channel, message_body as messageBody, created_at as createdAt
         FROM alert_log WHERE device_id = ? ORDER BY id DESC LIMIT 20`
      )
      .all(deviceId);
  }
  return getStore()
    .alert_log.filter((l) => l.device_id === deviceId)
    .sort((a, b) => b.id - a.id)
    .slice(0, 20)
    .map((l) => ({
      id: l.id,
      area: l.area,
      recipient: l.recipient,
      channel: l.channel,
      messageBody: l.message_body,
      createdAt: l.created_at
    }));
}

export function savePushSubscription(params: {
  deviceId: string;
  subscription: { endpoint: string; [key: string]: unknown };
  area: string;
  alertType?: string;
}) {
  const now = new Date().toISOString();
  if (db) {
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
    return;
  }

  const store = getStore();
  const idx = store.push_subscriptions.findIndex((s) => s.endpoint === params.subscription.endpoint);
  const entry = {
    device_id: params.deviceId,
    endpoint: params.subscription.endpoint,
    subscription_json: JSON.stringify(params.subscription),
    area: params.area,
    alert_type: params.alertType || 'inversion',
    created_at: now
  };
  if (idx >= 0) store.push_subscriptions[idx] = entry;
  else store.push_subscriptions.push(entry);
  saveStore(store);
}

export function getAllPushSubscriptions(deviceId?: string) {
  if (db) {
    if (deviceId) {
      return db
        .prepare(`SELECT subscription_json FROM push_subscriptions WHERE device_id = ?`)
        .all(deviceId) as Array<{ subscription_json: string }>;
    }
    return db
      .prepare(`SELECT subscription_json FROM push_subscriptions`)
      .all() as Array<{ subscription_json: string }>;
  }
  const subs = getStore().push_subscriptions;
  return (deviceId ? subs.filter((s) => s.device_id === deviceId) : subs).map((s) => ({
    subscription_json: s.subscription_json
  }));
}

export default db;
