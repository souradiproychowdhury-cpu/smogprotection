import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { enableNotificationsAndPush, showLocalNotification } from '../lib/notifications';
import { buildMailtoLink, buildSmsLink, buildWhatsAppLink, copyToClipboard } from '../lib/share';
import { useAppStore } from '../store/useAppStore';
import { useTranslation } from '../i18n/useTranslation';

export const AlertPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const air = useAppStore((s) => s.air);
  const profile = useAppStore((s) => s.profile);
  const language = useAppStore((s) => s.language);
  const deviceId = useAppStore((s) => s.deviceId);
  const vapidPublicKey = useAppStore((s) => s.vapidPublicKey);
  const dependents = useAppStore((s) => s.dependents);
  const activeDependentId = useAppStore((s) => s.activeDependentId);
  const alertChecklist = useAppStore((s) => s.alertChecklist);
  const toggleAlertChecklist = useAppStore((s) => s.toggleAlertChecklist);
  const pushToast = useAppStore((s) => s.pushToast);

  const activeDep = dependents.find((d) => d.id === activeDependentId) || dependents[0];

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [logs, setLogs] = useState<Array<{ id: number; recipient: string; channel: string; createdAt: string }>>([]);

  const buildLocalFallbackDraft = () => {
    const school = profile.schoolName || 'Local School';
    const dep = activeDep?.name || 'Child';
    const loc = air?.locationName || profile.location?.name || 'our area';
    const aqiVal = air?.aqi ?? '--';
    const pmVal = air?.pm25 ?? '--';
    setSubject(`Air Quality Advisory for ${dep} — ${school} (AQI ${aqiVal})`);
    setBody(
      `Hello ${school} Team,\n\nAir quality monitoring for ${loc} shows US AQI ${aqiVal} (PM2.5: ${pmVal} µg/m³${air?.inversionDetected ? ', thermal inversion trapping surface smog' : ''}).\n\nFor ${dep}'s respiratory safety, please:\n1. Keep recess and PE classes indoors today.\n2. Keep classroom windows closed and air filtration active if available.\n3. Keep ${dep}'s prescribed spacer/reliever accessible and remind them to wear their N95/FFP2 mask at dismissal.\n\nThank you for helping keep students safe.\nSent via Aetheria Clean-Air Assistant`
    );
  };

  const draftMessage = async () => {
    if (!air) {
      buildLocalFallbackDraft();
      return;
    }
    setDrafting(true);
    try {
      const res = await api.generateAlertMessage({
        language: language.englishName || language.nativeName,
        schoolName: profile.schoolName || 'Local School',
        dependentName: activeDep?.name || 'Child',
        lat: air.lat,
        lon: air.lon,
        locationName: air.locationName
      });
      setSubject(res.data.subject);
      setBody(res.data.body);
    } catch {
      buildLocalFallbackDraft();
      pushToast('Using offline alert draft', 'info');
    } finally {
      setDrafting(false);
    }
  };

  useEffect(() => {
    draftMessage();
    api.getAlertLogs(deviceId).then((r) => setLogs(r.logs)).catch(() => undefined);
  }, [air?.locationName, language.code]);

  const recordDispatch = async (channel: string) => {
    try {
      await api.logAlert({
        deviceId,
        area: air?.locationName || 'Local Area',
        recipient: profile.schoolName || 'School & Caregivers',
        channel,
        messageBody: `${subject}\n${body}`
      });
      const updated = await api.getAlertLogs(deviceId);
      setLogs(updated.logs);
      pushToast(`Logged dispatch via ${channel}`, 'success');
    } catch {
      pushToast(`Opened ${channel} share`, 'info');
    }
  };

  const handleEnablePush = async () => {
    const res = await enableNotificationsAndPush({
      deviceId,
      area: air?.locationName || 'Local Area',
      alertType: 'inversion',
      vapidPublicKey
    });
    pushToast(res.message, res.ok ? 'success' : 'error');
  };

  const handleTestNotification = async () => {
    const localShown = showLocalNotification(
      'Aetheria Inversion Alert Test',
      `Live AQI in ${air?.locationName || 'your area'}: ${air?.aqi ?? '--'} (Boundary layer ${air?.boundaryLayerHeight ?? '--'}m).`
    );
    const pushRes = await api
      .pushTest(deviceId, 'Aetheria Inversion Alert', `AQI ${air?.aqi ?? '--'} in ${air?.locationName || 'your area'}`)
      .catch(() => ({ sent: 0, mode: 'local' }));
    pushToast(
      localShown || pushRes.sent > 0
        ? 'Test notification triggered!'
        : 'Enable notification permission above to view system popups.',
      localShown || pushRes.sent > 0 ? 'success' : 'info'
    );
  };

  const fullMessage = `${subject}\n\n${body}`;

  return (
    <div className="space-y-6">
      {/* Live Inversion Banner */}
      <section
        className={`rounded-2xl p-5 shadow-xl space-y-3 border ${
          air?.inversionDetected
            ? 'bg-error-container/30 border-error/50'
            : 'bg-surface-container-high border-primary/30'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="font-label-sm uppercase tracking-widest text-primary font-bold">
            Aetheria Atmospheric Watch
          </span>
          <span
            className={`px-2.5 py-0.5 rounded-full font-label-sm font-bold uppercase ${
              air?.inversionDetected ? 'bg-error text-on-error' : 'bg-secondary/20 text-secondary'
            }`}
          >
            {air?.inversionDetected ? 'Inversion Active' : 'Normal Dispersion'}
          </span>
        </div>
        <h1 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
          {air?.inversionDetected
            ? `Thermal Inversion Trapping Ground Smog in ${air.locationName}`
            : `Inversion Watch & School Protocol — ${air?.locationName || 'Your Area'}`}
        </h1>
        <p className="font-body-sm text-on-surface-variant">{air?.inversionReason || 'Monitoring boundary-layer height and wind shear.'}</p>
      </section>

      {/* Thermal Inversion Physics + Animated Diagram */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section
          data-tour="alert-physics"
          className="lg:col-span-6 rounded-2xl bg-surface-container p-5 shadow-xl space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
              {t('alert.title')}
            </h2>
            <span className="px-2.5 py-1 rounded-full bg-surface-container-highest text-xs text-on-surface-variant">
              BLH: {air?.boundaryLayerHeight ?? '--'} m
            </span>
          </div>

          <div className="relative h-48 rounded-xl bg-surface-container-lowest p-3 flex flex-col justify-between overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-surface-container-high/70">
              <span className="font-label-sm text-primary font-semibold">
                WARM AIR LID ({air?.boundaryLayerHeight !== undefined ? `${air.boundaryLayerHeight}m` : '--'} Cap)
              </span>
              <span className="font-label-sm text-primary">Stops Rising Smoke</span>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center relative">
              <svg className="w-full h-20" viewBox="0 0 320 64" fill="none">
                <path
                  d="M10 12 Q80 22 160 12 T310 12"
                  stroke="#ffb4ab"
                  strokeDasharray="5 4"
                  strokeWidth="2"
                  className="animate-pulse"
                />
                <circle cx="50" cy="44" r="4" fill="#f59e0b" className="animate-pulse" />
                <circle cx="110" cy="38" r="5" fill="#ffb4ab" className="animate-pulse" />
                <circle cx="170" cy="46" r="4" fill="#f59e0b" className="animate-pulse" />
                <circle cx="235" cy="40" r="5" fill="#ffb4ab" className="animate-pulse" />
                <circle cx="285" cy="45" r="3.5" fill="#f59e0b" className="animate-pulse" />
              </svg>
              <span className="font-label-sm text-[10px] text-error font-bold tracking-wider uppercase text-center">
                Cool Ground Air Traps Vehicle & Hearth PM2.5 Below Lid
              </span>
            </div>

            <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-surface-container-high/80">
              <span className="font-label-sm text-tertiary font-semibold">
                GROUND LEVEL ({air?.temperature ?? '--'}°C · Wind {air?.windSpeed ?? '--'} m/s)
              </span>
              <span className="font-label-sm text-error font-bold">PM2.5: {air?.pm25 ?? '--'} µg/m³</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="p-3 rounded-xl bg-surface-container-high">
              <div className="text-[10px] text-on-surface-variant uppercase">Ground PM2.5</div>
              <div className="font-headline-sm font-bold text-error">{air?.pm25 ?? '--'}</div>
              <div className="text-xs text-on-surface-variant">µg/m³</div>
            </div>
            <div className="p-3 rounded-xl bg-surface-container-high">
              <div className="text-[10px] text-on-surface-variant uppercase">Wind Speed</div>
              <div className="font-headline-sm font-bold text-primary">{air?.windSpeed ?? '--'}</div>
              <div className="text-xs text-on-surface-variant">m/s</div>
            </div>
            <div className="p-3 rounded-xl bg-surface-container-high">
              <div className="text-[10px] text-on-surface-variant uppercase">Mixing Height</div>
              <div className="font-headline-sm font-bold text-tertiary">{air?.boundaryLayerHeight ?? '--'}</div>
              <div className="text-xs text-on-surface-variant">meters</div>
            </div>
          </div>
        </section>

        {/* Midday Protocol Checklist + Push Controls */}
        <section className="lg:col-span-6 space-y-4">
          <div className="rounded-2xl bg-surface-container p-5 shadow-xl space-y-3">
            <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
              {t('alert.checklistTitle')}
            </h2>
            <div className="space-y-2">
              {alertChecklist.map((item) => (
                <label
                  key={item.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-container-high cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={() => {
                        toggleAlertChecklist(item.id);
                        pushToast('School checklist updated', 'success');
                      }}
                      className="w-5 h-5 accent-emerald-400"
                    />
                    <div>
                      <div className={`font-label-md font-semibold ${item.checked ? 'line-through opacity-70' : 'text-on-surface'}`}>
                        {item.title}
                      </div>
                      <div className="text-xs text-on-surface-variant">{item.subtitle}</div>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-primary text-[20px]">{item.icon}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-surface-container p-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-label-md font-semibold text-on-surface">Push & Local Alerts</div>
              <div className="text-xs text-on-surface-variant">Get notified when inversion or high AQI strikes</div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleEnablePush}
                className="px-3.5 py-2 rounded-xl bg-secondary-container text-on-secondary-container font-label-sm font-bold"
              >
                Enable Push Alerts
              </button>
              <button
                type="button"
                onClick={handleTestNotification}
                className="px-3.5 py-2 rounded-xl bg-surface-container-high hover:bg-surface-bright text-primary font-label-sm font-semibold"
              >
                Test Alert
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* AI Message Composer & Dispatch */}
      <section className="rounded-2xl bg-surface-container p-5 shadow-xl space-y-4 gilded-rim">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-label-sm uppercase tracking-widest text-secondary font-bold">
              Multilingual AI Composer ({language.nativeName})
            </span>
            <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
              {t('alert.composerTitle')}
            </h2>
          </div>
          <button
            type="button"
            onClick={draftMessage}
            disabled={drafting}
            className="px-3 py-1.5 rounded-xl bg-surface-container-high text-primary font-label-sm font-bold flex items-center gap-1"
          >
            <span className={`material-symbols-outlined text-[16px] ${drafting ? 'animate-spin' : ''}`}>auto_awesome</span>
            <span>{drafting ? 'Drafting...' : 'Regenerate Draft'}</span>
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="alert-subject" className="block text-xs text-on-surface-variant mb-1">Subject</label>
            <input
              id="alert-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
            />
          </div>
          <div>
            <label htmlFor="alert-body" className="block text-xs text-on-surface-variant mb-1">Editable Message</label>
            <textarea
              id="alert-body"
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <a
            href={buildWhatsAppLink(fullMessage)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => recordDispatch('WhatsApp')}
            className="min-h-[44px] px-3 py-2.5 rounded-xl bg-gradient-to-r from-primary-container to-primary text-on-primary-container font-label-md font-bold flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">send</span>
            <span>WhatsApp</span>
          </a>
          <a
            href={buildSmsLink(fullMessage, profile.schoolPhone)}
            onClick={() => recordDispatch('SMS')}
            className="min-h-[44px] px-3 py-2.5 rounded-xl bg-secondary-container text-on-secondary-container font-label-md font-bold flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">sms</span>
            <span>SMS</span>
          </a>
          <a
            href={buildMailtoLink(subject, body)}
            onClick={() => recordDispatch('Email')}
            className="min-h-[44px] px-3 py-2.5 rounded-xl bg-surface-container-high hover:bg-surface-bright text-on-surface font-label-md font-semibold flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">mail</span>
            <span>Email</span>
          </a>
          <button
            type="button"
            onClick={async () => {
              await copyToClipboard(fullMessage);
              await recordDispatch('Clipboard');
            }}
            className="min-h-[44px] px-3 py-2.5 rounded-xl bg-surface-container-high hover:bg-surface-bright text-primary font-label-md font-semibold flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">content_copy</span>
            <span>Copy</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-outline-variant/25">
          {profile.schoolPhone ? (
            <a
              href={`tel:${profile.schoolPhone}`}
              className="px-4 py-2 rounded-xl bg-surface-container-high text-secondary font-label-md font-semibold flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[18px]">call</span>
              <span>Call {profile.schoolName}</span>
            </a>
          ) : (
            <span className="text-xs text-on-surface-variant">
              Tip: Add your school phone in Profile to enable 1-tap calling.
            </span>
          )}
          <button
            type="button"
            onClick={() => navigate('/route')}
            className="text-sm text-primary hover:underline flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[18px]">alt_route</span>
            <span>Plan Clean-Air Pickup Corridor</span>
          </button>
        </div>

        {logs.length > 0 && (
          <div className="pt-3 border-t border-outline-variant/25 space-y-1.5">
            <div className="font-label-sm uppercase text-on-surface-variant">Sent Alerts Log</div>
            {logs.slice(0, 5).map((l) => (
              <div key={l.id} className="text-xs text-on-surface-variant flex justify-between">
                <span>{l.recipient} via {l.channel}</span>
                <span>{new Date(l.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
