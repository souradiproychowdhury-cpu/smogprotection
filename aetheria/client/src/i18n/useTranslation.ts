import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { idbGet, idbSet } from '../lib/idb';
import { useAppStore } from '../store/useAppStore';
import { BUNDLED_TRANSLATIONS, EN_STRINGS, type TranslationKey } from './strings';
import { LANGUAGE_OPTIONS, type SupportedLanguageOption } from './languages';

const I18N_CACHE_VERSION = 'v1';

// Shared module-level cache so all components re-render when dynamic pack loads
let activePack: Record<string, string> = { ...EN_STRINGS };
let activePackLang = 'en';
const inFlightTranslations = new Map<string, Promise<Record<string, string> | null>>();
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

async function ensureLanguagePack(language: {
  code: string;
  englishName: string;
  nativeName: string;
}): Promise<void> {
  if (language.code === 'en') {
    if (activePackLang !== 'en') {
      activePack = { ...EN_STRINGS };
      activePackLang = 'en';
      notifyListeners();
    }
    return;
  }

  if (activePackLang === language.code) return;

  const bundled = BUNDLED_TRANSLATIONS[language.code] || {};
  const cacheKey = `i18n:${language.code}:${I18N_CACHE_VERSION}`;
  const cached = await idbGet<Record<string, string>>(cacheKey);
  if (cached) {
    activePack = { ...EN_STRINGS, ...bundled, ...cached };
    activePackLang = language.code;
    notifyListeners();
    return;
  }

  activePack = { ...EN_STRINGS, ...bundled };
  activePackLang = language.code;
  notifyListeners();

  if (!navigator.onLine) return;

  let pending = inFlightTranslations.get(language.code);
  if (!pending) {
    pending = api
      .translate(language.englishName || language.nativeName, { ...EN_STRINGS })
      .then(async (res) => {
        if (res.translations) {
          const merged = { ...EN_STRINGS, ...bundled, ...res.translations };
          await idbSet(cacheKey, merged);
          return merged;
        }
        return null;
      })
      .catch(() => null)
      .finally(() => {
        inFlightTranslations.delete(language.code);
      });
    inFlightTranslations.set(language.code, pending);
  }

  const translated = await pending;
  if (translated) {
    activePack = translated;
    activePackLang = language.code;
    notifyListeners();
  }
}

export function useTranslation() {
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const pushToast = useAppStore((s) => s.pushToast);
  const [, forceUpdate] = useState(0);
  const [translating, setTranslating] = useState(false);

  useEffect(() => {
    const cb = () => forceUpdate((n) => n + 1);
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);

  // Apply lang & dir attributes on <html>
  useEffect(() => {
    document.documentElement.lang = language.bcp47 || language.code || 'en';
    document.documentElement.dir = language.rtl ? 'rtl' : 'ltr';
  }, [language]);

  // Load cached translation pack for active language (deduplicated globally)
  useEffect(() => {
    let cancelled = false;
    if (activePackLang === language.code) return;
    setTranslating(true);
    ensureLanguagePack(language).finally(() => {
      if (!cancelled) setTranslating(false);
    });
    return () => {
      cancelled = true;
    };
  }, [language.code, language.englishName, language.nativeName]);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>): string => {
      const base = activePack[key] || BUNDLED_TRANSLATIONS[language.code]?.[key] || EN_STRINGS[key] || key;
      if (!vars) return base;
      return Object.entries(vars).reduce(
        (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)),
        base
      );
    },
    [language.code]
  );

  const selectLanguage = useCallback(
    async (opt: SupportedLanguageOption) => {
      setLanguage({ ...opt, chosenByUser: true });
      pushToast(`Language set to ${opt.nativeName}`, 'success');
    },
    [setLanguage, pushToast]
  );

  const selectCustomLanguage = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      const preset = LANGUAGE_OPTIONS.find(
        (l) =>
          l.englishName.toLowerCase() === trimmed.toLowerCase() ||
          l.nativeName.toLowerCase() === trimmed.toLowerCase() ||
          l.code.toLowerCase() === trimmed.toLowerCase()
      );
      if (preset) {
        await selectLanguage(preset);
        return;
      }

      setTranslating(true);
      try {
        const resolved = await api.resolveLanguage(trimmed);
        setLanguage({
          code: resolved.bcp47.split('-')[0].toLowerCase(),
          bcp47: resolved.bcp47,
          englishName: resolved.englishName,
          nativeName: resolved.nativeName,
          rtl: resolved.rtl,
          chosenByUser: true
        });
        pushToast(`Language set to ${resolved.nativeName}`, 'success');
      } catch {
        setLanguage({
          code: trimmed.toLowerCase().slice(0, 6),
          bcp47: 'en-US',
          englishName: trimmed,
          nativeName: trimmed,
          rtl: false,
          chosenByUser: true
        });
      } finally {
        setTranslating(false);
      }
    },
    [selectLanguage, setLanguage, pushToast]
  );

  const formatNumber = useCallback(
    (val: number, options?: Intl.NumberFormatOptions) => {
      try {
        return new Intl.NumberFormat(language.bcp47 || 'en-US', options).format(val);
      } catch {
        return String(val);
      }
    },
    [language.bcp47]
  );

  const formatTime = useCallback(
    (isoOrDate: string | Date) => {
      try {
        const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
        return new Intl.DateTimeFormat(language.bcp47 || 'en-US', {
          hour: '2-digit',
          minute: '2-digit'
        }).format(d);
      } catch {
        return '';
      }
    },
    [language.bcp47]
  );

  return {
    t,
    language,
    translating,
    selectLanguage,
    selectCustomLanguage,
    formatNumber,
    formatTime
  };
}
