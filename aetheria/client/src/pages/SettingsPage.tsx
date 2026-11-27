import React, { useEffect, useState } from 'react';
import { GlassSkeleton } from '../components/LoadingSkeleton';
import { ModalDialog } from '../components/ModalDialog';
import { api, type ApiVerifyResponse, type HealthApiResponse } from '../lib/api';
import { idbClearAll } from '../lib/idb';
import { enableNotificationsAndPush, showLocalNotification } from '../lib/notifications';
import { useAppStore } from '../store/useAppStore';

interface SettingsPageProps {
  onOpenProfile: () => void;
  onOpenLanguage: () => void;
  onOpenLocation: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  onOpenProfile,
  onOpenLanguage,
  onOpenLocation
}) => {
  const a11y = useAppStore((s) => s.a11y);
  const setA11y = useAppStore((s) => s.setA11y);
  const language = useAppStore((s) => s.language);
  const profile = useAppStore((s) => s.profile);
  const updateProfile = useAppStore((s) => s.updateProfile);
  const deviceId = useAppStore((s) => s.deviceId);
  const vapidPublicKey = useAppStore((s) => s.vapidPublicKey);
  const resetAllData = useAppStore((s) => s.resetAllData);
  const pushToast = useAppStore((s) => s.pushToast);

  const [health, setHealth] = useState<HealthApiResponse | null>(null);
  const [verifyRes, setVerifyRes] = useState<ApiVerifyResponse | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  const runLiveVerify = async () => {
    setVerifying(true);
    try {
      const res = await api.verifyHealth();
      setVerifyRes(res);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Live service check failed', 'error');
    } finally {
      setVerifying(false);
    }
  };

  const checkHealth = async () => {
    try {
      const res = await api.health();
      setHealth(res);
    } catch {
      // Background health check silent fallback
    }
  };

  useEffect(() => {
    checkHealth();
    runLiveVerify();
  }, []);

  const handleEnablePush = async () => {
    const res = await enableNotificationsAndPush({
      deviceId,
      area: profile.location?.name || 'Local Area',
      alertType: 'inversion',
      vapidPublicKey: health?.vapidPublicKey || vapidPublicKey
    });
    updateProfile({ notificationsEnabled: res.ok });
    pushToast(res.message, res.ok ? 'success' : 'error');
  };

  const handleTestNotification = async () => {
    const localShown = showLocalNotification(
      'Aetheria Clean-Air Alert Test',
      `Notifications are active for ${profile.location?.name || 'your location'}.`
    );
    const pushRes = await api
      .pushTest(deviceId, 'Aetheria Clean-Air Test', 'Smog & thermal inversion notifications are active.')
      .catch(() => ({ sent: 0, mode: 'local' }));
    pushToast(
      localShown || pushRes.sent > 0
        ? 'Test notification sent!'
        : 'Enable notification permission first to see system alerts.',
      localShown || pushRes.sent > 0 ? 'success' : 'info'
    );
  };

  const handleExportProfile = () => {
    const data = JSON.stringify({ profile, language, a11y, exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aetheria-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast('Settings & profile exported', 'success');
  };

  const handleConfirmReset = async () => {
    await idbClearAll();
    resetAllData();
    setConfirmResetOpen(false);
    pushToast('All local data cleared', 'info');
  };

  const allChecksOk = Boolean(verifyRes && verifyRes.checks.length > 0 && verifyRes.checks.every((c) => c.ok));
  const currentTheme = a11y.theme ?? 'dark';

  return (
    <div className="space-y-6">
      {/* Location, Language, Household & Units */}
      <section className="rounded-2xl bg-surface-container-high p-4 sm:p-5 shadow-xl space-y-4 gilded-rim">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-label-sm uppercase tracking-widest text-primary font-bold">
              Personal Sanctuary Preferences
            </span>
            <h1 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
              Location, Language &amp; Household Settings
            </h1>
          </div>
          <button
            type="button"
            onClick={onOpenProfile}
            className="px-3.5 py-2 rounded-xl bg-primary text-on-primary font-label-md font-bold flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">tune</span>
            <span>Open Full Household Profile</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="p-3.5 rounded-xl bg-surface-container-low flex items-center justify-between gap-3 border border-outline-variant/25">
            <div className="min-w-0">
              <div className="font-label-sm text-on-surface-variant uppercase">Active Location</div>
              <div className="font-body-md font-semibold text-on-surface truncate">
                {profile.location?.name || 'Not set'}
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenLocation}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-bright text-primary font-label-sm font-bold"
            >
              Change
            </button>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-container-low flex items-center justify-between gap-3 border border-outline-variant/25">
            <div className="min-w-0">
              <div className="font-label-sm text-on-surface-variant uppercase">App &amp; Voice Language</div>
              <div className="font-body-md font-semibold text-on-surface truncate">
                {language.nativeName} ({language.englishName})
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenLanguage}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-bright text-primary font-label-sm font-bold"
            >
              Switch
            </button>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-container-low flex items-center justify-between gap-3 border border-outline-variant/25 sm:col-span-2 lg:col-span-1">
            <div className="min-w-0">
              <div className="font-label-sm text-on-surface-variant uppercase">Home &amp; Commute</div>
              <div className="font-body-sm font-semibold text-on-surface truncate capitalize">
                {profile.homeType} · {profile.fuel.toUpperCase()} · {profile.transport}
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenProfile}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-bright text-secondary font-label-sm font-bold"
            >
              Edit
            </button>
          </div>
        </div>

        {/* Units & Currency */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3.5 rounded-xl bg-surface-container-low flex flex-wrap items-center justify-between gap-3 border border-outline-variant/25 min-w-0">
            <div className="min-w-0">
              <div className="font-label-md font-semibold text-on-surface">Measurement Units</div>
              <div className="text-xs text-on-surface-variant">Temperature, distance &amp; wind</div>
            </div>
            <div className="flex items-center gap-1 bg-surface-container rounded-lg p-1 text-xs shrink-0">
              {(
                [
                  { id: 'metric', label: 'Metric (°C, km)' },
                  { id: 'imperial', label: 'Imperial (°F, mi)' }
                ] as const
              ).map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    updateProfile({ units: u.id });
                    pushToast(`Switched units to ${u.id}`, 'info');
                  }}
                  className={`px-2.5 py-1 rounded font-semibold transition ${profile.units === u.id ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                >
                  {u.label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-container-low flex flex-wrap items-center justify-between gap-3 border border-outline-variant/25 min-w-0">
            <div className="min-w-0">
              <div className="font-label-md font-semibold text-on-surface">Display Currency</div>
              <div className="text-xs text-on-surface-variant">Used in savings &amp; filter cost estimates</div>
            </div>
            <div className="flex items-center gap-1 bg-surface-container rounded-lg p-1 text-xs shrink-0">
              {(
                [
                  { id: 'INR', label: 'INR (₹)' },
                  { id: 'USD', label: 'USD ($)' }
                ] as const
              ).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    updateProfile({ currency: c.id });
                    pushToast(`Currency set to ${c.id}`, 'info');
                  }}
                  className={`px-2.5 py-1 rounded font-semibold transition ${profile.currency === c.id ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Notifications bar */}
        <div className="p-3.5 rounded-xl bg-surface-container-low flex flex-wrap items-center justify-between gap-3 border border-outline-variant/25">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${profile.notificationsEnabled ? 'bg-secondary' : 'bg-primary'
                  }`}
              />
              <span className="font-label-md font-semibold text-on-surface">
                Smog &amp; Thermal Inversion Notifications
              </span>
            </div>
            <div className="text-xs text-on-surface-variant mt-0.5">
              {profile.notificationsEnabled
                ? 'Push & browser alerts enabled for sudden AQI spikes and ventilation windows.'
                : 'Enable alerts to get warned when evening thermal inversions trap ground smog.'}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleEnablePush}
              className="px-3 py-1.5 rounded-lg bg-secondary-container text-on-secondary-container font-label-sm font-bold"
            >
              {profile.notificationsEnabled ? 'Re-sync Push' : 'Enable Alerts'}
            </button>
            <button
              type="button"
              onClick={handleTestNotification}
              className="px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-bright text-primary font-label-sm font-semibold"
            >
              Test Alert
            </button>
          </div>
        </div>
      </section>

      {/* Accessibility, Voice & Display */}
      <section className="rounded-2xl bg-surface-container p-4 sm:p-5 shadow-xl space-y-4">
        <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
          Accessibility, Voice &amp; Display
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-3.5 rounded-xl bg-surface-container-low flex items-center justify-between gap-2">
            <div>
              <div className="font-label-md font-semibold text-on-surface">Theme Mode</div>
              <div className="text-xs text-on-surface-variant">
                {currentTheme === 'dark' ? 'Dark Mode active' : 'Light Mode active'}
              </div>
            </div>
            <div className="flex items-center gap-1 bg-surface-container rounded-xl p-1 shrink-0">
              <button
                type="button"
                aria-pressed={currentTheme === 'dark'}
                onClick={() => {
                  setA11y({ theme: 'dark' });
                  pushToast('Dark Mode enabled', 'info');
                }}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition ${currentTheme === 'dark'
                    ? 'bg-primary text-on-primary shadow'
                    : 'text-on-surface-variant hover:text-on-surface'
                  }`}
              >
                <span className="material-symbols-outlined text-[15px]">dark_mode</span>
                <span>Dark</span>
              </button>
              <button
                type="button"
                aria-pressed={currentTheme === 'light'}
                onClick={() => {
                  setA11y({ theme: 'light' });
                  pushToast('Light Mode enabled', 'info');
                }}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition ${currentTheme === 'light'
                    ? 'bg-primary text-on-primary shadow'
                    : 'text-on-surface-variant hover:text-on-surface'
                  }`}
              >
                <span className="material-symbols-outlined text-[15px]">light_mode</span>
                <span>Light</span>
              </button>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-container-low flex items-center justify-between gap-2">
            <div>
              <div className="font-label-md font-semibold text-on-surface">Text Size</div>
              <div className="text-xs text-on-surface-variant">
                Scale: {Math.round((1 + a11y.fontSizeOffset * 0.1) * 100)}%
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                aria-label="Decrease font size"
                onClick={() => setA11y({ fontSizeOffset: Math.max(-2, a11y.fontSizeOffset - 1) })}
                className="px-3 py-1.5 rounded-lg bg-surface-container-high font-bold text-on-surface"
              >
                A−
              </button>
              <button
                type="button"
                aria-label="Increase font size"
                onClick={() => setA11y({ fontSizeOffset: Math.min(4, a11y.fontSizeOffset + 1) })}
                className="px-3 py-1.5 rounded-lg bg-surface-container-high font-bold text-primary"
              >
                A+
              </button>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-container-low space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="speech-rate-range" className="font-label-md font-semibold text-on-surface">
                Voice Speech Speed
              </label>
              <span className="text-xs text-primary font-bold">{a11y.speechRate.toFixed(2)}×</span>
            </div>
            <input
              id="speech-rate-range"
              type="range"
              min={0.75}
              max={1.5}
              step={0.05}
              value={a11y.speechRate}
              onChange={(e) => setA11y({ speechRate: Number(e.target.value) })}
              className="w-full accent-amber-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-surface-container-low cursor-pointer">
            <div>
              <div className="font-label-md font-semibold text-on-surface">Always Read Answers Aloud</div>
              <div className="text-xs text-on-surface-variant">Automatically speaks Oracle replies</div>
            </div>
            <input
              type="checkbox"
              checked={a11y.alwaysReadAloud}
              onChange={(e) => {
                setA11y({ alwaysReadAloud: e.target.checked });
                pushToast(e.target.checked ? 'Auto-read enabled' : 'Auto-read disabled', 'info');
              }}
              className="w-5 h-5 accent-emerald-400 shrink-0"
            />
          </label>

          <label className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-surface-container-low cursor-pointer">
            <div>
              <div className="font-label-md font-semibold text-on-surface">Voice-Only Accessibility Mode</div>
              <div className="text-xs text-on-surface-variant">Large tap-to-talk screen with big text</div>
            </div>
            <input
              type="checkbox"
              checked={a11y.voiceOnlyMode}
              onChange={(e) => setA11y({ voiceOnlyMode: e.target.checked })}
              className="w-5 h-5 accent-amber-500 shrink-0"
            />
          </label>

          <label className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-surface-container-low cursor-pointer">
            <div>
              <div className="font-label-md font-semibold text-on-surface">Atmospheric Scroll Animation</div>
              <div className="text-xs text-on-surface-variant">Live scroll-driven inversion sky &amp; smog animation across full app background</div>
            </div>
            <input
              type="checkbox"
              checked={a11y.backgroundAnimation !== false}
              onChange={(e) => {
                setA11y({ backgroundAnimation: e.target.checked });
                pushToast(
                  e.target.checked
                    ? 'Atmospheric scroll background enabled'
                    : 'Atmospheric scroll background disabled',
                  'info'
                );
              }}
              className="w-5 h-5 accent-primary shrink-0"
            />
          </label>
        </div>
      </section>

      {/* Live Service Connectivity Diagnostics (Collapsible) */}
      <section className="rounded-2xl bg-surface-container-high/85 p-4 sm:p-5 shadow-xl space-y-3 border border-outline-variant/25">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-label-sm uppercase tracking-widest text-secondary font-bold">
                Live Service Status
              </span>
              {verifyRes && (
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                    allChecksOk ? 'bg-secondary/20 text-secondary' : 'bg-primary/20 text-primary'
                  }`}
                >
                  {allChecksOk ? 'All Systems Operational' : 'Attention Needed'}
                </span>
              )}
            </div>
            <div className="text-xs text-on-surface-variant">
              External clean-air station feeds, road routers &amp; AI service status
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!diagnosticsOpen) setDiagnosticsOpen(true);
                runLiveVerify();
              }}
              disabled={verifying}
              className="px-3.5 py-1.5 rounded-xl bg-primary text-on-primary font-label-sm font-bold flex items-center gap-1.5 disabled:opacity-60 text-xs shadow-sm"
            >
              <span className={`material-symbols-outlined text-[15px] ${verifying ? 'animate-spin' : ''}`}>
                {verifying ? 'sync' : 'network_check'}
              </span>
              <span>{verifying ? 'Checking...' : 'Check Status'}</span>
            </button>
            <button
              type="button"
              onClick={() => setDiagnosticsOpen(!diagnosticsOpen)}
              className="px-3 py-1.5 rounded-xl bg-surface-container hover:bg-surface-bright text-on-surface text-xs font-semibold flex items-center gap-1 border border-outline-variant/30"
            >
              <span>{diagnosticsOpen ? 'Hide' : 'Diagnostics'}</span>
              <span className="material-symbols-outlined text-[15px]">
                {diagnosticsOpen ? 'expand_less' : 'expand_more'}
              </span>
            </button>
          </div>
        </div>

        {diagnosticsOpen && (
          <div className="pt-3 border-t border-outline-variant/20 space-y-2.5">
            {verifying && !verifyRes ? (
              <GlassSkeleton lines={3} />
            ) : verifyRes ? (
              <div className="space-y-2">
                {verifyRes.checks.map((c) => {
                  const cleanName = c.name.replace(/\s*\([A-Z0-9_/ ]+\)/g, '');
                  return (
                    <div
                      key={c.name}
                      className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                        c.ok ? 'bg-secondary/10 border-secondary/30' : 'bg-error-container/25 border-error/40'
                      }`}
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`material-symbols-outlined text-[18px] shrink-0 ${c.ok ? 'text-secondary' : 'text-error'}`}>
                            {c.ok ? 'check_circle' : 'error'}
                          </span>
                          <span className="font-label-md font-bold text-on-surface break-words">{cleanName}</span>
                        </div>
                        <p className="text-xs text-on-surface-variant break-words">{c.detail}</p>
                      </div>
                      <span className="text-xs font-mono text-on-surface-variant shrink-0">
                        {c.ok ? `${c.latencyMs} ms` : 'Check failed'}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="text-[11px] text-on-surface-variant pt-1 flex flex-wrap justify-between gap-2">
              <span>Last checked: {verifyRes ? new Date(verifyRes.checkedAt).toLocaleTimeString() : 'Not checked'}</span>
              {health?.emergencyNumber && (
                <span>Emergency Hotline: <strong className="text-on-surface">{health.emergencyNumber}</strong></span>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Data & Privacy Controls */}
      <section className="rounded-2xl bg-surface-container-low p-4 sm:p-5 space-y-3 border border-outline-variant/25">
        <h2 className="font-headline-sm text-on-surface font-semibold">Data &amp; Privacy</h2>
        <p className="text-xs text-on-surface-variant">
          Your household profile, saved playbooks, and symptom logs are stored locally on your device.
        </p>
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={handleExportProfile}
            className="px-4 py-2 rounded-xl bg-surface-container-high hover:bg-surface-bright text-primary font-label-md font-semibold flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            <span>Export Settings &amp; Profile JSON</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmResetOpen(true)}
            className="px-4 py-2 rounded-xl bg-error-container/50 hover:bg-error-container text-on-error-container font-label-md font-semibold flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">delete_forever</span>
            <span>Reset Local Data</span>
          </button>
        </div>
      </section>

      <ModalDialog open={confirmResetOpen} onClose={() => setConfirmResetOpen(false)} title="Reset All Local Data?">
        <div className="space-y-4">
          <p className="text-sm text-on-surface-variant">
            This clears your saved household profile, bookmarked playbooks, Oracle chat history, and offline cache on this device. Community pledges stored on the server are not affected.
          </p>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setConfirmResetOpen(false)}
              className="px-4 py-2 rounded-xl bg-surface-container-high text-on-surface font-label-md font-semibold"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmReset}
              className="px-4 py-2 rounded-xl bg-error text-on-error font-label-md font-bold"
            >
              Confirm Reset
            </button>
          </div>
        </div>
      </ModalDialog>
    </div>
  );
};
