import { api } from './api';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function enableNotificationsAndPush(params: {
  deviceId: string;
  area: string;
  alertType?: string;
  vapidPublicKey: string | null;
}): Promise<{ ok: boolean; mode: 'web-push' | 'local' | 'denied'; message: string }> {
  if (typeof Notification === 'undefined') {
    return { ok: false, mode: 'denied', message: 'Notifications are not supported in this browser.' };
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }

  if (permission !== 'granted') {
    return {
      ok: false,
      mode: 'denied',
      message: 'Notification permission was blocked. Enable notifications in browser site settings.'
    };
  }

  if (params.vapidPublicKey && 'serviceWorker' in navigator && 'PushManager' in window) {
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(params.vapidPublicKey) as unknown as BufferSource
        }));
      await api.pushSubscribe({
        deviceId: params.deviceId,
        area: params.area,
        alertType: params.alertType || 'inversion',
        subscription: sub.toJSON()
      });
      return { ok: true, mode: 'web-push', message: 'Web Push alerts enabled.' };
    } catch {
      // Fallback to local notifications
    }
  }

  return {
    ok: true,
    mode: 'local',
    message: 'Local browser alerts enabled (VAPID push keys not configured on server).'
  };
}

export function showLocalNotification(title: string, body: string): boolean {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return false;
  }
  try {
    new Notification(title, { body, icon: '/icon.svg' });
    return true;
  } catch {
    return false;
  }
}

export function scheduleLocalReminder(title: string, body: string, delayMs: number): number {
  const clamped = Math.max(1000, Math.min(delayMs, 24 * 60 * 60 * 1000));
  return window.setTimeout(() => {
    showLocalNotification(title, body);
  }, clamped);
}
