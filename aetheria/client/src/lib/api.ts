import type {
  AirQualityData,
  AlertMessage,
  HealthDirectives,
  OracleResponse,
  PlaybookDetail,
  RoutineResponse,
  UserProfile,
  VoiceIntent
} from '@aetheria/shared';

export interface GeocodedPlace {
  name: string;
  country: string;
  admin1?: string;
  lat: number;
  lon: number;
  displayName: string;
  kind?: string;
}

export interface ApiVerifyCheck {
  name: string;
  ok: boolean;
  latencyMs: number;
  detail: string;
}

export interface ApiVerifyResponse {
  ok: boolean;
  checkedAt: string;
  checks: ApiVerifyCheck[];
}

export interface KeyStatusItem {
  name: string;
  required: boolean;
  present: boolean;
  usedFor: string;
  docsUrl: string;
}

export interface HealthApiResponse {
  ok: boolean;
  timestamp: string;
  geminiConfigured: boolean;
  geminiModel: string;
  emergencyNumber: string;
  vapidPublicKey: string | null;
  keys: KeyStatusItem[];
}

export interface CommunitySummary {
  area: string;
  isSeed: boolean;
  seedNotice: string;
  residentsPledged: number;
  totalRealPledges: number;
  totalUgM3Avoided: number;
  totalCo2AvoidedKg: number;
  adoptionPercent: number;
  userJoinedSolidarity: boolean;
  pledges: Array<{
    type: string;
    title: string;
    description: string;
    windowLabel: string;
    icon: string;
    co2KgEstimate: number;
    pm25ImpactLabel: string;
    seedCount: number;
    realCount: number;
    totalCount: number;
    userPledgedToday: boolean;
  }>;
  leaderboard: Array<{
    id: string;
    name: string;
    highlight: string;
    adoptionPercent: number;
    co2AvoidedKg: number;
    isCurrentArea: boolean;
  }>;
}

