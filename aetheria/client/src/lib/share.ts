export interface SharePayload {
  title: string;
  text: string;
  url?: string;
}

export async function tryNativeShare(payload: SharePayload): Promise<'shared' | 'fallback'> {
  const isTouchDevice =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;

  if (isTouchDevice && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: payload.title,
        text: payload.text,
        url: payload.url || window.location.href
      });
      return 'shared';
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return 'shared';
      }
    }
  }
  return 'fallback';
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function buildWhatsAppLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function buildSmsLink(text: string, phone?: string): string {
  const target = phone ? phone.replace(/[^\d+]/g, '') : '';
  return `sms:${target}?body=${encodeURIComponent(text)}`;
}

export function buildMailtoLink(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
