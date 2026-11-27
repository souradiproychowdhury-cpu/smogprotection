import React, { useMemo, useState } from 'react';
import { emissionFactors, type OracleResponse, type PlaybookDetail } from '@aetheria/shared';
import { ModalDialog } from '../components/ModalDialog';
import { api } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { useTranslation } from '../i18n/useTranslation';

interface VaultPlaybookCard {
  id: string;
  title: string;
  summary: string;
  category: 'filtration' | 'cooking' | 'heating' | 'sealing' | 'botanical' | 'commute';
  tags: string[];
  impactBadge: string;
  evidenceTag: string;
  evidenceColor: string;
}

const PLAYBOOKS: VaultPlaybookCard[] = [
  {
    id: 'diy-box-fan',
    title: 'DIY Box-Fan MERV-13 / Corsi-Rosenthal Filter',
    summary:
      'Tape or bungee a pleated MERV-13 filter onto a 20-inch box fan intake to achieve commercial-grade bedroom PM2.5 removal at a fraction of the cost.',
    category: 'filtration',
    tags: ['Filtration', 'Low Cost', 'Kids', 'Elderly'],
    impactBadge: 'Est. -50% to -80% PM2.5',
    evidenceTag: 'Strong Evidence',
    evidenceColor: 'text-secondary bg-secondary/15'
  },
  {
    id: 'window-sealing',
    title: 'Window & Door Inversion Sealing',
    summary:
      'Use foam weatherstrip tape and damp rolled draft-snakes on leaky frames during thermal inversions to cut outdoor smog infiltration.',
    category: 'sealing',
    tags: ['Sealing', 'Low Cost', 'Kids', 'Elderly'],
    impactBadge: 'Est. -40% to -65% Infiltration',
    evidenceTag: 'Strong Evidence',
    evidenceColor: 'text-secondary bg-secondary/15'
  },
  {
    id: 'simmer-pot',
    title: 'Kitchen Exhaust & Winter Simmer Pot Reality Check',
    summary:
      'Covered induction/LPG cooking with high exhaust cuts kitchen NO₂ sharply. Note: simmering water with spices adds pleasant humidity but does NOT remove PM2.5.',
    category: 'cooking',
    tags: ['Cooking', 'Science Check'],
    impactBadge: 'Est. -50% to -65% NO₂ (Exhaust)',
    evidenceTag: 'Honest Check',
    evidenceColor: 'text-primary bg-primary/15'
  },
  {
    id: 'botanical-plants',
    title: 'Indoor Plants — Realistic Role & Limits',
    summary:
      'Snake plants and ferns support humidity and wellbeing, but peer-reviewed studies show negligible real-world PM2.5 removal—pair with mechanical filtration.',
    category: 'botanical',
    tags: ['Botanical', 'Science Check'],
    impactBadge: 'Est. <2% PM2.5 Removal',
    evidenceTag: 'Weak PM2.5 Effect',
    evidenceColor: 'text-tertiary bg-tertiary/15'
  },
  {
    id: 'commute-mask',
    title: 'Fitted N95 / FFP2 & Transit Shift Guide',
    summary:
      'Proper nose-bridge seal on an N95/KF94 mask plus underground metro or side-street walking slashes inhalation dose during peak rush hour.',
    category: 'commute',
    tags: ['Commute', 'Kids', 'Elderly'],
    impactBadge: 'Est. -75% to -90% Inhaled PM2.5',
    evidenceTag: 'Strong Evidence',
    evidenceColor: 'text-secondary bg-secondary/15'
  },
  {
    id: 'clean-heating',
    title: 'Zero-Smoke Winter Heating & Thermal Retention',
    summary:
      'Replace indoor wood/coal braziers with thermal curtains, draft sealing, and clean electric/infrared heating to eliminate indoor smoke surges.',
    category: 'heating',
    tags: ['Heating', 'Low Cost', 'Elderly'],
    impactBadge: 'Est. -180 µg/m³ Smoke Avoided',
    evidenceTag: 'Strong Evidence',
    evidenceColor: 'text-secondary bg-secondary/15'
  }
];