export interface RoutePlanResponse {
  fromLabel: string;
  toLabel: string;
  mode: 'foot' | 'bike' | 'car';
  isRoadNetwork: boolean;
  cleanest: {
    id: string;
    label: string;
    kind: 'cleanest' | 'fastest';
    provider: string;
    isRoadNetwork: boolean;
    distanceKm: number;
    durationMinutes: number;
    avgPm25: number;
    avgAqi: number;
    cumulativeExposureUgMin: number;
    points: Array<{ lat: number; lon: number; pm25: number; aqi: number }>;
  };
  fastest: {
    id: string;
    label: string;
    kind: 'cleanest' | 'fastest';
    provider: string;
    isRoadNetwork: boolean;
    distanceKm: number;
    durationMinutes: number;
    avgPm25: number;
    avgAqi: number;
    cumulativeExposureUgMin: number;
    points: Array<{ lat: number; lon: number; pm25: number; aqi: number }>;
  };
  exposureReductionPercent: number;
  bestDepartureWindow: {
    label: string;
    pm25: number;
    reason: string;
  };
  waypoints: Array<{
    n: number;
    title: string;
    detail: string;
    etaLabel: string;
    pm25: number;
    lat: number;
    lon: number;
    distanceM?: number;
  }>;
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  health: () => apiFetch<HealthApiResponse>('/api/health'),
  verifyHealth: () => apiFetch<ApiVerifyResponse>('/api/health/verify'),
  geocode: (q: string, lat?: number, lon?: number) =>
    apiFetch<{ results: GeocodedPlace[] }>(
      `/api/geocode?q=${encodeURIComponent(q)}${
        typeof lat === 'number' && typeof lon === 'number'
          ? `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
          : ''
      }`
    ),
  nearbyLandmarks: (lat: number, lon: number) =>
    apiFetch<{ results: GeocodedPlace[] }>(
      `/api/geocode/nearby?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
    ),
  reverseGeocode: (lat: number, lon: number) =>
    apiFetch<{ name: string | null }>(
      `/api/geocode/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
    ),
  getAir: (lat: number, lon: number, name?: string) =>
    apiFetch<AirQualityData>(
      `/api/air?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}${name ? `&name=${encodeURIComponent(name)}` : ''}`
    ),
  generateRoutine: (body: {
    language: string;
    profile: UserProfile;
    lat: number;
    lon: number;
    locationName?: string;
    localTime: string;
  }) =>
    apiFetch<{ data: RoutineResponse; isAiFallback: boolean }>('/api/routine', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  streamOracle: async (
    body: {
      message: string;
      history?: Array<{ role: 'user' | 'model'; text: string }>;
      language: string;
      profile: UserProfile;
      lat?: number;
      lon?: number;
      locationName?: string;
      localTime: string;
      style?: {
        length?: 'short' | 'detailed';
        budgetCap?: string;
        kidFriendly?: boolean;
        elderlyFriendly?: boolean;
      };
      imageBase64?: string;
      imageMimeType?: string;
    },
    onStatus?: (phase: string) => void
  ): Promise<{ data: OracleResponse; isAiFallback: boolean; notice?: string }> => {
    const res = await fetch('/api/oracle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      },
      body: JSON.stringify({ ...body, stream: true })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error((errData as { error?: string }).error || `Oracle error (${res.status})`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream') || !res.body) {
      return (await res.json()) as { data: OracleResponse; isAiFallback: boolean; notice?: string };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: { data: OracleResponse; isAiFallback: boolean; notice?: string } | null = null;

    const processBlocks = (blocks: string[]) => {
      for (const block of blocks) {
        const trimmed = block.trim();
        if (!trimmed) continue;
        const lines = trimmed.split(/\r?\n/);
        let eventName = 'message';
        let dataLine = '';
        for (const l of lines) {
          if (l.startsWith('event:')) eventName = l.slice(6).trim();
          else if (l.startsWith('data:')) dataLine += l.slice(5).trim();
        }
        if (!dataLine) continue;
        const parsed = JSON.parse(dataLine);
        if (eventName === 'status' && onStatus) onStatus(parsed.phase);
        if (eventName === 'card') result = parsed;
        if (eventName === 'error') throw new Error(parsed.error || 'Oracle failed');
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      processBlocks(blocks);
    }

    if (buffer.trim()) {
      processBlocks(buffer.split(/\r?\n\r?\n/));
    }

    if (!result) {
      // Clean non-streaming JSON fallback if SSE stream closed unexpectedly
      return await apiFetch<{ data: OracleResponse; isAiFallback: boolean; notice?: string }>('/api/oracle', {
        method: 'POST',
        body: JSON.stringify({ ...body, stream: false })
      });
    }
    return result;
  },
  getPlaybookDetail: (body: {
    playbookId: string;
    title: string;
    language: string;
    profile: UserProfile;
    lat?: number;
    lon?: number;
    locationName?: string;
  }) =>
    apiFetch<{ data: PlaybookDetail; isAiFallback: boolean }>('/api/playbook', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  getHealthDirectives: (body: {
    dependentName: string;
    ageGroup: string;
    condition: string;
    triggers: string;
    language: string;
    lat: number;
    lon: number;
    locationName?: string;
  }) =>
    apiFetch<{ data: HealthDirectives; isAiFallback: boolean }>('/api/health-directives', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  generateAlertMessage: (body: {
    language: string;
    schoolName: string;
    dependentName: string;
    lat: number;
    lon: number;
    locationName?: string;
  }) =>
    apiFetch<{ data: AlertMessage; isAiFallback: boolean }>('/api/alert-message', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  logAlert: (body: {
    deviceId: string;
    area: string;
    recipient: string;
    channel: string;
    messageBody: string;
  }) =>
    apiFetch<{ ok: boolean }>('/api/alert-log', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  getAlertLogs: (deviceId: string) =>
    apiFetch<{
      logs: Array<{ id: number; area: string; recipient: string; channel: string; messageBody: string; createdAt: string }>;
    }>(`/api/alert-log?deviceId=${encodeURIComponent(deviceId)}`),
  getCommunity: (area: string, deviceId: string) =>
    apiFetch<CommunitySummary>(`/api/community?area=${encodeURIComponent(area)}&deviceId=${encodeURIComponent(deviceId)}`),
  pledge: (body: { deviceId: string; area: string; pledgeType: 'stove_curfew' | 'no_waste_burning' | 'no_idle_carpool' }) =>
    apiFetch<{ alreadyPledgedToday: boolean; community: CommunitySummary }>('/api/pledge', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  joinSolidarity: (body: { deviceId: string; area: string; contactHint?: string; consentGiven: boolean }) =>
    apiFetch<{ ok: boolean; community: CommunitySummary }>('/api/community/join', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  planRoute: (body: {
    from: { lat: number; lon: number; label: string };
    to: { lat: number; lon: number; label: string };
    mode?: 'foot' | 'bike' | 'car';
  }) =>
    apiFetch<RoutePlanResponse>('/api/route', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  translate: (targetLanguage: string, strings: Record<string, string>) =>
    apiFetch<{ bcp47: string; nativeName: string; rtl: boolean; translations: Record<string, string>; isAiFallback: boolean }>(
      '/api/translate',
      {
        method: 'POST',
        body: JSON.stringify({ targetLanguage, strings })
      }
    ),
  resolveLanguage: (query: string) =>
    apiFetch<{ bcp47: string; englishName: string; nativeName: string; rtl: boolean }>('/api/language/resolve', {
      method: 'POST',
      body: JSON.stringify({ query })
    }),
  askTutorial: (question: string, language: string) =>
    apiFetch<{ answer: string; isAiFallback: boolean }>('/api/tutorial/ask', {
      method: 'POST',
      body: JSON.stringify({ question, language })
    }),
  voiceIntent: (transcript: string, language: string, currentRoute: string) =>
    apiFetch<VoiceIntent>('/api/voice-intent', {
      method: 'POST',
      body: JSON.stringify({ transcript, language, currentRoute })
    }),
  stt: (audioBase64: string, mimeType: string, expectedLanguage: string) =>
    apiFetch<{ transcript: string; detectedLanguage: string; detectedBcp47: string }>('/api/stt', {
      method: 'POST',
      body: JSON.stringify({ audioBase64, mimeType, expectedLanguage })
    }),
  tts: (text: string, language: string) =>
    apiFetch<{ available: boolean; audioBase64?: string; mimeType?: string }>('/api/tts', {
      method: 'POST',
      body: JSON.stringify({ text, language })
    }),
  pushSubscribe: (body: { deviceId: string; area: string; alertType?: string; subscription: PushSubscriptionJSON }) =>
    apiFetch<{ ok: boolean }>('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  pushTest: (deviceId: string, title: string, body: string) =>
    apiFetch<{ sent: number; mode: string }>('/api/push/test', {
      method: 'POST',
      body: JSON.stringify({ deviceId, title, body })
    })
};
