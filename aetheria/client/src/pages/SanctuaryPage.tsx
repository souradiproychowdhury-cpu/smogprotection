import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import {
  calculateDailyImpactSummary,
  mapUsAqiToSpectrum,
  type ImpactMetricResult
} from '@aetheria/shared';
import { AtmosphericShader } from '../components/AtmosphericShader';
import { ImpactFormulaDialog } from '../components/ImpactFormulaDialog';
import { ErrorRetryCard, GlassSkeleton } from '../components/LoadingSkeleton';
import { ShareModal } from '../components/ShareModal';
import { enableNotificationsAndPush, scheduleLocalReminder, showLocalNotification } from '../lib/notifications';
import { tryNativeShare } from '../lib/share';
import { useAppStore } from '../store/useAppStore';
import { useTranslation } from '../i18n/useTranslation';

interface SanctuaryPageProps {
  onRefreshAir: () => void;
  onRegenerateRoutine: () => void;
  onOpenLocation: () => void;
  routineLoading: boolean;
}

export const SanctuaryPage: React.FC<SanctuaryPageProps> = ({
  onRefreshAir,
  onRegenerateRoutine,
  onOpenLocation,
  routineLoading
}) => {
  const navigate = useNavigate();
  const { t, formatNumber, formatTime } = useTranslation();

  const air = useAppStore((s) => s.air);
  const airLoading = useAppStore((s) => s.airLoading);
  const airError = useAppStore((s) => s.airError);
  const profile = useAppStore((s) => s.profile);
  const updateProfile = useAppStore((s) => s.updateProfile);
  const routine = useAppStore((s) => s.routine);
  const completedRoutineByDate = useAppStore((s) => s.completedRoutineByDate);
  const toggleRoutineItem = useAppStore((s) => s.toggleRoutineItem);
  const vaultChecklist = useAppStore((s) => s.vaultChecklist);
  const deviceId = useAppStore((s) => s.deviceId);
  const vapidPublicKey = useAppStore((s) => s.vapidPublicKey);
  const pushToast = useAppStore((s) => s.pushToast);

  const [selectedFormula, setSelectedFormula] = useState<{ label: string; result: ImpactMetricResult } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const todayKey = new Date().toISOString().slice(0, 10);
  const completedIds = completedRoutineByDate[todayKey] || [];
  const completedChecklistCount = vaultChecklist.filter((c) => c.checked).length;

  const cat = mapUsAqiToSpectrum(air?.aqi ?? 0);

  const impact = useMemo(
    () =>
      air
        ? calculateDailyImpactSummary({
            outdoorPm25: air.pm25,
            windowsSealed: profile.windowsSealed,
            purifierRunning: profile.purifierRunning,
            purifierType: profile.purifierType,
            fuel: profile.fuel,
            transport: profile.transport,
            completedRoutineCount: completedIds.length,
            completedChecklistCount,
            currency: profile.currency
          })
        : null,
    [
      air,
      profile.windowsSealed,
      profile.purifierRunning,
      profile.purifierType,
      profile.fuel,
      profile.transport,
      completedIds.length,
      completedChecklistCount,
      profile.currency
    ]
  );

  // Dial SVG arc stroke offset (circumference ~ 540 for r=86)
  const dialRatio = air ? Math.min(1, Math.max(0.08, air.aqi / 300)) : 0.08;
  const strokeDashoffset = Math.round(540 * (1 - dialRatio));

  const shareSummaryText = useMemo(() => {
    const routineLines = (routine?.items || [])
      .map((item) => `• ${item.time}: ${item.title} (${item.impactChip})`)
      .join('\n');
    return `Aetheria Clean-Air Sanctuary (${air?.locationName || 'My City'})\nLive US AQI: ${air?.aqi ?? '--'} (${cat.label}) · PM2.5: ${air?.pm25 ?? '--'} µg/m³\nIndoor Est. PM2.5: ${impact ? `${impact.indoorPm25.value} µg/m³ (-${impact.reductionPercent.value}%)` : '--'}\n\nToday's Routine:\n${routineLines}`;
  }, [air, cat.label, impact, routine?.items]);

  const handleRemindVentilation = async () => {
    const res = await enableNotificationsAndPush({
      deviceId,
      area: air?.locationName || 'Local Area',
      alertType: 'ventilation',
      vapidPublicKey
    });
    const winLabel = routine?.bestVentilationWindow
      ? `${routine.bestVentilationWindow.startLabel}–${routine.bestVentilationWindow.endLabel}`
      : 'next clean-air dip';
    const mins = routine?.bestVentilationWindow?.minutesUntilChange ?? 15;
    const delayMs = mins > 0 ? mins * 60 * 1000 : 15000;
    scheduleLocalReminder(
      'Aetheria Ventilation Window',
      `Best time to ventilate (${winLabel}) is now in ${air?.locationName || 'your area'}.`,
      delayMs
    );
    showLocalNotification('Ventilation Reminder Armed', `Scheduled for ${winLabel} (in ~${mins} min).`);
    pushToast(res.ok ? `Reminder armed for ${winLabel}` : res.message, res.ok ? 'success' : 'info');
  };

  const handleShareRoutine = async () => {
    const result = await tryNativeShare({
      title: 'My Aetheria Clean-Air Routine',
      text: shareSummaryText
    });
    if (result === 'fallback') {
      setShareOpen(true);
    } else {
      pushToast('Routine shared', 'success');
    }
  };

  return (
    <div className="relative space-y-6">
      {/* Ambient WebGL Atmospheric Shader Backdrop */}
      <div className="relative rounded-3xl overflow-hidden gilded-rim">
        <div className="absolute inset-0 h-full opacity-55 pointer-events-none">
          <AtmosphericShader />
        </div>

        <div className="relative z-10 p-4 sm:p-6 space-y-5">
          {/* Top Geolocation & Protocol Status Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2" data-tour="location-bar">
            <button
              type="button"
              onClick={onOpenLocation}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-high/85 hover:bg-surface-bright transition text-left"
            >
              <span className="material-symbols-outlined text-primary text-[18px]">location_on</span>
              <span className="font-label-md text-label-md text-on-surface uppercase tracking-wide">
                {profile.location?.name || air?.locationName || 'Set Location'}
              </span>
              <span className="material-symbols-outlined text-on-surface-variant text-[16px]">edit</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onRefreshAir}
                disabled={airLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-high/90 hover:bg-surface-bright text-primary font-label-sm text-label-sm uppercase tracking-wider transition disabled:opacity-60"
              >
                <span className={`material-symbols-outlined text-[15px] ${airLoading ? 'animate-spin' : ''}`}>
                  refresh
                </span>
                <span>{airLoading ? 'Syncing...' : t('sanctuary.refresh')}</span>
              </button>
            </div>
          </div>

          {airError && <ErrorRetryCard message={airError} onRetry={onRefreshAir} />}

          {/* Desktop 12-col split: AQI Crown Dial + Ventilation & Controls */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
            {/* Hero Real-Time Air Quality Sphere */}
            <section
              data-tour="aqi-dial"
              className="lg:col-span-6 relative flex flex-col items-center justify-center p-6 rounded-2xl bg-surface-container/75 backdrop-blur-2xl shadow-xl overflow-hidden"
            >
              <div
                className="absolute -top-12 inset-x-12 h-40 rounded-full blur-3xl opacity-20 pointer-events-none"
                style={{ backgroundColor: cat.haloColor }}
              />

              {airLoading && !air ? (
                <GlassSkeleton lines={4} className="w-full" />
              ) : (
                <>
                  <div className="relative w-56 h-56 flex items-center justify-center">
                    <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 200 200">
                      <circle
                        cx="100"
                        cy="100"
                        r="86"
                        fill="none"
                        stroke="rgba(216, 195, 173, 0.14)"
                        strokeDasharray="2 6"
                        strokeWidth="4"
                      />
                      <circle
                        cx="100"
                        cy="100"
                        r="86"
                        fill="none"
                        stroke={cat.color}
                        strokeDasharray="540"
                        strokeDashoffset={strokeDashoffset}
                        strokeLinecap="round"
                        strokeWidth="6"
                      />
                      <circle
                        cx="100"
                        cy="100"
                        r="74"
                        fill="none"
                        stroke="rgba(104, 219, 169, 0.28)"
                        strokeDasharray="1 8"
                        strokeWidth="1.5"
                      />
                    </svg>

                    <div className="w-40 h-40 rounded-full bg-surface-container-lowest/85 backdrop-blur-md flex flex-col items-center justify-center text-center shadow-inner px-2">
                      <span className="font-label-sm text-label-sm uppercase tracking-widest text-on-surface-variant">
                        {t('sanctuary.ambientAqi')}
                      </span>
                      <div className="font-display-lg-mobile text-display-lg-mobile font-bold tracking-tight my-0.5" style={{ color: cat.textColor }}>
                        {air ? formatNumber(air.aqi) : '--'}
                      </div>
                      <div className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-surface-container-high/90">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cat.color }} />
                        <span className="font-label-sm text-label-sm font-semibold text-on-surface">
                          PM2.5: {air ? `${air.pm25} µg/m³` : '--'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 text-center space-y-1">
                    <div className="font-headline-sm text-headline-sm text-on-surface">
                      Air Status: <span className="italic font-semibold" style={{ color: cat.textColor }}>{cat.accentWord}</span>
                    </div>
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container-high text-xs font-semibold text-primary">
                      <span className="material-symbols-outlined text-[15px]">pulmonology</span>
                      <span>
                        {t('sanctuary.whoMultiple', { mult: air?.whoMultiple ?? 0 })}
                      </span>
                    </div>
                  </div>

                  {/* Micro Telemetry Row */}
                  <div className="grid grid-cols-3 w-full mt-4 gap-2">
                    <div className="flex flex-col items-center p-2.5 rounded-xl bg-surface-container-low/80">
                      <span className="font-label-sm text-label-sm text-on-surface-variant">Indoor Est.</span>
                      <span className="font-label-md text-label-md text-secondary font-bold mt-0.5">
                        {impact ? `${impact.indoorPm25.value} µg/m³` : '--'}
                      </span>
                    </div>
                    <div className="flex flex-col items-center p-2.5 rounded-xl bg-surface-container-low/80">
                      <span className="font-label-sm text-label-sm text-on-surface-variant">Wind</span>
                      <span className="font-label-md text-label-md text-tertiary font-bold mt-0.5">
                        {air
                          ? profile.units === 'imperial'
                            ? `${(air.windSpeed * 2.237).toFixed(1)} mph`
                            : `${air.windSpeed} m/s`
                          : '--'}
                      </span>
                    </div>
                    <div className="flex flex-col items-center p-2.5 rounded-xl bg-surface-container-low/80">
                      <span className="font-label-sm text-label-sm text-on-surface-variant">Inversion</span>
                      <span className={`font-label-md text-label-md font-bold mt-0.5 ${air?.inversionDetected ? 'text-error' : 'text-secondary'}`}>
                        {air?.inversionDetected ? 'Active' : 'Clear'}
                      </span>
                    </div>
                  </div>

                  {air && (
                    <p className="mt-3 text-[11px] text-on-surface-variant text-center">
                      Last updated {formatTime(air.updatedAt)} · {air.source}
                    </p>
                  )}
                </>
              )}
            </section>

            {/* Right Column: Ventilation Window + Sealing/Purifier Toggles + Urgent Inversion Banner */}
            <div className="lg:col-span-6 flex flex-col gap-4 justify-between">
              {/* Ventilation Window Card */}
              <section
                data-tour="ventilation-window"
                className="p-4 rounded-2xl bg-surface-container-high/85 backdrop-blur-xl shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-surface-container-lowest flex items-center justify-center text-primary shrink-0">
                    <span className="material-symbols-outlined text-[22px]">airwave</span>
                  </div>
                  <div>
                    <div className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                      {t('sanctuary.nextVentilation')}
                    </div>
                    <div className="font-body-md text-body-md font-semibold text-on-surface">
                      {routine?.bestVentilationWindow
                        ? `${routine.bestVentilationWindow.startLabel} – ${routine.bestVentilationWindow.endLabel}`
                        : 'Calculating hourly forecast...'}
                    </div>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                      {routine?.bestVentilationWindow?.reason || 'Using live PM2.5 & boundary-layer height.'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRemindVentilation}
                  className="shrink-0 px-3.5 py-2 rounded-xl bg-primary-container text-on-primary-container font-label-md text-label-md font-bold flex items-center justify-center gap-1.5 shadow-sm hover:brightness-110 transition"
                >
                  <span className="material-symbols-outlined text-[16px]">alarm</span>
                  <span>{t('sanctuary.remindMe')}</span>
                </button>
              </section>

              {/* Conditional Inversion Alert Banner (only shown when inversion detected) */}
              {air?.inversionDetected && (
                <section className="p-4 rounded-2xl bg-error-container/35 border border-error/40 flex items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span className="material-symbols-outlined text-error text-[22px] shrink-0 mt-0.5">warning</span>
                    <div>
                      <div className="font-label-md text-label-md font-bold text-error uppercase tracking-wider">
                        Thermal Inversion Detected
                      </div>
                      <p className="font-body-sm text-body-sm text-on-error-container">
                        {air.inversionReason}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/alert')}
                    className="shrink-0 px-3 py-2 rounded-xl bg-error text-on-error font-label-md font-bold"
                  >
                    Open Alert
                  </button>
                </section>
              )}

              {/* Sealing, Purifier & Family Safe Mode Toggles */}
              <section
                data-tour="sealing-toggles"
                className="p-4 rounded-2xl bg-surface-container/80 backdrop-blur-xl space-y-3"
              >
                <div className="font-label-sm text-label-sm uppercase tracking-widest text-primary font-bold">
                  Home Envelope Controls (Live Impact)
                </div>

                {[
                  {
                    id: 'windows-sealed-toggle',
                    label: t('sanctuary.windowsSealed'),
                    sub: 'Lowers outdoor PM2.5 infiltration from ~1.1 to ~0.35 ACH',
                    checked: profile.windowsSealed,
                    onChange: (val: boolean) => {
                      updateProfile({ windowsSealed: val });
                      pushToast(val ? 'Windows marked sealed — indoor estimate updated' : 'Windows unsealed', 'info');
                    }
                  },
                  {
                    id: 'purifier-running-toggle',
                    label: t('sanctuary.purifierRunning'),
                    sub: `Active ${profile.purifierType === 'diyBoxFanMerv13' ? 'DIY MERV-13 Box Fan' : profile.purifierType === 'corsiRosenthalCube' ? 'Corsi-Rosenthal Cube' : 'HEPA Purifier'}`,
                    checked: profile.purifierRunning,
                    onChange: (val: boolean) => {
                      updateProfile({ purifierRunning: val });
                      pushToast(val ? 'Filtration marked active' : 'Filtration paused', 'info');
                    }
                  },
                  {
                    id: 'family-safe-toggle',
                    label: t('sanctuary.familySafeMode'),
                    sub: 'Prioritizes stricter WHO thresholds for infants, seniors & asthma',
                    checked: profile.familySafeMode,
                    onChange: (val: boolean) => {
                      updateProfile({ familySafeMode: val });
                      pushToast(val ? 'Family Safe Mode enabled' : 'Standard mode enabled', 'info');
                    }
                  }
                ].map((toggle) => (
                  <label
                    key={toggle.id}
                    htmlFor={toggle.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-container-low/80 cursor-pointer hover:bg-surface-container-high/70 transition"
                  >
                    <div className="min-w-0">
                      <div className="font-label-lg text-label-lg text-on-surface font-semibold">
                        {toggle.label}
                      </div>
                      <div className="font-body-sm text-body-sm text-on-surface-variant">{toggle.sub}</div>
                    </div>
                    <input
                      id={toggle.id}
                      type="checkbox"
                      checked={toggle.checked}
                      onChange={(e) => toggle.onChange(e.target.checked)}
                      className="w-5 h-5 accent-emerald-400 shrink-0"
                    />
                  </label>
                ))}
              </section>
            </div>
          </div>
        </div>
      </div>


      {/* Desktop 12-col split: Daily Routine Timeline + Direct Personal Impact */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* GenAI Curated Daily Routine */}
        <section data-tour="daily-routine" className="lg:col-span-7 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[22px]">psychology</span>
              <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                {t('sanctuary.routineTitle')}
              </h2>
            </div>
            <button
              type="button"
              onClick={onRegenerateRoutine}
              disabled={routineLoading}
              className="px-3 py-1.5 rounded-full bg-surface-container-high hover:bg-surface-bright text-primary font-label-sm text-label-sm uppercase tracking-wider font-bold flex items-center gap-1 transition disabled:opacity-50"
            >
              <span className={`material-symbols-outlined text-[15px] ${routineLoading ? 'animate-spin' : ''}`}>
                auto_awesome
              </span>
              <span>{routineLoading ? 'Building...' : t('sanctuary.regenerate')}</span>
            </button>
          </div>

          {routineLoading && !routine ? (
            <GlassSkeleton lines={5} />
          ) : (
            <div className="space-y-3">
              {(routine?.items || []).map((item) => {
                const done = completedIds.includes(item.id);
                return (
                  <label
                    key={item.id}
                    className={`flex items-start gap-3 p-4 rounded-2xl backdrop-blur-xl shadow-md cursor-pointer transition border ${
                      done
                        ? 'bg-secondary/10 border-secondary/35'
                        : 'bg-surface-container/75 border-transparent hover:border-primary/25'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={done}
                      onChange={() => {
                        toggleRoutineItem(item.id);
                        pushToast(done ? 'Routine step unchecked' : 'Routine step completed — impact updated!', 'success');
                      }}
                      className="mt-1 w-5 h-5 accent-emerald-400 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-primary text-[18px]">{item.icon}</span>
                          <span className={`font-label-lg text-label-lg font-semibold ${done ? 'line-through text-secondary' : 'text-primary'}`}>
                            {item.title}
                          </span>
                        </div>
                        <span className="font-label-sm text-label-sm text-on-surface-variant font-mono">
                          {item.time}
                        </span>
                      </div>
                      <p className="font-body-md text-body-md text-on-surface leading-snug">{item.reason}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full bg-secondary/15 text-secondary font-label-sm font-medium">
                          {item.impactChip}
                        </span>
                        {item.secondaryChip && (
                          <span className="px-2.5 py-0.5 rounded-full bg-tertiary/15 text-tertiary font-label-sm font-medium">
                            {item.secondaryChip}
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </section>

        {/* Direct Personal Impact Panel + Quick Actions */}
        <div className="lg:col-span-5 space-y-5">
          <section
            data-tour="personal-impact"
            className="relative p-5 rounded-2xl bg-surface-container-high/75 backdrop-blur-2xl shadow-xl gilded-rim space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[22px]">workspace_premium</span>
                <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                  {t('sanctuary.impactTitle')}
                </h2>
              </div>
              <span className="px-2 py-0.5 rounded bg-primary/20 text-primary font-label-sm font-bold uppercase">
                {t('common.estimate')}
              </span>
            </div>

            <p className="font-body-sm text-body-sm text-on-surface-variant">
              {t('sanctuary.impactNote')}
            </p>

            {impact ? (
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { label: 'PM2.5 Exposure Avoided', result: impact.exposureAvoided, color: 'text-secondary' },
                  { label: 'CO₂ Spared Today', result: impact.co2Avoided, color: 'text-primary' },
                  { label: 'Net Daily Savings', result: impact.costDelta, color: 'text-tertiary' },
                  { label: 'Clean Air Hours', result: impact.cleanAirHoursBanked, color: 'text-secondary' }
                ].map((card) => (
                  <button
                    key={card.label}
                    type="button"
                    onClick={() => setSelectedFormula(card)}
                    className="p-3 rounded-xl bg-surface-container-low/90 hover:bg-surface-container text-left transition border border-transparent hover:border-primary/40"
                  >
                    <div className="font-label-sm text-label-sm text-on-surface-variant">{card.label}</div>
                    <div className={`font-headline-sm text-headline-sm font-bold mt-1 ${card.color}`}>
                      {formatNumber(card.result.value)}{' '}
                      <span className="font-body-sm text-body-sm text-on-surface-variant">{card.result.unit}</span>
                    </div>
                    <div className="font-label-sm text-[10px] text-primary mt-1 flex items-center gap-0.5">
                      <span>How calculated</span>
                      <span className="material-symbols-outlined text-[12px]">info</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-surface-container-low/90 text-xs text-on-surface-variant">
                Waiting for live air quality data to compute personal impact estimates...
              </div>
            )}
          </section>

          {/* 12-Hour PM2.5 Forecast Mini-Chart (Recharts) */}
          {air && air.hourly.length > 0 && (
            <section className="p-4 rounded-2xl bg-surface-container/75 backdrop-blur-xl shadow-md space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-label-sm uppercase tracking-widest text-primary font-bold">
                  12-Hour PM2.5 Forecast (µg/m³)
                </span>
                <span className="text-xs text-on-surface-variant">
                  Temp {profile.units === 'imperial' ? `${Math.round(air.temperature * 1.8 + 32)}°F` : `${air.temperature}°C`} · RH {air.humidity}%
                </span>
              </div>
              <div className="h-32 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={air.hourly.slice(0, 12).map((h) => ({
                      hour: formatTime(h.time),
                      pm25: h.pm25
                    }))}
                    margin={{ top: 6, right: 6, left: 6, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="pm25Fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ffc174" stopOpacity={0.55} />
                        <stop offset="95%" stopColor="#ffc174" stopOpacity={0.04} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="hour" tick={{ fill: '#d8c3ad', fontSize: 10 }} axisLine={false} tickLine={false} interval={2} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#151b2b', borderColor: '#534434', borderRadius: '0.75rem', fontSize: '12px' }}
                      labelStyle={{ color: '#ffc174' }}
                    />
                    <Area type="monotone" dataKey="pm25" stroke="#ffc174" strokeWidth={2} fill="url(#pm25Fill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* Quick Imperial Actions */}
          <section className="space-y-2.5">
            <button
              type="button"
              onClick={() =>
                navigate('/oracle', {
                  state: {
                    sanctuaryContext: air
                      ? `Current status in ${air.locationName}: US AQI ${air.aqi} (${cat.label}), PM2.5 ${air.pm25} µg/m³, windows ${profile.windowsSealed ? 'sealed' : 'open'}, purifier ${profile.purifierRunning ? 'on' : 'off'}.`
                      : undefined
                  }
                })
              }
              className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-primary-container via-primary to-primary-fixed text-on-primary-container font-label-lg text-label-lg font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg hover:brightness-105 transition"
            >
              <span className="material-symbols-outlined text-[20px]">auto_awesome</span>
              <span>{t('sanctuary.summonOracle')}</span>
            </button>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => navigate('/health')}
                className="py-3 px-3 rounded-xl bg-surface-container-high hover:bg-surface-bright text-on-surface font-label-md font-semibold flex items-center justify-center gap-1.5 transition"
              >
                <span className="material-symbols-outlined text-[18px] text-error">health_and_safety</span>
                <span>{t('sanctuary.openHealth')}</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/route')}
                className="py-3 px-3 rounded-xl bg-surface-container-high hover:bg-surface-bright text-on-surface font-label-md font-semibold flex items-center justify-center gap-1.5 transition"
              >
                <span className="material-symbols-outlined text-[18px] text-secondary">alt_route</span>
                <span>{t('sanctuary.openRoute')}</span>
              </button>
              {air?.inversionDetected && (
                <button
                  type="button"
                  onClick={() => navigate('/alert')}
                  className="py-3 px-3 rounded-xl bg-surface-container-high hover:bg-surface-bright text-on-surface font-label-md font-semibold flex items-center justify-center gap-1.5 transition"
                >
                  <span className="material-symbols-outlined text-[18px] text-primary">notifications_active</span>
                  <span>{t('sanctuary.openAlert')}</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleShareRoutine}
                className={`py-3 px-3 rounded-xl bg-surface-container-high hover:bg-surface-bright text-on-surface font-label-md font-semibold flex items-center justify-center gap-1.5 transition ${
                  !air?.inversionDetected ? 'col-span-2' : ''
                }`}
              >
                <span className="material-symbols-outlined text-[18px] text-tertiary">share</span>
                <span>{t('sanctuary.shareRoutine')}</span>
              </button>
            </div>
          </section>
        </div>
      </div>

      <ImpactFormulaDialog metric={selectedFormula} onClose={() => setSelectedFormula(null)} />
      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title="My Aetheria Clean-Air Routine"
        text={shareSummaryText}
      />
    </div>
  );
};
