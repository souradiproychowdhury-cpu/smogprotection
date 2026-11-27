import webpush from 'web-push';
import { env } from '../config/env.js';
import { getAllPushSubscriptions } from '../db/database.js';

let configured = false;

if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    configured = true;
  } catch {
    configured = false;
  }
}

export function isPushConfigured(): boolean {
  return configured;
}

export async function sendTestPush(deviceId: string, payload: { title: string; body: string; url?: string }) {
  if (!configured) {
    return { sent: 0, mode: 'local-fallback' as const };
  }

  const subs = getAllPushSubscriptions(deviceId);
  let sent = 0;
  for (const row of subs) {
    try {
      const sub = JSON.parse(row.subscription_json);
      await webpush.sendNotification(sub, JSON.stringify(payload));
      sent++;
    } catch {
      // Ignore expired subscription errors
    }
  }
  return { sent, mode: 'web-push' as const };
}
