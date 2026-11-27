import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProfileSchema, type UserProfile } from '@aetheria/shared';
import { enableNotificationsAndPush } from '../lib/notifications';
import { idbClearAll } from '../lib/idb';
import { useAppStore } from '../store/useAppStore';
import { ModalDialog } from './ModalDialog';

interface ProfileSheetProps {
  open: boolean;
  onClose: () => void;
  onOpenLocation: () => void;
  onOpenLanguage: () => void;
}

const HOUSEHOLD_GROUPS: Array<{ id: UserProfile['householdGroups'][number]; label: string }> = [
  { id: 'infant', label: 'Infant (0–1y)' },
  { id: 'toddler', label: 'Toddler (1–4y)' },
  { id: 'child', label: 'Child' },
  { id: 'adult', label: 'Adult' },
  { id: 'elderly', label: 'Elderly (65+)' },
  { id: 'asthma', label: 'Asthma' },
  { id: 'copd', label: 'COPD' },
  { id: 'pregnancy', label: 'Pregnancy' }
];

export const ProfileSheet: React.FC<ProfileSheetProps> = ({
  open,
  onClose,
  onOpenLocation,
  onOpenLanguage
}) => {
  const navigate = useNavigate();
  const profile = useAppStore((s) => s.profile);
  const updateProfile = useAppStore((s) => s.updateProfile);
  const deviceId = useAppStore((s) => s.deviceId);
  const vapidPublicKey = useAppStore((s) => s.vapidPublicKey);
  const pushToast = useAppStore((s) => s.pushToast);
  const resetAllData = useAppStore((s) => s.resetAllData);
  const language = useAppStore((s) => s.language);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggleGroup = (g: UserProfile['householdGroups'][number]) => {
    const exists = profile.householdGroups.includes(g);
    const next = exists
      ? profile.householdGroups.filter((x) => x !== g)
      : [...profile.householdGroups, g];
    updateProfile({ householdGroups: next.length ? next : ['adult'] });
  };

  const handleEnableNotifications = async () => {
    const res = await enableNotificationsAndPush({
      deviceId,
      area: profile.location?.name || 'Local Area',
      vapidPublicKey
    });
    updateProfile({ notificationsEnabled: res.ok });
    pushToast(res.message, res.ok ? 'success' : 'error');
  };

  const handleExportJson = () => {
    const data = JSON.stringify({ profile, language, exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aetheria-profile-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast('Profile exported as JSON', 'success');
  };

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const validated = ProfileSchema.parse(parsed.profile || parsed);
      updateProfile(validated);
      pushToast('Profile imported successfully', 'success');
    } catch {
      pushToast('Invalid profile JSON file', 'error');
    }
    e.target.value = '';
  };

  const handleReset = async () => {
    await idbClearAll();
    resetAllData();
    pushToast('All local data cleared', 'info');
    onClose();
  };

  return (
    <ModalDialog open={open} onClose={onClose} title="Household Sanctuary Profile" maxWidthClass="max-w-xl">
      <div className="space-y-5">
        {/* Location & Language quick buttons */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenLocation();
            }}
            className="p-3 rounded-xl bg-surface-container hover:bg-surface-container-high text-left flex items-center gap-2.5"
          >
            <span className="material-symbols-outlined text-primary">location_on</span>
            <div className="min-w-0">
              <div className="font-label-sm text-label-sm text-on-surface-variant uppercase">Location</div>
              <div className="font-label-md text-label-md font-semibold truncate">
                {profile.location?.name || 'Set location'}
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenLanguage();
            }}
            className="p-3 rounded-xl bg-surface-container hover:bg-surface-container-high text-left flex items-center gap-2.5"
          >
            <span className="material-symbols-outlined text-secondary">translate</span>
            <div className="min-w-0">
              <div className="font-label-sm text-label-sm text-on-surface-variant uppercase">Language</div>
              <div className="font-label-md text-label-md font-semibold truncate">{language.nativeName}</div>
            </div>
          </button>
        </div>

        {/* Household members */}
        <div>
          <div className="font-label-md text-label-md text-primary font-semibold mb-2">
            Household Members & Sensitivities
          </div>
          <div className="flex flex-wrap gap-2">
            {HOUSEHOLD_GROUPS.map((g) => {
              const active = profile.householdGroups.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => toggleGroup(g.id)}
                  className={`px-3 py-1.5 rounded-full font-label-md text-label-md transition border ${
                    active
                      ? 'bg-primary text-on-primary border-primary font-bold'
                      : 'bg-surface-container text-on-surface-variant border-outline-variant/40'
                  }`}
                >
                  {g.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Home & Fuel & Transport */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="prof-home" className="block font-label-sm text-label-sm text-on-surface-variant uppercase mb-1">
              Home Type
            </label>
            <select
              id="prof-home"
              value={profile.homeType}
              onChange={(e) => updateProfile({ homeType: e.target.value as UserProfile['homeType'] })}
              className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
            >
              <option value="flat">Flat / Apartment</option>
              <option value="house">Independent House</option>
            </select>
          </div>
          <div>
            <label htmlFor="prof-floor" className="block font-label-sm text-label-sm text-on-surface-variant uppercase mb-1">
              Floor Level
            </label>
            <input
              id="prof-floor"
              type="number"
              min={0}
              max={60}
              value={profile.floor}
              onChange={(e) => updateProfile({ floor: Number(e.target.value) || 0 })}
              className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
            />
          </div>
          <div>
            <label htmlFor="prof-fuel" className="block font-label-sm text-label-sm text-on-surface-variant uppercase mb-1">
              Cooking / Heating Fuel
            </label>
            <select
              id="prof-fuel"
              value={profile.fuel}
              onChange={(e) => updateProfile({ fuel: e.target.value as UserProfile['fuel'] })}
              className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
            >
              <option value="lpg">LPG Gas</option>
              <option value="induction">Induction</option>
              <option value="electric">Electric</option>
              <option value="wood">Wood / Biomass</option>
              <option value="coal">Coal / Briquettes</option>
            </select>
          </div>
          <div>
            <label htmlFor="prof-transport" className="block font-label-sm text-label-sm text-on-surface-variant uppercase mb-1">
              Primary Commute
            </label>
            <select
              id="prof-transport"
              value={profile.transport}
              onChange={(e) => updateProfile({ transport: e.target.value as UserProfile['transport'] })}
              className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
            >
              <option value="metro">Metro / Rail</option>
              <option value="bus">Bus</option>
              <option value="walk">Walk</option>
              <option value="cycle">Cycle</option>
              <option value="motorbike">Motorbike / Scooter</option>
              <option value="car">Car</option>
            </select>
          </div>
          <div>
            <label htmlFor="prof-budget" className="block font-label-sm text-label-sm text-on-surface-variant uppercase mb-1">
              Budget Level
            </label>
            <select
              id="prof-budget"
              value={profile.budget}
              onChange={(e) => updateProfile({ budget: e.target.value as UserProfile['budget'] })}
              className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
            >
              <option value="low">Low-cost / DIY first</option>
              <option value="moderate">Moderate</option>
              <option value="flexible">Flexible</option>
            </select>
          </div>
          <div>
            <label htmlFor="prof-purifier-type" className="block font-label-sm text-label-sm text-on-surface-variant uppercase mb-1">
              Filtration Setup
            </label>
            <select
              id="prof-purifier-type"
              value={profile.purifierType}
              onChange={(e) => updateProfile({ purifierType: e.target.value as UserProfile['purifierType'] })}
              className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
            >
              <option value="diyBoxFanMerv13">DIY Box Fan + MERV-13</option>
              <option value="corsiRosenthalCube">Corsi-Rosenthal Cube</option>
              <option value="hepaPurifier">HEPA Air Purifier</option>
            </select>
          </div>
          <div>
            <label htmlFor="prof-currency" className="block font-label-sm text-label-sm text-on-surface-variant uppercase mb-1">
              Currency
            </label>
            <select
              id="prof-currency"
              value={profile.currency}
              onChange={(e) => updateProfile({ currency: e.target.value as 'INR' | 'USD' })}
              className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
            >
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
            </select>
          </div>
          <div>
            <label htmlFor="prof-units" className="block font-label-sm text-label-sm text-on-surface-variant uppercase mb-1">
              Measurement Units
            </label>
            <select
              id="prof-units"
              value={profile.units}
              onChange={(e) => updateProfile({ units: e.target.value as 'metric' | 'imperial' })}
              className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
            >
              <option value="metric">Metric (°C, km, m/s)</option>
              <option value="imperial">Imperial (°F, mi, mph)</option>
            </select>
          </div>
          <div>
            <label htmlFor="prof-school" className="block font-label-sm text-label-sm text-on-surface-variant uppercase mb-1">
              School Name
            </label>
            <input
              id="prof-school"
              type="text"
              value={profile.schoolName}
              onChange={(e) => updateProfile({ schoolName: e.target.value })}
              className="w-full px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-on-surface"
            />
          </div>
        </div>

        {/* Toggles */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { key: 'windowsSealed' as const, label: 'Windows Sealed' },
            { key: 'purifierOwned' as const, label: 'Purifier / Fan Owned' },
            { key: 'hasBalcony' as const, label: 'Has Balcony' },
            { key: 'pets' as const, label: 'Pets at Home' },
            { key: 'plants' as const, label: 'Indoor Plants' },
            { key: 'familySafeMode' as const, label: 'Family Safe Mode' }
          ].map((item) => (
            <label
              key={item.key}
              className="flex items-center justify-between p-2.5 rounded-xl bg-surface-container cursor-pointer"
            >
              <span className="font-body-sm text-body-sm text-on-surface">{item.label}</span>
              <input
                type="checkbox"
                checked={Boolean(profile[item.key])}
                onChange={(e) => updateProfile({ [item.key]: e.target.checked })}
                className="w-4 h-4 accent-amber-500"
              />
            </label>
          ))}
        </div>

        {/* Notifications & Export/Import/Reset */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-outline-variant/30">
          <button
            type="button"
            onClick={() => {
              onClose();
              navigate('/settings');
            }}
            className="px-3.5 py-2 rounded-xl bg-primary text-on-primary font-label-md text-label-md font-bold flex items-center gap-1.5 shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">settings</span>
            <span>All Settings &amp; Preferences</span>
          </button>
          <button
            type="button"
            onClick={handleEnableNotifications}
            className="px-3.5 py-2 rounded-xl bg-secondary-container text-on-secondary-container font-label-md text-label-md font-bold flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">notifications_active</span>
            <span>{profile.notificationsEnabled ? 'Alerts Enabled' : 'Enable Alerts'}</span>
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="px-3.5 py-2 rounded-xl bg-surface-container-high hover:bg-surface-bright text-on-surface font-label-md text-label-md font-semibold flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            <span>Export JSON</span>
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3.5 py-2 rounded-xl bg-surface-container-high hover:bg-surface-bright text-on-surface font-label-md text-label-md font-semibold flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">upload</span>
            <span>Import JSON</span>
          </button>
          <input ref={fileInputRef} type="file" accept="application/json" onChange={handleImportJson} className="hidden" />
          <button
            type="button"
            onClick={handleReset}
            className="px-3.5 py-2 rounded-xl bg-error-container/60 hover:bg-error-container text-on-error-container font-label-md text-label-md font-semibold flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">delete_forever</span>
            <span>Delete All My Data</span>
          </button>
        </div>
      </div>
    </ModalDialog>
  );
};