export const VaultPage: React.FC = () => {
  const { t } = useTranslation();
  const air = useAppStore((s) => s.air);
  const profile = useAppStore((s) => s.profile);
  const language = useAppStore((s) => s.language);
  const vaultBookmarks = useAppStore((s) => s.vaultBookmarks);
  const toggleVaultBookmark = useAppStore((s) => s.toggleVaultBookmark);
  const vaultChecklist = useAppStore((s) => s.vaultChecklist);
  const toggleVaultChecklist = useAppStore((s) => s.toggleVaultChecklist);
  const pushToast = useAppStore((s) => s.pushToast);

  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [activeDetail, setActiveDetail] = useState<PlaybookDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [savedOracleDetail, setSavedOracleDetail] = useState<OracleResponse | null>(null);

  const filteredPlaybooks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return PLAYBOOKS.filter((p) => {
      if (filter === 'saved') {
        return vaultBookmarks.some((b) => b.id === p.id);
      }
      if (filter !== 'all') {
        const matchesCat = p.category === filter || p.tags.some((tag) => tag.toLowerCase() === filter);
        if (!matchesCat) return false;
      }
      if (q) {
        return `${p.title} ${p.summary} ${p.tags.join(' ')}`.toLowerCase().includes(q);
      }
      return true;
    });
  }, [filter, search, vaultBookmarks]);

  const savedOracleCards = useMemo(
    () => vaultBookmarks.filter((b) => b.kind === 'oracle'),
    [vaultBookmarks]
  );

  const openPlaybookDetail = async (pb: VaultPlaybookCard) => {
    setDetailLoading(true);
    setActiveDetail({
      id: pb.id,
      title: pb.title,
      materials: ['Loading tailored materials...'],
      timeMinutes: 15,
      steps: ['Loading step-by-step guide...'],
      costEstimate: 'Calculating...',
      directImpact: pb.impactBadge,
      evidenceLevel: 'moderate',
      evidenceNote: pb.summary,
      safetyNote: null
    });

    try {
      const res = await api.getPlaybookDetail({
        playbookId: pb.id,
        title: pb.title,
        language: language.englishName || language.nativeName,
        profile,
        lat: air?.lat,
        lon: air?.lon,
        locationName: air?.locationName
      });
      setActiveDetail(res.data);
    } catch {
      pushToast('Showing offline playbook summary', 'info');
    } finally {
      setDetailLoading(false);
    }
  };

  // Personalized Sustainable Alternatives comparator from emissionFactors
  const currentFuelSpec = emissionFactors.cookingHeatingFuels[profile.fuel];
  const cleanFuelSpec = emissionFactors.cookingHeatingFuels.induction;
  const currentTransportSpec = emissionFactors.transportPerKm[profile.transport];
  const cleanTransportSpec = emissionFactors.transportPerKm.metro;

  const isUsd = profile.currency === 'USD';
  const currencySym = isUsd ? '$' : '₹';

  const fuelCo2SavedPerHr = Math.max(0, Math.round((currentFuelSpec.co2eKgPerHour - cleanFuelSpec.co2eKgPerHour) * 100) / 100);
  const commuteCo2SavedPer10Km = Math.max(0, Math.round((currentTransportSpec.co2eKgPerKm - cleanTransportSpec.co2eKgPerKm) * 10 * 100) / 100);

  const checkedCount = vaultChecklist.filter((c) => c.checked).length;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <section className="rounded-2xl bg-gradient-to-b from-surface-container-high/70 to-surface-container-low p-5 shadow-xl gilded-rim space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-primary text-[24px]">verified</span>
            <div>
              <span className="font-label-sm uppercase tracking-widest text-primary block">
                Evidence-Based Playbooks
              </span>
              <h1 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                {t('vault.title')}
              </h1>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-secondary/15 text-secondary font-label-sm font-bold">
            {vaultBookmarks.length} Saved
          </span>
        </div>
        <p className="font-body-sm text-on-surface-variant">
          Practical indoor air interventions and honest science checks—no false claims, clear estimates.
        </p>
      </section>

      {/* Search & Category Filters */}
      <section data-tour="vault-filters" className="space-y-3">
        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-outline-variant/50">
          <span className="material-symbols-outlined text-primary text-[18px]">search</span>
          <label htmlFor="vault-search" className="sr-only">
            Search playbooks
          </label>
          <input
            id="vault-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search hacks (e.g. MERV-13, sealing, cooking, kids)..."
            className="w-full bg-transparent text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
          {[
            { id: 'all', label: 'All Hacks', icon: 'auto_awesome' },
            { id: 'saved', label: `${t('vault.savedTab')} (${vaultBookmarks.length})`, icon: 'bookmark' },
            { id: 'filtration', label: 'Filtration', icon: 'cyclone' },
            { id: 'sealing', label: 'Sealing', icon: 'sensor_window' },
            { id: 'cooking', label: 'Cooking', icon: 'skillet' },
            { id: 'heating', label: 'Heating', icon: 'thermostat' },
            { id: 'commute', label: 'Commute', icon: 'commute' },
            { id: 'kids', label: 'Kids', icon: 'child_care' },
            { id: 'elderly', label: 'Elderly', icon: 'elderly' }
          ].map((chip) => {
            const active = filter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setFilter(chip.id)}
                className={`shrink-0 px-3.5 py-1.5 rounded-full font-label-md font-semibold flex items-center gap-1.5 transition ${
                  active
                    ? 'bg-primary text-on-primary shadow-md'
                    : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-[15px]">{chip.icon}</span>
                <span>{chip.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Saved Oracle Protocol Cards (shown in Saved tab) */}
      {filter === 'saved' && savedOracleCards.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-headline-sm text-headline-sm text-primary font-semibold">
            Saved Oracle Protocols
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {savedOracleCards.map((item) => (
              <div key={item.id} className="p-4 rounded-2xl bg-surface-container-high space-y-3 gilded-rim flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-headline-sm text-on-surface font-semibold">{item.title}</h3>
                    <button
                      type="button"
                      onClick={() => toggleVaultBookmark(item)}
                      aria-label={`Remove ${item.title} from saved`}
                      className="p-1.5 rounded-full bg-primary text-on-primary shrink-0"
                    >
                      <span className="material-symbols-outlined text-[18px]">bookmark</span>
                    </button>
                  </div>
                  <p className="font-body-sm text-on-surface-variant">{item.summary}</p>
                </div>
                {item.card && (
                  <button
                    type="button"
                    onClick={() => setSavedOracleDetail(item.card || null)}
                    className="self-end px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-bright text-primary font-label-sm font-semibold flex items-center gap-1"
                  >
                    <span>View Full Protocol</span>
                    <span className="material-symbols-outlined text-[16px]">chevron_right</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {filter === 'saved' && vaultBookmarks.length === 0 && (
        <div className="p-6 rounded-2xl bg-surface-container text-center text-sm text-on-surface-variant">
          No saved protocols or playbooks yet. Tap the bookmark icon on any Vault card or Oracle answer.
        </div>
      )}

      {/* Playbook Cards Grid */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredPlaybooks.map((pb) => {
          const isSaved = vaultBookmarks.some((b) => b.id === pb.id);
          return (
            <article
              key={pb.id}
              className="rounded-2xl bg-surface-container-high/85 p-4 shadow-xl flex flex-col justify-between gap-3 border border-outline-variant/25"
            >
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    <span className={`px-2 py-0.5 rounded-full font-label-sm font-bold ${pb.evidenceColor}`}>
                      {pb.evidenceTag}
                    </span>
                    {pb.tags.slice(0, 2).map((tag) => (
                      <span key={tag} className="px-2 py-0.5 rounded-full bg-surface-variant text-on-surface-variant font-label-sm">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    aria-label={isSaved ? `Unsave ${pb.title}` : `Save ${pb.title}`}
                    onClick={() => {
                      toggleVaultBookmark({
                        id: pb.id,
                        kind: 'playbook',
                        title: pb.title,
                        summary: pb.summary,
                        savedAt: new Date().toISOString()
                      });
                      pushToast(isSaved ? 'Removed from Saved' : 'Bookmarked to Saved', 'success');
                    }}
                    className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition ${
                      isSaved
                        ? 'bg-primary text-on-primary'
                        : 'bg-surface-container-lowest text-primary hover:bg-primary hover:text-on-primary'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {isSaved ? 'bookmark' : 'bookmark_border'}
                    </span>
                  </button>
                </div>

                <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                  {pb.title}
                </h2>
                <p className="font-body-sm text-on-surface-variant leading-relaxed">{pb.summary}</p>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-outline-variant/25">
                <span className="font-label-sm text-secondary font-bold">{pb.impactBadge}</span>
                <button
                  type="button"
                  onClick={() => openPlaybookDetail(pb)}
                  className="px-3.5 py-1.5 rounded-xl bg-surface-container hover:bg-surface-bright text-primary font-label-md font-semibold flex items-center gap-1"
                >
                  <span>Open Guide</span>
                  <span className="material-symbols-outlined text-[16px]">chevron_right</span>
                </button>
              </div>
            </article>
          );
        })}
      </section>

      {/* Sustainable Winter Alternatives Comparator */}
      <section data-tour="vault-alternatives" className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-label-sm uppercase tracking-widest text-on-surface-variant block">
              Profile Comparison
            </span>
            <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
              {t('vault.alternativesTitle')}
            </h2>
          </div>
          <span className="material-symbols-outlined text-primary text-[22px]">balance</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-2xl bg-surface-container-high p-4 shadow-xl">
          {/* Fuel Swap */}
          <div className="rounded-xl bg-surface-container-low p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-label-sm uppercase text-primary font-bold">Cooking / Heating</span>
              <span className="px-2 py-0.5 rounded-full bg-secondary/15 text-secondary font-label-sm font-bold">
                Est. -{fuelCo2SavedPerHr} kg CO₂e/hr
              </span>
            </div>
            <div className="text-sm text-on-surface-variant">
              Current: <strong className="text-on-surface">{currentFuelSpec.label}</strong> (
              {currentFuelSpec.indoorPm25ReleaseUgM3} µg/m³ indoor PM2.5 surge)
            </div>
            <div className="text-sm text-secondary">
              Cleaner option: <strong>{cleanFuelSpec.label}</strong> (0 µg/m³ indoor combustion,{' '}
              {currencySym}
              {isUsd ? cleanFuelSpec.costPerHourUsd : cleanFuelSpec.costPerHourInr}/hr est.)
            </div>
          </div>

          {/* Commute Swap */}
          <div className="rounded-xl bg-surface-container-low p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-label-sm uppercase text-tertiary font-bold">Daily Commute (10 km)</span>
              <span className="px-2 py-0.5 rounded-full bg-secondary/15 text-secondary font-label-sm font-bold">
                Est. -{commuteCo2SavedPer10Km} kg CO₂e
              </span>
            </div>
            <div className="text-sm text-on-surface-variant">
              Current: <strong className="text-on-surface">{currentTransportSpec.label}</strong> (
              {currentTransportSpec.exposureMultiplier}× street exposure)
            </div>
            <div className="text-sm text-secondary">
              Cleaner option: <strong>{cleanTransportSpec.label}</strong> (0.55× exposure,{' '}
              {currencySym}
              {isUsd ? (cleanTransportSpec.costPerKmUsd * 10).toFixed(2) : (cleanTransportSpec.costPerKmInr * 10).toFixed(0)}/10km est.)
            </div>
          </div>
        </div>
      </section>

      {/* Household Sanctuary Checklist */}
      <section data-tour="vault-checklist" className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-label-sm uppercase tracking-widest text-on-surface-variant block">
              Daily Readiness
            </span>
            <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
              {t('vault.checklistTitle')}
            </h2>
          </div>
          <span
            className={`px-3 py-1 rounded-full font-label-sm font-bold ${
              checkedCount === vaultChecklist.length
                ? 'bg-secondary/20 text-secondary'
                : 'bg-primary/20 text-primary'
            }`}
          >
            {checkedCount} of {vaultChecklist.length} Ready
          </span>
        </div>

        {/* Animated Progress Bar */}
        <div className="w-full h-2 rounded-full bg-surface-container-highest overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-secondary-container via-secondary to-primary transition-all duration-300"
            style={{ width: `${Math.round((checkedCount / vaultChecklist.length) * 100)}%` }}
          />
        </div>

        <div className="space-y-2 rounded-2xl bg-surface-container-high/80 p-3 shadow-lg">
          {vaultChecklist.map((item) => (
            <label
              key={item.id}
              className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-container hover:bg-surface-container-highest cursor-pointer transition"
            >
              <div className="flex items-center gap-3 min-w-0">
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={() => {
                    toggleVaultChecklist(item.id);
                    pushToast(item.checked ? 'Checklist item unchecked' : 'Checklist updated — Sanctuary impact synced!', 'success');
                  }}
                  className="w-5 h-5 accent-emerald-400 shrink-0"
                />
                <div className="min-w-0">
                  <div className={`font-body-md font-medium ${item.checked ? 'line-through opacity-75' : 'text-on-surface'}`}>
                    {item.title}
                  </div>
                  <div className="font-body-sm text-on-surface-variant">{item.subtitle}</div>
                </div>
              </div>
              <span className={`material-symbols-outlined text-[20px] ${item.checked ? 'text-secondary' : 'text-outline'}`}>
                {item.checked ? 'verified' : item.icon}
              </span>
            </label>
          ))}
        </div>
      </section>

      {/* Saved Oracle Card Detail Modal */}
      <ModalDialog
        open={Boolean(savedOracleDetail)}
        onClose={() => setSavedOracleDetail(null)}
        title={savedOracleDetail?.title || 'Saved Protocol'}
        maxWidthClass="max-w-xl"
      >
        {savedOracleDetail && (
          <div className="space-y-4">
            <p className="font-body-sm text-on-surface">{savedOracleDetail.summary}</p>
            <div className="space-y-2">
              {savedOracleDetail.steps.map((s) => (
                <div key={s.n} className="p-3 rounded-xl bg-surface-container">
                  <div className="font-label-md font-bold text-primary">
                    {s.n}. {s.label}
                  </div>
                  <p className="text-xs text-on-surface-variant mt-0.5">{s.detail}</p>
                </div>
              ))}
            </div>
            <div className="p-3 rounded-xl bg-surface-container-lowest text-xs text-tertiary">
              <strong>Evidence:</strong> {savedOracleDetail.evidenceNote}
            </div>
            {savedOracleDetail.safetyNote && (
              <div className="p-3 rounded-xl bg-error-container/30 text-xs text-on-error-container">
                {savedOracleDetail.safetyNote}
              </div>
            )}
          </div>
        )}
      </ModalDialog>

      {/* Playbook Detail Modal */}
      <ModalDialog
        open={Boolean(activeDetail)}
        onClose={() => setActiveDetail(null)}
        title={activeDetail?.title || 'Playbook Guide'}
        maxWidthClass="max-w-xl"
      >
        {activeDetail && (
          <div className="space-y-4">
            {detailLoading && (
              <div className="text-xs text-primary flex items-center gap-1.5">
                <span className="material-symbols-outlined animate-spin text-[16px]">sync</span>
                <span>Tailoring instructions to your home profile...</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <div className="p-3 rounded-xl bg-surface-container">
                <div className="font-label-sm text-on-surface-variant uppercase">Setup Time</div>
                <div className="font-label-lg font-bold text-primary">{activeDetail.timeMinutes} mins</div>
              </div>
              <div className="p-3 rounded-xl bg-surface-container">
                <div className="font-label-sm text-on-surface-variant uppercase">Estimated Cost</div>
                <div className="font-label-md font-bold text-on-surface">{activeDetail.costEstimate}</div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-secondary/10 border border-secondary/30">
              <div className="font-label-sm uppercase text-secondary font-bold">Direct Impact (Estimate)</div>
              <p className="font-body-sm text-on-surface mt-0.5">{activeDetail.directImpact}</p>
            </div>

            <div>
              <h3 className="font-label-md uppercase text-primary font-bold mb-1.5">Materials Needed</h3>
              <ul className="list-disc ps-5 space-y-1 text-sm text-on-surface">
                {activeDetail.materials.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="font-label-md uppercase text-primary font-bold mb-1.5">Step-by-Step Assembly</h3>
              <ol className="list-decimal ps-5 space-y-1.5 text-sm text-on-surface">
                {activeDetail.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>

            <div className="p-3 rounded-xl bg-surface-container-lowest text-xs text-tertiary space-y-1">
              <div className="font-bold uppercase">Evidence Level: {activeDetail.evidenceLevel}</div>
              <p className="text-on-surface-variant">{activeDetail.evidenceNote}</p>
            </div>

            {activeDetail.safetyNote && (
              <div className="p-3 rounded-xl bg-error-container/30 text-xs text-on-error-container">
                <strong>Safety Note:</strong> {activeDetail.safetyNote}
              </div>
            )}
          </div>
        )}
      </ModalDialog>
    </div>
  );
};
