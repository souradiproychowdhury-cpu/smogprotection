import React, { useEffect, useState } from 'react';
import { type HealthDirectives } from '@aetheria/shared';
import { ErrorRetryCard, GlassSkeleton } from '../components/LoadingSkeleton';
import { ModalDialog } from '../components/ModalDialog';
import { api } from '../lib/api';
import { showLocalNotification } from '../lib/notifications';
import { buildSmsLink, buildWhatsAppLink } from '../lib/share';
import { useAppStore, type VulnerableDependent } from '../store/useAppStore';
import { useTranslation } from '../i18n/useTranslation';

export const HealthPage: React.FC = () => {
  const { t } = useTranslation();
  const air = useAppStore((s) => s.air);
  const profile = useAppStore((s) => s.profile);
  const language = useAppStore((s) => s.language);
  const emergencyNumber = useAppStore((s) => s.emergencyNumber);
  const dependents = useAppStore((s) => s.dependents);
  const activeDependentId = useAppStore((s) => s.activeDependentId);
  const setActiveDependent = useAppStore((s) => s.setActiveDependent);
  const addDependent = useAppStore((s) => s.addDependent);
  const updateDependent = useAppStore((s) => s.updateDependent);
  const removeDependent = useAppStore((s) => s.removeDependent);
  const administerDose = useAppStore((s) => s.administerDose);
  const addSymptomEntry = useAppStore((s) => s.addSymptomEntry);
  const pushToast = useAppStore((s) => s.pushToast);

  const activeDep = dependents.find((d) => d.id === activeDependentId) || dependents[0];

  const [directives, setDirectives] = useState<HealthDirectives | null>(null);
  const [loadingDirectives, setLoadingDirectives] = useState(false);
  const [directivesError, setDirectivesError] = useState<string | null>(null);

  const [symptomModalOpen, setSymptomModalOpen] = useState(false);
  const [symptomText, setSymptomText] = useState('Dry cough');
  const [severity, setSeverity] = useState(2);
  const [peakFlowInput, setPeakFlowInput] = useState('');
  const [symptomNotes, setSymptomNotes] = useState('');

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [isNewDep, setIsNewDep] = useState(false);
  const [depForm, setDepForm] = useState({
    name: '',
    ageGroup: 'child' as VulnerableDependent['ageGroup'],
    ageYears: 7,
    condition: '',
    triggers: '',
    medicationName: '',
    remainingDoses: 120,
    goalPeakFlow: 260,
    currentPeakFlow: 240
  });

  const [dispatchPreviewOpen, setDispatchPreviewOpen] = useState(false);

  const fetchDirectives = async () => {
    if (!air || !activeDep) return;
    setLoadingDirectives(true);
    setDirectivesError(null);
    try {
      const res = await api.getHealthDirectives({
        dependentName: activeDep.name,
        ageGroup: activeDep.ageGroup,
        condition: activeDep.condition,
        triggers: activeDep.triggers,
        language: language.englishName || language.nativeName,
        lat: air.lat,
        lon: air.lon,
        locationName: air.locationName
      });
      setDirectives(res.data);

      // Early-warning forecast rule: alert if next 6h crosses safe threshold
      const crossesSoon = air.hourly.slice(0, 6).some((h) => h.aqi > res.data.safeAqiThreshold);
      if (crossesSoon && profile.notificationsEnabled) {
        showLocalNotification(
          `Air Boundary Alert for ${activeDep.name}`,
          `AQI is forecast above ${activeDep.name}'s threshold (${res.data.safeAqiThreshold}) in the next 6 hours.`
        );
      }
    } catch (err) {
      setDirectivesError(err instanceof Error ? err.message : 'Unable to load health directives');
    } finally {
      setLoadingDirectives(false);
    }
  };

  useEffect(() => {
    fetchDirectives();
  }, [activeDep?.id, activeDep?.name, activeDep?.condition, activeDep?.triggers, air?.locationName, language.code]);

  const openEditDependent = (createNew: boolean) => {
    setIsNewDep(createNew);
    if (createNew) {
      setDepForm({
        name: '',
        ageGroup: 'child',
        ageYears: 5,
        condition: 'Mild Asthma',
        triggers: 'Winter smog, PM2.5',
        medicationName: 'Reliever Inhaler',
        remainingDoses: 120,
        goalPeakFlow: 260,
        currentPeakFlow: 240
      });
    } else if (activeDep) {
      setDepForm({
        name: activeDep.name,
        ageGroup: activeDep.ageGroup,
        ageYears: activeDep.ageYears,
        condition: activeDep.condition,
        triggers: activeDep.triggers,
        medicationName: activeDep.medicationName,
        remainingDoses: activeDep.remainingDoses,
        goalPeakFlow: activeDep.goalPeakFlow,
        currentPeakFlow: activeDep.currentPeakFlow
      });
    }
    setEditModalOpen(true);
  };

  const handleSaveDependent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!depForm.name.trim()) return;
    if (isNewDep) {
      addDependent({
        id: `dep-${Date.now()}`,
        ...depForm,
        spo2: 97,
        restingHr: 80,
        hermeticShield: true,
        doseLog: [],
        symptomLog: []
      });
      pushToast(`Added ${depForm.name} to Health Shield`, 'success');
    } else if (activeDep) {
      updateDependent(activeDep.id, depForm);
      pushToast(`Updated ${depForm.name}'s profile`, 'success');
    }
    setEditModalOpen(false);
  };

  const handleRecordSymptom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDep) return;
    addSymptomEntry(activeDep.id, {
      symptom: symptomText,
      severity,
      peakFlow: peakFlowInput ? Number(peakFlowInput) : undefined,
      notes: symptomNotes
    });
    setSymptomModalOpen(false);
    setSymptomNotes('');
    setPeakFlowInput('');
    pushToast('Symptom entry logged', 'success');
  };

  const handleExportLog = () => {
    if (!activeDep) return;
    const summary = {
      exportedAt: new Date().toISOString(),
      dependent: activeDep,
      currentAir: air
        ? { location: air.locationName, aqi: air.aqi, pm25: air.pm25, updatedAt: air.updatedAt }
        : null
    };
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aetheria-health-log-${activeDep.name.toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast('Exported symptom & dose log', 'success');
  };

  const safeThreshold = directives?.safeAqiThreshold ?? 75;
  const currentAqi = air?.aqi ?? 0;
  const exceedsBoundary = currentAqi > safeThreshold;
  const emergencyCoordsText = `EMERGENCY AIR / RESPIRATORY ALERT for ${activeDep?.name} (${activeDep?.condition}). Location: ${air?.locationName || 'Unknown'} (${air?.lat?.toFixed(4) || ''}, ${air?.lon?.toFixed(4) || ''}). Current US AQI: ${currentAqi}, PM2.5: ${air?.pm25 ?? '--'} µg/m³.`;

  return (
    <div className="space-y-6">
      {/* Top Dependent Selector + Add/Edit */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-container-high">
            <span className={`w-2 h-2 rounded-full ${exceedsBoundary ? 'bg-error animate-ping' : 'bg-secondary'}`} />
            <span className="font-label-sm uppercase tracking-widest text-primary font-bold">
              {t('health.title')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {activeDep && (
              <>
                <button
                  type="button"
                  onClick={() => openEditDependent(false)}
                  className="px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-bright text-primary font-label-sm font-semibold"
                >
                  Edit Profile
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const removedName = activeDep.name;
                    removeDependent(activeDep.id);
                    pushToast(`Removed ${removedName} from Health Shield`, 'info');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-error-container/40 hover:bg-error-container text-error font-label-sm font-semibold"
                >
                  Remove
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => openEditDependent(true)}
              className="px-3 py-1.5 rounded-lg bg-primary text-on-primary font-label-sm font-bold flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[15px]">person_add</span>
              <span>Add Person</span>
            </button>
          </div>
        </div>

        {dependents.length === 0 ? (
          <div className="p-4 rounded-xl bg-surface-container-low text-sm text-on-surface-variant flex items-center justify-between gap-3">
            <span>No family members added yet. Add a child, elder, or household member to track respiratory safety.</span>
            <button
              type="button"
              onClick={() => openEditDependent(true)}
              className="px-3 py-1.5 rounded-lg bg-primary text-on-primary font-label-sm font-bold shrink-0"
            >
              Add Person
            </button>
          </div>
        ) : (
          <div className="p-1.5 rounded-xl bg-surface-container-low flex flex-wrap gap-1.5">
            {dependents.map((dep) => {
              const active = dep.id === activeDep?.id;
              return (
                <button
                  key={dep.id}
                  type="button"
                  onClick={() => setActiveDependent(dep.id)}
                  className={`flex-1 min-w-[140px] py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition ${
                    active
                      ? 'bg-surface-container-high text-primary shadow-sm font-semibold'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {dep.ageGroup === 'elderly' ? 'elderly' : dep.ageGroup === 'infant' ? 'crib' : 'child_care'}
                  </span>
                  <div className="text-left">
                    <div className="font-label-md leading-tight">{dep.name} ({dep.ageYears})</div>
                    <div className="font-label-sm text-[10px] text-on-surface-variant">{dep.condition}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Personal Air Boundary & Vitals */}
      {activeDep && (
        <section
          data-tour="health-boundary"
          className="p-5 rounded-2xl bg-surface-container shadow-xl space-y-5 gilded-rim"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-label-sm uppercase tracking-widest text-primary font-bold">
                Personal Safe-Exposure Boundary
              </span>
              <h1 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                {activeDep.name}'s Air Boundary
              </h1>
            </div>
            <span
              className={`px-3 py-1 rounded-full font-label-sm font-bold ${
                exceedsBoundary ? 'bg-error/20 text-error' : 'bg-secondary/20 text-secondary'
              }`}
            >
              {exceedsBoundary ? `Exceeded (AQI ${currentAqi} > ${safeThreshold})` : `Safe (AQI ${currentAqi} ≤ ${safeThreshold})`}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
            <div className="sm:col-span-4 flex justify-center">
              <div className="relative w-36 h-36 flex items-center justify-center">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="50" fill="none" stroke="#2f3445" strokeWidth="8" />
                  <circle
                    cx="60"
                    cy="60"
                    r="50"
                    fill="none"
                    stroke="#68dba9"
                    strokeWidth="8"
                    strokeDasharray="314"
                    strokeDashoffset={Math.round(314 * (1 - Math.min(1, safeThreshold / 300)))}
                    strokeLinecap="round"
                  />
                  <circle cx="60" cy="60" r="38" fill="none" stroke="#2f3445" strokeWidth="7" />
                  <circle
                    cx="60"
                    cy="60"
                    r="38"
                    fill="none"
                    stroke={exceedsBoundary ? '#E11D48' : '#f59e0b'}
                    strokeWidth="7"
                    strokeDasharray="238"
                    strokeDashoffset={Math.round(238 * (1 - Math.min(1, currentAqi / 300)))}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-[10px] uppercase text-on-surface-variant">Live AQI</span>
                  <span className="font-headline-sm font-bold text-primary">{currentAqi}</span>
                  <span className="text-[10px] text-secondary">Limit {safeThreshold}</span>
                </div>
              </div>
            </div>

            <div className="sm:col-span-8 grid grid-cols-2 gap-2.5">
              <div className="p-3 rounded-xl bg-surface-container-low">
                <div className="font-label-sm text-on-surface-variant uppercase">Triggers</div>
                <div className="font-body-sm text-on-surface mt-0.5">{activeDep.triggers}</div>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low">
                <div className="font-label-sm text-on-surface-variant uppercase">Medication & Doses</div>
                <div className="font-label-md font-bold text-primary mt-0.5">{activeDep.medicationName}</div>
                <div className="text-xs text-secondary">{activeDep.remainingDoses} doses remaining</div>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low">
                <div className="font-label-sm text-on-surface-variant uppercase">Latest Peak Flow</div>
                <div className="font-label-lg font-bold text-on-surface mt-0.5">
                  {activeDep.currentPeakFlow} <span className="text-xs text-on-surface-variant">/ {activeDep.goalPeakFlow} L/min</span>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-surface-container-low flex items-center justify-between">
                <div>
                  <div className="font-label-sm text-on-surface-variant uppercase">Mark Dose</div>
                  <div className="text-xs text-on-surface-variant">Logs & decrements</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    administerDose(activeDep.id);
                    pushToast(`Logged dose for ${activeDep.name}`, 'success');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-primary text-on-primary font-label-sm font-bold"
                >
                  Mark Administered
                </button>
              </div>
            </div>
          </div>

          <label className="flex items-center justify-between p-3 rounded-xl bg-surface-container-low cursor-pointer">
            <div>
              <div className="font-label-md font-semibold text-on-surface">Bedroom Safe-Room Shield Active</div>
              <div className="text-xs text-on-surface-variant">Sealed door + active HEPA/MERV-13 filtration</div>
            </div>
            <input
              type="checkbox"
              checked={activeDep.hermeticShield}
              onChange={(e) => updateDependent(activeDep.id, { hermeticShield: e.target.checked })}
              className="w-5 h-5 accent-emerald-400"
            />
          </label>
        </section>
      )}

      {/* GenAI Shield Directives + Symptom Log */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">auto_awesome</span>
              <span>{t('health.directivesTitle')}</span>
            </h2>
            <button
              type="button"
              onClick={fetchDirectives}
              className="px-3 py-1 rounded-lg bg-surface-container-high text-primary text-xs font-semibold"
            >
              Refresh
            </button>
          </div>

          {directivesError && <ErrorRetryCard message={directivesError} onRetry={fetchDirectives} />}

          {loadingDirectives && !directives ? (
            <GlassSkeleton lines={4} />
          ) : directives ? (
            <div className="space-y-3">
              {directives.directives.map((d, i) => (
                <div key={i} className="p-4 rounded-2xl bg-surface-container space-y-2 shadow-md">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary">{d.icon}</span>
                      <div>
                        <div className="font-label-md font-bold text-on-surface">{d.title}</div>
                        <div className="text-xs text-on-surface-variant">{d.subtitle}</div>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold uppercase">
                      {d.urgency}
                    </span>
                  </div>
                  <p className="font-body-sm text-on-surface-variant bg-surface-container-low p-3 rounded-xl">
                    {d.body}
                  </p>
                </div>
              ))}

              <div className="p-3.5 rounded-xl bg-surface-container-high text-xs text-on-surface-variant space-y-1">
                <div className="font-bold text-primary">Forecast Advisory</div>
                <p>{directives.twilightWarning}</p>
                <p className="text-error pt-1 font-medium">{directives.disclaimer}</p>
              </div>
            </div>
          ) : null}
        </section>

        {/* Clinical Early Warning Log + Dose History */}
        <section className="lg:col-span-5 space-y-4">
          <div className="p-4 rounded-2xl bg-surface-container space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                {t('health.logTitle')}
              </h2>
              <button
                type="button"
                onClick={() => setSymptomModalOpen(true)}
                className="px-3 py-1.5 rounded-full bg-primary text-on-primary font-label-sm font-bold flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                <span>Log Entry</span>
              </button>
            </div>

            {activeDep?.symptomLog.length === 0 && activeDep?.doseLog.length === 0 ? (
              <p className="text-sm text-on-surface-variant">
                No symptoms or doses logged yet today. Tap "+ Log Entry" or "Mark Administered" to record.
              </p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {activeDep?.symptomLog.map((s) => (
                  <div key={s.id} className="p-2.5 rounded-xl bg-surface-container-low text-xs flex justify-between gap-2">
                    <div>
                      <div className="font-semibold text-on-surface">
                        {s.symptom} (Severity {s.severity}/5){s.peakFlow ? ` · Peak Flow ${s.peakFlow}` : ''}
                      </div>
                      {s.notes && <div className="text-on-surface-variant">{s.notes}</div>}
                    </div>
                    <span className="text-on-surface-variant shrink-0">
                      {new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
                {activeDep?.doseLog.map((d) => (
                  <div key={d.id} className="p-2.5 rounded-xl bg-secondary/10 text-xs flex justify-between gap-2">
                    <span className="font-semibold text-secondary">Dose: {d.medicationName}</span>
                    <span className="text-on-surface-variant">
                      {new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={handleExportLog}
              className="w-full py-2.5 rounded-xl bg-surface-container-high hover:bg-surface-bright text-primary font-label-md font-semibold flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              <span>Export Health & Air Log</span>
            </button>
          </div>

          {/* Emergency Rescue Protocol */}
          <div className="p-4 rounded-2xl bg-error-container/25 border border-error/40 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-sm text-on-surface font-semibold flex items-center gap-2">
                <span className="material-symbols-outlined text-error">crisis_alert</span>
                <span>{t('health.emergencyTitle')}</span>
              </h2>
              <span className="px-2 py-0.5 rounded-full bg-error text-on-error text-[10px] font-bold uppercase">
                Emergency
              </span>
            </div>

            <ol className="list-decimal ps-5 text-xs text-on-surface space-y-1">
              <li>Help the person sit upright in a calm, sealed, filtered room.</li>
              <li>Follow their clinician’s written rescue action plan immediately.</li>
              <li>If severe wheezing, chest pain, blue lips, or infant distress occurs, call emergency services now.</li>
            </ol>

            <p className="text-[11px] text-on-surface-variant">
              General guidance only, not medical advice or a substitute for a clinician. Never change prescribed doses without medical advice.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <a
                href={`tel:${emergencyNumber}`}
                className="min-h-[46px] px-4 py-2.5 rounded-xl bg-error text-on-error font-label-lg font-bold flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined">call</span>
                <span>Call {emergencyNumber}</span>
              </a>
              <button
                type="button"
                onClick={() => setDispatchPreviewOpen(true)}
                className="min-h-[46px] px-4 py-2.5 rounded-xl bg-surface-container-high text-primary font-label-md font-bold flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined">share_location</span>
                <span>Review Dispatch</span>
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Log Symptom Modal */}
      <ModalDialog open={symptomModalOpen} onClose={() => setSymptomModalOpen(false)} title="Log Symptom Entry">
        <form onSubmit={handleRecordSymptom} className="space-y-4">
          <div>
            <label htmlFor="sym-name" className="block font-label-md text-on-surface-variant mb-1">
              Symptom
            </label>
            <input
              id="sym-name"
              type="text"
              required
              value={symptomText}
              onChange={(e) => setSymptomText(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="sym-sev" className="block font-label-md text-on-surface-variant mb-1">
                Severity (1–5)
              </label>
              <input
                id="sym-sev"
                type="number"
                min={1}
                max={5}
                value={severity}
                onChange={(e) => setSeverity(Number(e.target.value) || 1)}
                className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
              />
            </div>
            <div>
              <label htmlFor="sym-pf" className="block font-label-md text-on-surface-variant mb-1">
                Peak Flow (optional)
              </label>
              <input
                id="sym-pf"
                type="number"
                value={peakFlowInput}
                onChange={(e) => setPeakFlowInput(e.target.value)}
                placeholder="L/min"
                className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
              />
            </div>
          </div>
          <div>
            <label htmlFor="sym-notes" className="block font-label-md text-on-surface-variant mb-1">
              Notes
            </label>
            <textarea
              id="sym-notes"
              rows={2}
              value={symptomNotes}
              onChange={(e) => setSymptomNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
            />
          </div>
          <button
            type="submit"
            className="w-full py-2.5 rounded-xl bg-primary text-on-primary font-label-lg font-bold"
          >
            Save Symptom Entry
          </button>
        </form>
      </ModalDialog>

      {/* Add/Edit Dependent Modal */}
      <ModalDialog
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title={isNewDep ? 'Add Vulnerable Household Member' : 'Edit Member Profile'}
      >
        <form onSubmit={handleSaveDependent} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="dep-name" className="block text-xs text-on-surface-variant mb-1">Name</label>
              <input
                id="dep-name"
                required
                value={depForm.name}
                onChange={(e) => setDepForm({ ...depForm, name: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
              />
            </div>
            <div>
              <label htmlFor="dep-age" className="block text-xs text-on-surface-variant mb-1">Age (Years)</label>
              <input
                id="dep-age"
                type="number"
                min={0}
                max={110}
                value={depForm.ageYears}
                onChange={(e) => setDepForm({ ...depForm, ageYears: Number(e.target.value) || 0 })}
                className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
              />
            </div>
          </div>
          <div>
            <label htmlFor="dep-group" className="block text-xs text-on-surface-variant mb-1">Age Group</label>
            <select
              id="dep-group"
              value={depForm.ageGroup}
              onChange={(e) => setDepForm({ ...depForm, ageGroup: e.target.value as VulnerableDependent['ageGroup'] })}
              className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
            >
              <option value="infant">Infant</option>
              <option value="child">Child</option>
              <option value="adult">Adult</option>
              <option value="elderly">Elderly</option>
            </select>
          </div>
          <div>
            <label htmlFor="dep-cond" className="block text-xs text-on-surface-variant mb-1">Condition</label>
            <input
              id="dep-cond"
              value={depForm.condition}
              onChange={(e) => setDepForm({ ...depForm, condition: e.target.value })}
              className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
            />
          </div>
          <div>
            <label htmlFor="dep-trig" className="block text-xs text-on-surface-variant mb-1">Triggers</label>
            <input
              id="dep-trig"
              value={depForm.triggers}
              onChange={(e) => setDepForm({ ...depForm, triggers: e.target.value })}
              className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="dep-med" className="block text-xs text-on-surface-variant mb-1">Medication</label>
              <input
                id="dep-med"
                value={depForm.medicationName}
                onChange={(e) => setDepForm({ ...depForm, medicationName: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
              />
            </div>
            <div>
              <label htmlFor="dep-doses" className="block text-xs text-on-surface-variant mb-1">Doses Left</label>
              <input
                id="dep-doses"
                type="number"
                value={depForm.remainingDoses}
                onChange={(e) => setDepForm({ ...depForm, remainingDoses: Number(e.target.value) || 0 })}
                className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="dep-cur-pf" className="block text-xs text-on-surface-variant mb-1">Current Peak Flow (L/min)</label>
              <input
                id="dep-cur-pf"
                type="number"
                value={depForm.currentPeakFlow}
                onChange={(e) => setDepForm({ ...depForm, currentPeakFlow: Number(e.target.value) || 0 })}
                className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
              />
            </div>
            <div>
              <label htmlFor="dep-goal-pf" className="block text-xs text-on-surface-variant mb-1">Target Peak Flow (L/min)</label>
              <input
                id="dep-goal-pf"
                type="number"
                value={depForm.goalPeakFlow}
                onChange={(e) => setDepForm({ ...depForm, goalPeakFlow: Number(e.target.value) || 0 })}
                className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
              />
            </div>
          </div>
          <button type="submit" className="w-full py-2.5 rounded-xl bg-primary text-on-primary font-label-lg font-bold">
            Save Member
          </button>
        </form>
      </ModalDialog>

      {/* Emergency Dispatch Preview Modal */}
      <ModalDialog open={dispatchPreviewOpen} onClose={() => setDispatchPreviewOpen(false)} title="Send Emergency Location">
        <div className="space-y-4">
          <div className="p-3 rounded-xl bg-surface-container-lowest text-sm text-on-surface border border-outline-variant/40">
            {emergencyCoordsText}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <a
              href={buildWhatsAppLink(emergencyCoordsText)}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2.5 rounded-xl bg-secondary-container text-on-secondary-container font-label-md font-bold flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[18px]">chat</span>
              <span>WhatsApp</span>
            </a>
            <a
              href={buildSmsLink(emergencyCoordsText, profile.emergencyContactPhone)}
              className="py-2.5 rounded-xl bg-primary text-on-primary font-label-md font-bold flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[18px]">sms</span>
              <span>SMS Caregiver</span>
            </a>
          </div>
        </div>
      </ModalDialog>
    </div>
  );
};
