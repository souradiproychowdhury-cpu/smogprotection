import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AirQualityData, OracleResponse, RoutineResponse, UserProfile } from '@aetheria/shared';

export interface LanguageConfig {
  code: string;
  bcp47: string;
  englishName: string;
  nativeName: string;
  rtl: boolean;
  chosenByUser: boolean;
}

export interface OracleChatMessage {
  id: string;
  role: 'user' | 'oracle';
  text: string;
  timestamp: string;
  card?: OracleResponse;
  isAiFallback?: boolean;
  notice?: string;
}

export interface SavedPlayItem {
  id: string;
  kind: 'playbook' | 'oracle';
  title: string;
  summary: string;
  savedAt: string;
  card?: OracleResponse;
}

export interface ChecklistItemState {
  id: string;
  title: string;
  subtitle: string;
  checked: boolean;
  icon: string;
}

export interface SymptomLogEntry {
  id: string;
  symptom: string;
  severity: number;
  peakFlow?: number;
  notes: string;
  timestamp: string;
}

export interface DoseLogEntry {
  id: string;
  medicationName: string;
  timestamp: string;
}

export interface VulnerableDependent {
  id: string;
  name: string;
  ageGroup: 'infant' | 'child' | 'adult' | 'elderly';
  ageYears: number;
  condition: string;
  triggers: string;
  medicationName: string;
  remainingDoses: number;
  goalPeakFlow: number;
  currentPeakFlow: number;
  spo2: number;
  restingHr: number;
  hermeticShield: boolean;
  doseLog: DoseLogEntry[];
  symptomLog: SymptomLogEntry[];
}

export interface SavedRouteItem {
  id: string;
  fromLabel: string;
  toLabel: string;
  distanceKm: number;
  durationMinutes: number;
  avgPm25: number;
  reductionPercent: number;
  savedAt: string;
}

export interface ToastItem {
  id: string;
  message: string;
  kind: 'success' | 'info' | 'error';
}

export interface AppState {
  deviceId: string;
  language: LanguageConfig;
  profile: UserProfile;
  air: AirQualityData | null;
  airLoading: boolean;
  airError: string | null;
  routine: RoutineResponse | null;
  completedRoutineByDate: Record<string, string[]>;
  oracleMessages: OracleChatMessage[];
  oracleStyle: {
    length: 'short' | 'detailed';
    budgetCap: string;
    kidFriendly: boolean;
    elderlyFriendly: boolean;
  };
  windAlertSubscribed: boolean;
  vaultBookmarks: SavedPlayItem[];
  vaultChecklist: ChecklistItemState[];
  alertChecklist: ChecklistItemState[];
  dependents: VulnerableDependent[];
  activeDependentId: string;
  savedRoutes: SavedRouteItem[];
  tutorial: {
    active: boolean;
    stepIndex: number;
    autoPlay: boolean;
    paused: boolean;
    practiceTarget: string | null;
    practiceSuccessMessage: string | null;
    completed: boolean;
  };
  a11y: {
    fontSizeOffset: number; // -2 to +4
    voiceOnlyMode: boolean;
    alwaysReadAloud: boolean;
    speechRate: number;
    theme?: 'dark' | 'light' | 'amoled';
    backgroundAnimation?: boolean;
  };
  isOffline: boolean;
  emergencyNumber: string;
  vapidPublicKey: string | null;
  toasts: ToastItem[];

  // Actions
  setLanguage: (lang: LanguageConfig) => void;
  updateProfile: (patch: Partial<UserProfile>) => void;
  setAir: (air: AirQualityData) => void;
  setAirLoading: (loading: boolean) => void;
  setAirError: (err: string | null) => void;
  setRoutine: (routine: RoutineResponse) => void;
  toggleRoutineItem: (itemId: string) => void;
  addOracleMessage: (msg: OracleChatMessage) => void;
  clearOracleChat: () => void;
  setOracleStyle: (patch: Partial<AppState['oracleStyle']>) => void;
  setWindAlertSubscribed: (val: boolean) => void;
  toggleVaultBookmark: (item: SavedPlayItem) => void;
  toggleVaultChecklist: (id: string) => void;
  toggleAlertChecklist: (id: string) => void;
  setActiveDependent: (id: string) => void;
  addDependent: (dep: VulnerableDependent) => void;
  updateDependent: (id: string, patch: Partial<VulnerableDependent>) => void;
  removeDependent: (id: string) => void;
  administerDose: (dependentId: string) => void;
  addSymptomEntry: (dependentId: string, entry: Omit<SymptomLogEntry, 'id' | 'timestamp'>) => void;
  saveRoute: (route: SavedRouteItem) => void;
  setTutorial: (patch: Partial<AppState['tutorial']>) => void;
  setA11y: (patch: Partial<AppState['a11y']>) => void;
  setOffline: (offline: boolean) => void;
  setServerMeta: (meta: { emergencyNumber: string; vapidPublicKey: string | null }) => void;
  pushToast: (message: string, kind?: ToastItem['kind']) => void;
  dismissToast: (id: string) => void;
  resetAllData: () => void;
}

function makeDeviceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const DEFAULT_PROFILE: UserProfile = {
  householdGroups: ['child', 'adult'],
  familySafeMode: true,
  homeType: 'flat',
  floor: 2,
  windowsSealed: true,
  hasBalcony: true,
  fuel: 'lpg',
  transport: 'metro',
  budget: 'low',
  purifierOwned: false,
  purifierRunning: false,
  purifierType: 'diyBoxFanMerv13',
  pets: false,
  plants: true,
  units: 'metric',
  currency: 'INR',
  electricityRate: 8,
  schoolName: 'Local Primary School',
  schoolPhone: '',
  emergencyContactName: 'Family Caregiver',
  emergencyContactPhone: '',
  notificationsEnabled: false,
  location: {
    name: 'New Delhi, India',
    country: 'India',
    lat: 28.6139,
    lon: 77.209
  }
};

const DEFAULT_DEPENDENTS: VulnerableDependent[] = [
  {
    id: 'dep-child',
    name: 'Aarav',
    ageGroup: 'child',
    ageYears: 7,
    condition: 'Pediatric Asthma',
    triggers: 'Winter smog, PM2.5, cold air, traffic diesel',
    medicationName: 'Salbutamol Inhaler + Spacer',
    remainingDoses: 140,
    goalPeakFlow: 260,
    currentPeakFlow: 240,
    spo2: 97,
    restingHr: 84,
    hermeticShield: true,
    doseLog: [],
    symptomLog: []
  },
  {
    id: 'dep-elder',
    name: 'Meera',
    ageGroup: 'elderly',
    ageYears: 72,
    condition: 'COPD & Chronic Bronchitis',
    triggers: 'Wood smoke, high PM2.5, NO2 inversion',
    medicationName: 'Bronchodilator Maintenance Inhaler',
    remainingDoses: 58,
    goalPeakFlow: 210,
    currentPeakFlow: 192,
    spo2: 95,
    restingHr: 74,
    hermeticShield: true,
    doseLog: [],
    symptomLog: []
  }
];

const DEFAULT_VAULT_CHECKLIST: ChecklistItemState[] = [
  {
    id: 'vc-1',
    title: 'Seal bedroom window & door gaps',
    subtitle: 'Reduces outdoor smog infiltration by ~40–65%',
    checked: true,
    icon: 'sensor_window'
  },
  {
    id: 'vc-2',
    title: 'Vent kitchen exhaust during meal prep',
    subtitle: 'Clears indoor NO₂ and cooking particulates',
    checked: false,
    icon: 'skillet'
  },
  {
    id: 'vc-3',
    title: 'Check HEPA / MERV-13 filter & pre-screen',
    subtitle: 'Vacuum pre-filter mesh to preserve airflow',
    checked: false,
    icon: 'filter_alt'
  }
];

