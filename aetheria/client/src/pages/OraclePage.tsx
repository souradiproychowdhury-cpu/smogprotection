import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { mapUsAqiToSpectrum, type OracleResponse } from '@aetheria/shared';
import { AtmosphericShader } from '../components/AtmosphericShader';
import { ModalDialog } from '../components/ModalDialog';
import { ShareModal } from '../components/ShareModal';
import { api } from '../lib/api';
import { enableNotificationsAndPush, scheduleLocalReminder, showLocalNotification } from '../lib/notifications';
import { copyToClipboard, tryNativeShare } from '../lib/share';
import { useAppStore } from '../store/useAppStore';
import { useTranslation } from '../i18n/useTranslation';
import { useVoice } from '../voice/useVoice';

const DEFAULT_CHIPS = [
  { icon: 'bedroom_baby', label: 'Family Evening Routine' },
  { icon: 'skillet', label: 'Stove Emission Hack' },
  { icon: 'directions_subway', label: 'Metro vs Bike Today' },
  { icon: 'medical_services', label: 'Asthma Shield' }
];

export const OraclePage: React.FC = () => {
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const sanctuaryContext = (routeLocation.state as { sanctuaryContext?: string } | null)?.sanctuaryContext;
  const { t, language } = useTranslation();
  const { speakText } = useVoice();

  const air = useAppStore((s) => s.air);
  const profile = useAppStore((s) => s.profile);
  const deviceId = useAppStore((s) => s.deviceId);
  const vapidPublicKey = useAppStore((s) => s.vapidPublicKey);
  const oracleMessages = useAppStore((s) => s.oracleMessages);
  const addOracleMessage = useAppStore((s) => s.addOracleMessage);
  const clearOracleChat = useAppStore((s) => s.clearOracleChat);
  const oracleStyle = useAppStore((s) => s.oracleStyle);
  const setOracleStyle = useAppStore((s) => s.setOracleStyle);
  const vaultBookmarks = useAppStore((s) => s.vaultBookmarks);
  const toggleVaultBookmark = useAppStore((s) => s.toggleVaultBookmark);
  const windAlertSubscribed = useAppStore((s) => s.windAlertSubscribed);
  const setWindAlertSubscribed = useAppStore((s) => s.setWindAlertSubscribed);
  const alwaysReadAloud = useAppStore((s) => s.a11y.alwaysReadAloud);
  const pushToast = useAppStore((s) => s.pushToast);

  const [input, setInput] = useState('');
  const [loadingPhase, setLoadingPhase] = useState<string | null>(null);
  const [chatError, setChatError] = useState<{ message: string; lastQuestion: string } | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<{ title: string; text: string } | null>(null);
  const [listeningLocal, setListeningLocal] = useState(false);
  const [showContextBanner, setShowContextBanner] = useState(Boolean(sanctuaryContext));
  const scanInputRef = useRef<HTMLInputElement>(null);
  const streamEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (oracleMessages.length > 0 || loadingPhase || chatError) {
      streamEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [oracleMessages.length, loadingPhase, chatError]);

  const cat = mapUsAqiToSpectrum(air?.aqi ?? 0);

  const lastOracleCard = [...oracleMessages].reverse().find((m) => m.role === 'oracle' && m.card)?.card;
  const followUpSuggestions = (
    lastOracleCard?.followUps?.length
      ? lastOracleCard.followUps
      : ['How do I seal drafty windows cheaply?', 'Is it safe for a child to walk outside right now?']
  ).filter(
    (q) =>
      !/low-emission walking corridor/i.test(q) &&
      !/wind dispersion begins/i.test(q)
  );

  const headerChips =
    lastOracleCard?.followUps?.length && followUpSuggestions.length > 0
      ? followUpSuggestions.slice(0, 4).map((label) => ({ icon: 'auto_awesome', label }))
      : DEFAULT_CHIPS;

  const sendQuestion = async (
    questionText: string,
    imagePayload?: { base64: string; mimeType: string },
    options?: { skipAppendUser?: boolean }
  ) => {
    const q = questionText.trim();
    if (!q || loadingPhase) return;

    const historySource = options?.skipAppendUser ? oracleMessages.slice(0, -1) : oracleMessages;
    const history = historySource.slice(-6).map((m) => ({
      role: (m.role === 'user' ? 'user' : 'model') as 'user' | 'model',
      text: m.card ? `${m.card.title}: ${m.card.summary}` : m.text
    }));

    if (!options?.skipAppendUser) {
      const nowLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      addOracleMessage({
        id: `u-${Date.now()}`,
        role: 'user',
        text: imagePayload ? `📷 [Photo attached] ${q}` : q,
        timestamp: nowLabel
      });
    }
    setInput('');
    setChatError(null);
    setLoadingPhase('analyzing_air');

    try {
      const res = await api.streamOracle(
        {
          message: q,
          history,
          language: language.englishName || language.nativeName,
          profile,
          lat: air?.lat ?? profile.location?.lat,
          lon: air?.lon ?? profile.location?.lon,
          locationName: air?.locationName ?? profile.location?.name,
          localTime: new Date().toLocaleTimeString(),
          style: oracleStyle,
          imageBase64: imagePayload?.base64,
          imageMimeType: imagePayload?.mimeType
        },
        (phase) => setLoadingPhase(phase)
      );

      addOracleMessage({
        id: `o-${Date.now()}`,
        role: 'oracle',
        text: res.data.summary,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        card: res.data,
        isAiFallback: res.isAiFallback,
        notice: res.notice
      });

      if (alwaysReadAloud) {
        speakText(`${res.data.title}. ${res.data.summary}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Oracle failed to respond';
      setChatError({ message: msg, lastQuestion: q });
      pushToast(msg, 'error');
    } finally {
      setLoadingPhase(null);
    }
  };

  const handleScanFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      pushToast('Please select an image file.', 'error');
      return;
    }

    const sendImage = (dataUrl: string, mimeType: string) => {
      const base64 = dataUrl.split(',')[1];
      if (!base64) {
        pushToast('Could not read selected image.', 'error');
        return;
      }
      sendQuestion(
        'Inspect this photo of my room, filter, mask, or stove. Tell me what is working well and any affordable air-quality improvement.',
        { base64, mimeType }
      );
    };

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read image'));
        reader.readAsDataURL(file);
      });

      // Downscale large camera photos to <=1280px JPEG so upload stays fast and under 6MB
      const img = new Image();
      img.onload = () => {
        const maxDim = 1280;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        if (scale >= 1 && file.size <= 2_500_000) {
          sendImage(dataUrl, file.type || 'image/jpeg');
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          sendImage(dataUrl, file.type || 'image/jpeg');
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        sendImage(canvas.toDataURL('image/jpeg', 0.82), 'image/jpeg');
      };
      img.onerror = () => sendImage(dataUrl, file.type || 'image/jpeg');
      img.src = dataUrl;
    } catch {
      pushToast('Failed to process image for Oracle scan.', 'error');
    }
  };

  const handleDictate = () => {
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
      pushToast('Browser dictation unavailable here — use the floating voice mic button.', 'info');
      return;
    }
    const rec = new SR();
    rec.lang = language.bcp47 || 'en-US';
    setListeningLocal(true);
    rec.onresult = (ev) => {
      const txt = ev.results?.[0]?.[0]?.transcript;
      if (txt) setInput(txt);
    };
    rec.onerror = () => setListeningLocal(false);
    rec.onend = () => setListeningLocal(false);
    rec.start();
  };

  const handleWindAlert = async () => {
    const res = await enableNotificationsAndPush({
      deviceId,
      area: air?.locationName || 'Local Area',
      alertType: 'wind_dispersion',
      vapidPublicKey
    });
    setWindAlertSubscribed(true);
    showLocalNotification('Wind Dispersion Watch Active', `Watching hourly wind forecast for ${air?.locationName || 'your area'}.`);
    pushToast(res.ok ? 'Subscribed to wind dispersion alerts!' : 'Wind dispersion alert saved locally.', 'success');
  };

  const handleSaveCard = (card: OracleResponse, msgId: string) => {
    toggleVaultBookmark({
      id: `oracle-${msgId}`,
      kind: 'oracle',
      title: card.title,
      summary: card.summary,
      savedAt: new Date().toISOString(),
      card
    });
    pushToast('Saved to Vault > Saved', 'success');
  };

  const handleShareCard = async (card: OracleResponse) => {
    const text = `${card.title}\n${card.summary}\n\nSteps:\n${card.steps.map((s) => `${s.n}. ${s.label}: ${s.detail}`).join('\n')}`;
    const res = await tryNativeShare({ title: card.title, text });
    if (res === 'fallback') setShareTarget({ title: card.title, text });
  };

  return (
    <div className="space-y-5">
      {/* Interactive Ambient Header Banner */}
      <section className="relative rounded-2xl bg-surface-container-high overflow-hidden shadow-xl p-5 gilded-rim">
        <div className="absolute inset-0 h-full opacity-40 pointer-events-none">
          <AtmosphericShader />
        </div>
        <div className="relative z-10 flex flex-col items-center text-center space-y-2">
          <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-primary via-primary-container to-secondary p-0.5 flex items-center justify-center">
            <div className="w-full h-full rounded-full bg-surface-container-lowest flex items-center justify-center">
              <span className="material-symbols-outlined text-primary text-[24px]">auto_awesome</span>
            </div>
          </div>
          <h1 className="font-headline-sm text-headline-sm text-primary font-semibold">
            {t('oracle.title')}
          </h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant max-w-md">
            {t('oracle.subtitle')}
          </p>

          {/* Suggested Chips */}
          <div
            data-tour="oracle-suggestions"
            className="w-full overflow-x-auto no-scrollbar flex items-center justify-start sm:justify-center gap-2 pt-2"
          >
            {headerChips.map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={() => sendQuestion(chip.label)}
                className="shrink-0 px-3 py-1.5 rounded-full bg-surface-container hover:bg-surface-variant text-on-surface font-label-md text-label-md flex items-center gap-1.5 transition"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-primary text-[15px]">{chip.icon}</span>
                <span>{chip.label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {showContextBanner && sanctuaryContext && (
        <div className="p-3.5 rounded-xl bg-primary/15 border border-primary/40 flex items-center justify-between gap-3">
          <div className="text-xs text-on-surface">
            <span className="font-bold text-primary uppercase block">Sanctuary Context Loaded</span>
            <span>{sanctuaryContext}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setShowContextBanner(false);
                sendQuestion(`Given my current Sanctuary status (${sanctuaryContext}), what is the single highest-impact action right now?`);
              }}
              className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-bold"
            >
              Analyze Now
            </button>
            <button
              type="button"
              aria-label="Dismiss context banner"
              onClick={() => setShowContextBanner(false)}
              className="p-1 rounded-full hover:bg-surface-container-high text-on-surface-variant"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        </div>
      )}

      {/* Live Context Strip + Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-surface-container-low">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px]" style={{ color: cat.textColor }}>
            {air?.inversionDetected ? 'warning' : 'air'}
          </span>
          <div>
            <div className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
              {air?.inversionDetected ? 'Ambient Inversion Active' : 'Live Air Context'}
            </div>
            <div className="font-label-md text-label-md font-semibold text-on-surface">
              {air ? `PM2.5 ${air.pm25} µg/m³ · US AQI ${air.aqi} (${cat.shortLabel})` : 'Loading live air...'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-tour="oracle-filter-btn"
            onClick={() => setFilterOpen(true)}
            aria-label="Answer style preferences"
            className="px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-bright text-primary font-label-sm font-semibold flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">tune</span>
            <span>Style</span>
          </button>
          <button
            type="button"
            onClick={() => {
              clearOracleChat();
              setInput('');
              pushToast('Started a fresh Oracle thread', 'info');
            }}
            className="px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-bright text-on-surface font-label-sm font-semibold"
          >
            {t('oracle.newChat')}
          </button>
          <button
            type="button"
            onClick={() => {
              clearOracleChat();
              setInput('');
              setWindAlertSubscribed(false);
              pushToast('Cleared Oracle chat history', 'info');
            }}
            className="px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-bright text-error font-label-sm font-semibold"
          >
            {t('oracle.clear')}
          </button>
        </div>
      </div>

      {/* Conversational Stream */}
      <div className="space-y-4">
        {oracleMessages.length === 0 && (
          <div className="p-5 rounded-2xl bg-surface-container/60 border border-outline-variant/30 text-center space-y-2">
            <p className="font-body-md text-body-md text-on-surface">
              Ask any question below, tap a suggested chip, or scan a photo of your room, filter, mask, or stove.
            </p>
          </div>
        )}

        {oracleMessages.map((msg) => {
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="flex justify-end ps-6">
                <div className="bg-surface-container-high rounded-2xl rounded-tr-sm p-3.5 shadow-md max-w-[90%]">
                  <div className="flex items-center gap-1.5 mb-1 text-on-surface-variant text-xs">
                    <span>You</span>
                    <span>•</span>
                    <span>{msg.timestamp}</span>
                  </div>
                  <p className="font-body-md text-body-md text-on-surface">{msg.text}</p>
                </div>
              </div>
            );
          }

          const card = msg.card;
          const isSaved = vaultBookmarks.some((b) => b.id === `oracle-${msg.id}`);

          return (
            <article key={msg.id} className="relative bg-surface-container-high rounded-2xl p-4 sm:p-5 shadow-2xl space-y-4 gilded-rim">
              {msg.notice && (
                <div className="px-3 py-2 rounded-lg bg-primary/15 text-primary text-xs font-medium flex flex-wrap items-center justify-between gap-2">
                  <span>{msg.notice}</span>
                  <button
                    type="button"
                    onClick={() => navigate('/settings')}
                    className="underline font-bold shrink-0"
                  >
                    Check API Status →
                  </button>
                </div>
              )}

              {card ? (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-label-sm text-label-sm text-secondary uppercase tracking-widest font-bold">
                        Protocol Guidance {card.assemblyTime ? `· ${card.assemblyTime}` : ''}
                      </div>
                      <h2 className="font-headline-sm text-headline-sm text-primary font-semibold mt-0.5">
                        {card.title}
                      </h2>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full bg-secondary-container/25 text-secondary font-label-sm font-bold uppercase shrink-0">
                      {card.urgency.replace('_', ' ')}
                    </span>
                  </div>

                  <p className="font-body-md text-body-md text-on-surface leading-relaxed">{card.summary}</p>

                  {/* Numbered Steps */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {card.steps.map((step) => (
                      <div key={step.n} className="p-3 rounded-xl bg-surface-container flex flex-col gap-1">
                        <span className="w-6 h-6 rounded-full bg-primary/20 text-primary font-label-sm font-bold flex items-center justify-center">
                          {step.n}
                        </span>
                        <div className="font-label-md text-label-md font-semibold text-on-surface">{step.label}</div>
                        <p className="font-body-sm text-body-sm text-on-surface-variant">{step.detail}</p>
                      </div>
                    ))}
                  </div>

                  {/* Direct Impact Metrics */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {card.impact.map((imp, idx) => (
                      <div key={idx} className="p-3 rounded-xl bg-surface-container space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-label-sm text-label-sm text-on-surface-variant">{imp.metric}</span>
                          {imp.isEstimate && (
                            <span className="px-1.5 py-0.5 rounded bg-primary/15 text-primary text-[10px] font-bold uppercase">
                              Estimate
                            </span>
                          )}
                        </div>
                        <div className="font-label-lg text-label-lg font-bold text-secondary">{imp.value}</div>
                        <div className="text-xs text-on-surface-variant">{imp.basis}</div>
                      </div>
                    ))}
                  </div>

                  {/* Natural Remedy / Evidence Card */}
                  <div className="p-3.5 rounded-xl bg-surface-container-low space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-label-md text-label-md font-semibold text-primary">
                        {card.remedy.title}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-surface-container-high text-xs text-secondary uppercase font-semibold">
                        Evidence: {card.remedy.evidence}
                      </span>
                    </div>
                    <p className="font-body-sm text-body-sm text-on-surface-variant">{card.remedy.text}</p>
                    <p className="text-xs text-tertiary pt-1">{card.evidenceNote}</p>
                  </div>

                  {card.safetyNote && (
                    <div className="p-3 rounded-xl bg-error-container/30 border border-error/40 text-xs text-on-error-container flex items-start gap-2">
                      <span className="material-symbols-outlined text-error text-[18px] shrink-0">emergency</span>
                      <span>{card.safetyNote}</span>
                    </div>
                  )}

                  {/* Contextual Action Buttons */}
                  {card.actions.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {card.actions
                        .filter((a) => a.type !== 'none')
                        .map((act, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={async () => {
                              if (act.type === 'open_route') navigate('/route');
                              else if (act.type === 'open_health') navigate('/health');
                              else if (act.type === 'open_alert') navigate('/alert');
                              else if (act.type === 'set_reminder') {
                                await enableNotificationsAndPush({
                                  deviceId,
                                  area: air?.locationName || 'Local Area',
                                  alertType: 'oracle_reminder',
                                  vapidPublicKey
                                });
                                scheduleLocalReminder('Aetheria Clean-Air Reminder', act.label, 60000);
                                showLocalNotification('Aetheria Reminder Armed', act.label);
                                pushToast(`Reminder armed: ${act.label}`, 'success');
                              }
                            }}
                            className="px-3 py-1.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary font-label-md text-xs font-semibold"
                          >
                            {act.label}
                          </button>
                        ))}
                    </div>
                  )}

                  {/* Footer: Honest Confidence + Save / Share / Listen / Copy */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-outline-variant/30 text-xs text-on-surface-variant">
                    <span className="inline-flex items-center gap-1.5 text-secondary">
                      <span className="material-symbols-outlined text-[15px]">psychology</span>
                      <span>
                        Confidence: <strong className="uppercase">{card.confidence.level}</strong> — {card.confidence.reason}
                      </span>
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => speakText(`${card.title}. ${card.summary}`)}
                        className="hover:text-primary flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[16px]">volume_up</span>
                        <span>{t('oracle.listen')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await copyToClipboard(`${card.title}\n${card.summary}`);
                          pushToast('Answer copied', 'success');
                        }}
                        className="hover:text-primary flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[16px]">content_copy</span>
                        <span>Copy</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveCard(card, msg.id)}
                        className={`flex items-center gap-1 ${isSaved ? 'text-primary font-bold' : 'hover:text-primary'}`}
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          {isSaved ? 'bookmark' : 'bookmark_border'}
                        </span>
                        <span>{isSaved ? t('oracle.saved') : t('oracle.save')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleShareCard(card)}
                        className="hover:text-primary flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[16px]">share</span>
                        <span>{t('oracle.share')}</span>
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <p className="font-body-md text-body-md text-on-surface">{msg.text}</p>
              )}
            </article>
          );
        })}

        {loadingPhase && (
          <div className="p-4 rounded-2xl bg-surface-container-high animate-pulse flex items-center gap-3">
            <span className="material-symbols-outlined animate-spin text-primary">cyclone</span>
            <span className="font-label-md text-primary">
              {loadingPhase === 'analyzing_air' ? 'Reading live air & forecast...' : 'Synthesizing evidence-based protocol...'}
            </span>
          </div>
        )}

        {chatError && (
          <div className="p-4 rounded-2xl bg-error-container/30 border border-error/40 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-on-error-container">
              <strong className="block text-error">Oracle Connection Error</strong>
              <span>{chatError.message}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => sendQuestion(chatError.lastQuestion, undefined, { skipAppendUser: true })}
                className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-bold"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => navigate('/settings')}
                className="px-3 py-1.5 rounded-lg bg-surface-container-high text-on-surface text-xs font-semibold"
              >
                Check APIs
              </button>
            </div>
          </div>
        )}
        <div ref={streamEndRef} />
      </div>

      {/* Suggested Proactive Measures */}
      <section className="space-y-2">
        <div className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
          Suggested Proactive Measures
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigate('/route')}
            className="px-3.5 py-2 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md flex items-center gap-2 transition"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-secondary text-[16px]">alt_route</span>
            <span>Show me local low-emission walking corridors</span>
          </button>
          <button
            type="button"
            onClick={handleWindAlert}
            className={`px-3.5 py-2 rounded-xl font-label-md text-label-md flex items-center gap-2 transition ${windAlertSubscribed
              ? 'bg-secondary/20 text-secondary'
              : 'bg-surface-container hover:bg-surface-container-high text-on-surface'
              }`}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-primary text-[16px]">airwave</span>
            <span>
              {windAlertSubscribed ? 'Wind dispersion alert active' : 'Notify me when wind dispersion begins'}
            </span>
          </button>
          {followUpSuggestions.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => sendQuestion(q)}
              className="px-3.5 py-2 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md transition"
            >
              {q}
            </button>
          ))}
        </div>
      </section>

      {/* Sticky Composer */}
      <form
        data-tour="oracle-composer"
        onSubmit={(e) => {
          e.preventDefault();
          sendQuestion(input);
        }}
        className="sticky bottom-16 lg:bottom-4 z-20 rounded-2xl bg-surface-container-high/95 backdrop-blur-2xl p-3 shadow-2xl gilded-rim space-y-2"
      >
        <div className="flex items-center gap-2 px-1">
          <span className="material-symbols-outlined text-primary text-[20px]">smart_toy</span>
          <label htmlFor="oracle-prompt-input" className="sr-only">
            Ask the Smog Oracle
          </label>
          <input
            id="oracle-prompt-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('oracle.placeholder')}
            className="w-full bg-transparent text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none"
          />
        </div>
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleDictate}
              aria-label="Voice dictation"
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${listeningLocal ? 'bg-secondary text-on-secondary animate-pulse' : 'bg-surface-container hover:bg-surface-variant text-on-surface'
                }`}
            >
              <span className="material-symbols-outlined text-[18px]">
                {listeningLocal ? 'graphic_eq' : 'mic'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => scanInputRef.current?.click()}
              aria-label="Scan room, stove, filter, or mask photo"
              className="w-9 h-9 rounded-xl bg-surface-container hover:bg-surface-variant text-on-surface flex items-center justify-center transition"
            >
              <span className="material-symbols-outlined text-[18px]">document_scanner</span>
            </button>
            <input
              ref={scanInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleScanFile}
              className="hidden"
            />
            <span className="text-xs text-on-surface-variant hidden sm:inline">Room / Filter Scan</span>
          </div>
          <button
            type="submit"
            disabled={!input.trim() || Boolean(loadingPhase)}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-primary to-primary-container text-on-primary-container font-label-lg font-bold flex items-center gap-1.5 shadow-lg disabled:opacity-50"
          >
            <span>{t('oracle.askBtn')}</span>
            <span className="material-symbols-outlined text-[18px]">send</span>
          </button>
        </div>
      </form>

      {/* Answer Style Modal */}
      <ModalDialog open={filterOpen} onClose={() => setFilterOpen(false)} title="Oracle Answer Preferences">
        <div className="space-y-4">
          <div>
            <div className="font-label-md text-on-surface-variant mb-1.5">Response Length</div>
            <div className="grid grid-cols-2 gap-2">
              {(['short', 'detailed'] as const).map((len) => (
                <button
                  key={len}
                  type="button"
                  onClick={() => setOracleStyle({ length: len })}
                  className={`py-2 rounded-xl font-label-md capitalize ${oracleStyle.length === len ? 'bg-primary text-on-primary font-bold' : 'bg-surface-container text-on-surface'
                    }`}
                >
                  {len}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="oracle-budget-cap" className="block font-label-md text-on-surface-variant mb-1">
              Budget Cap Preference
            </label>
            <input
              id="oracle-budget-cap"
              type="text"
              value={oracleStyle.budgetCap}
              onChange={(e) => setOracleStyle({ budgetCap: e.target.value })}
              placeholder="e.g. under ₹1500 or free"
              className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
            />
          </div>

          <label className="flex items-center justify-between p-3 rounded-xl bg-surface-container cursor-pointer">
            <span>Kid-friendly language & safety focus</span>
            <input
              type="checkbox"
              checked={oracleStyle.kidFriendly}
              onChange={(e) => setOracleStyle({ kidFriendly: e.target.checked })}
              className="w-4 h-4 accent-amber-500"
            />
          </label>
          <label className="flex items-center justify-between p-3 rounded-xl bg-surface-container cursor-pointer">
            <span>Elderly / COPD gentle pacing</span>
            <input
              type="checkbox"
              checked={oracleStyle.elderlyFriendly}
              onChange={(e) => setOracleStyle({ elderlyFriendly: e.target.checked })}
              className="w-4 h-4 accent-amber-500"
            />
          </label>
        </div>
      </ModalDialog>

      <ShareModal
        open={Boolean(shareTarget)}
        onClose={() => setShareTarget(null)}
        title={shareTarget?.title || 'Aetheria Oracle'}
        text={shareTarget?.text || ''}
      />
    </div>
  );
};
