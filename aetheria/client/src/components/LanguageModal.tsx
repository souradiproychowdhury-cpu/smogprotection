import React, { useState } from 'react';
import { LANGUAGE_OPTIONS } from '../i18n/languages';
import { useTranslation } from '../i18n/useTranslation';
import { useAppStore } from '../store/useAppStore';
import { ModalDialog } from './ModalDialog';

interface LanguageModalProps {
  open: boolean;
  onClose: () => void;
  isFirstRun?: boolean;
}

export const LanguageModal: React.FC<LanguageModalProps> = ({ open, onClose, isFirstRun = false }) => {
  const { language, selectLanguage, selectCustomLanguage, translating } = useTranslation();
  const pushToast = useAppStore((s) => s.pushToast);
  const [customQuery, setCustomQuery] = useState('');
  const [listeningLang, setListeningLang] = useState(false);

  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customQuery.trim()) return;
    await selectCustomLanguage(customQuery);
    setCustomQuery('');
    onClose();
  };

  const handleSpeakLanguage = () => {
    const win = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        start: () => void;
        onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onerror: (() => void) | null;
        onend: (() => void) | null;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        start: () => void;
        onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onerror: (() => void) | null;
        onend: (() => void) | null;
      };
    };
    const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SR) {
      pushToast('Speech recognition unavailable in this browser — please type the language name.', 'info');
      return;
    }
    const rec = new SR();
    rec.lang = language.bcp47 || 'en-US';
    setListeningLang(true);
    rec.onresult = async (ev) => {
      const spoken = ev.results?.[0]?.[0]?.transcript?.trim();
      if (spoken) {
        setCustomQuery(spoken);
        await selectCustomLanguage(spoken);
        setCustomQuery('');
        onClose();
      }
    };
    rec.onerror = () => {
      setListeningLang(false);
      pushToast('Could not hear language name — please type it.', 'info');
    };
    rec.onend = () => setListeningLang(false);
    rec.start();
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title={isFirstRun ? 'Welcome to Aetheria — Choose Your Language' : 'Choose App & Voice Language'}
      maxWidthClass="max-w-2xl"
    >
      <div className="space-y-4">
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          Aetheria translates every screen, AI answer, guided tutorial, and voice response into your preferred language.
        </p>

        <form onSubmit={handleCustomSubmit} className="flex gap-2">
          <label htmlFor="custom-lang-input" className="sr-only">
            Other language
          </label>
          <input
            id="custom-lang-input"
            type="text"
            value={customQuery}
            onChange={(e) => setCustomQuery(e.target.value)}
            placeholder="Other language... (e.g. Swahili, Nepali, Vietnamese)"
            className="flex-1 px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-outline-variant/60 text-on-surface placeholder:text-on-surface-variant/50"
          />
          <button
            type="button"
            onClick={handleSpeakLanguage}
            aria-label="Speak language name"
            title="Speak language name"
            className={`px-3 py-2.5 rounded-xl flex items-center justify-center transition ${
              listeningLang ? 'bg-secondary text-on-secondary animate-pulse' : 'bg-surface-container-high hover:bg-surface-bright text-primary'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">
              {listeningLang ? 'graphic_eq' : 'mic'}
            </span>
          </button>
          <button
            type="submit"
            disabled={translating || !customQuery.trim()}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-primary-container to-primary text-on-primary-container font-label-md text-label-md font-bold disabled:opacity-50"
          >
            {translating ? 'Resolving...' : 'Apply'}
          </button>
        </form>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {LANGUAGE_OPTIONS.map((opt) => {
            const active = language.code === opt.code;
            return (
              <button
                key={opt.code}
                type="button"
                onClick={async () => {
                  await selectLanguage(opt);
                  onClose();
                }}
                className={`p-3 rounded-xl text-left transition border flex flex-col ${
                  active
                    ? 'bg-primary/20 border-primary text-primary'
                    : 'bg-surface-container hover:bg-surface-container-high border-transparent text-on-surface'
                }`}
              >
                <span className="font-body-md text-body-md font-bold">{opt.nativeName}</span>
                <span className="font-label-sm text-label-sm text-on-surface-variant">{opt.englishName}</span>
              </button>
            );
          })}
        </div>
      </div>
    </ModalDialog>
  );
};