const DEFAULT_ALERT_CHECKLIST: ChecklistItemState[] = [
  {
    id: 'ac-1',
    title: 'Keep recess & PE indoors today',
    subtitle: 'Avoid heavy breathing outdoors during inversion',
    checked: false,
    icon: 'sports_soccer'
  },
  {
    id: 'ac-2',
    title: 'Verify reliever inhaler & spacer at school',
    subtitle: 'Confirm nurse / teacher has action plan ready',
    checked: true,
    icon: 'medical_services'
  },
  {
    id: 'ac-3',
    title: 'N95 / FFP2 mask packed for pickup',
    subtitle: 'Use during roadside dismissal walk',
    checked: false,
    icon: 'masks'
  }
];

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      deviceId: makeDeviceId(),
      language: {
        code: 'en',
        bcp47: 'en-US',
        englishName: 'English',
        nativeName: 'English',
        rtl: false,
        chosenByUser: false
      },
      profile: DEFAULT_PROFILE,
      air: null,
      airLoading: false,
      airError: null,
      routine: null,
      completedRoutineByDate: {},
      oracleMessages: [],
      oracleStyle: {
        length: 'short',
        budgetCap: 'low-cost',
        kidFriendly: true,
        elderlyFriendly: false
      },
      windAlertSubscribed: false,
      vaultBookmarks: [],
      vaultChecklist: DEFAULT_VAULT_CHECKLIST,
      alertChecklist: DEFAULT_ALERT_CHECKLIST,
      dependents: DEFAULT_DEPENDENTS,
      activeDependentId: 'dep-child',
      savedRoutes: [],
      tutorial: {
        active: false,
        stepIndex: 0,
        autoPlay: false,
        paused: false,
        practiceTarget: null,
        practiceSuccessMessage: null,
        completed: false
      },
      a11y: {
        fontSizeOffset: 0,
        voiceOnlyMode: false,
        alwaysReadAloud: false,
        speechRate: 1.0,
        backgroundAnimation: true
      },
      isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
      emergencyNumber: '112',
      vapidPublicKey: null,
      toasts: [],

      setLanguage: (language) => set({ language }),
      updateProfile: (patch) => set((s) => ({ profile: { ...s.profile, ...patch } })),
      setAir: (air) => set({ air, airError: null }),
      setAirLoading: (airLoading) => set({ airLoading }),
      setAirError: (airError) => set({ airError }),
      setRoutine: (routine) => set({ routine }),
      toggleRoutineItem: (itemId) => {
        const today = new Date().toISOString().slice(0, 10);
        const current = get().completedRoutineByDate[today] || [];
        const exists = current.includes(itemId);
        const updated = exists ? current.filter((id) => id !== itemId) : [...current, itemId];
        set((s) => ({
          completedRoutineByDate: { ...s.completedRoutineByDate, [today]: updated }
        }));
      },
      addOracleMessage: (msg) =>
        set((s) => ({ oracleMessages: [...s.oracleMessages.slice(-29), msg] })),
      clearOracleChat: () => set({ oracleMessages: [] }),
      setOracleStyle: (patch) =>
        set((s) => ({ oracleStyle: { ...s.oracleStyle, ...patch } })),
      setWindAlertSubscribed: (windAlertSubscribed) => set({ windAlertSubscribed }),
      toggleVaultBookmark: (item) =>
        set((s) => {
          const exists = s.vaultBookmarks.some((b) => b.id === item.id);
          return {
            vaultBookmarks: exists
              ? s.vaultBookmarks.filter((b) => b.id !== item.id)
              : [item, ...s.vaultBookmarks]
          };
        }),
      toggleVaultChecklist: (id) =>
        set((s) => ({
          vaultChecklist: s.vaultChecklist.map((item) =>
            item.id === id ? { ...item, checked: !item.checked } : item
          )
        })),
      toggleAlertChecklist: (id) =>
        set((s) => ({
          alertChecklist: s.alertChecklist.map((item) =>
            item.id === id ? { ...item, checked: !item.checked } : item
          )
        })),
      setActiveDependent: (activeDependentId) => set({ activeDependentId }),
      addDependent: (dep) =>
        set((s) => ({
          dependents: [...s.dependents, dep],
          activeDependentId: dep.id
        })),
      updateDependent: (id, patch) =>
        set((s) => ({
          dependents: s.dependents.map((d) => (d.id === id ? { ...d, ...patch } : d))
        })),
      removeDependent: (id) =>
        set((s) => {
          const remaining = s.dependents.filter((d) => d.id !== id);
          return {
            dependents: remaining,
            activeDependentId:
              s.activeDependentId === id ? remaining[0]?.id || '' : s.activeDependentId
          };
        }),
      administerDose: (dependentId) =>
        set((s) => ({
          dependents: s.dependents.map((d) =>
            d.id === dependentId
              ? {
                  ...d,
                  remainingDoses: Math.max(0, d.remainingDoses - 1),
                  doseLog: [
                    {
                      id: `dose-${Date.now()}`,
                      medicationName: d.medicationName,
                      timestamp: new Date().toISOString()
                    },
                    ...d.doseLog
                  ].slice(0, 30)
                }
              : d
          )
        })),
      addSymptomEntry: (dependentId, entry) =>
        set((s) => ({
          dependents: s.dependents.map((d) =>
            d.id === dependentId
              ? {
                  ...d,
                  currentPeakFlow: entry.peakFlow || d.currentPeakFlow,
                  symptomLog: [
                    {
                      id: `sym-${Date.now()}`,
                      ...entry,
                      timestamp: new Date().toISOString()
                    },
                    ...d.symptomLog
                  ].slice(0, 40)
                }
              : d
          )
        })),
      saveRoute: (route) =>
        set((s) => ({
          savedRoutes: [route, ...s.savedRoutes.filter((r) => r.id !== route.id)].slice(0, 10)
        })),
      setTutorial: (patch) =>
        set((s) => ({ tutorial: { ...s.tutorial, ...patch } })),
      setA11y: (patch) => set((s) => ({ a11y: { ...s.a11y, ...patch } })),
      setOffline: (isOffline) => set({ isOffline }),
      setServerMeta: (meta) => set(meta),
      pushToast: (message, kind = 'info') => {
        const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, kind }] }));
        setTimeout(() => {
          get().dismissToast(id);
        }, 4000);
      },
      dismissToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      resetAllData: () => {
        set({
          language: {
            code: 'en',
            bcp47: 'en-US',
            englishName: 'English',
            nativeName: 'English',
            rtl: false,
            chosenByUser: false
          },
          profile: DEFAULT_PROFILE,
          completedRoutineByDate: {},
          oracleMessages: [],
          windAlertSubscribed: false,
          vaultBookmarks: [],
          vaultChecklist: DEFAULT_VAULT_CHECKLIST,
          alertChecklist: DEFAULT_ALERT_CHECKLIST,
          dependents: DEFAULT_DEPENDENTS,
          activeDependentId: 'dep-child',
          savedRoutes: [],
          tutorial: {
            active: false,
            stepIndex: 0,
            autoPlay: false,
            paused: false,
            practiceTarget: null,
            practiceSuccessMessage: null,
            completed: false
          }
        });
      }
    }),
    {
      name: 'aetheria-state-v1',
      partialize: (state) => {
        const { toasts, airLoading, airError, ...rest } = state;
        return rest;
      }
    }
  )
);
