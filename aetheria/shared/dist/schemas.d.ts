import { z } from 'zod';
export declare const OracleUrgencySchema: z.ZodEnum<["immediate", "today", "this_week", "info"]>;
export declare const OracleStepSchema: z.ZodObject<{
    n: z.ZodNumber;
    label: z.ZodString;
    detail: z.ZodString;
}, "strip", z.ZodTypeAny, {
    n: number;
    label: string;
    detail: string;
}, {
    n: number;
    label: string;
    detail: string;
}>;
export declare const OracleImpactItemSchema: z.ZodObject<{
    metric: z.ZodString;
    value: z.ZodString;
    basis: z.ZodString;
    kind: z.ZodEnum<["health", "money", "carbon", "time"]>;
    isEstimate: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    value: string;
    metric: string;
    basis: string;
    kind: "health" | "money" | "carbon" | "time";
    isEstimate: boolean;
}, {
    value: string;
    metric: string;
    basis: string;
    kind: "health" | "money" | "carbon" | "time";
    isEstimate?: boolean | undefined;
}>;
export declare const OracleRemedySchema: z.ZodObject<{
    title: z.ZodString;
    text: z.ZodString;
    evidence: z.ZodEnum<["strong", "moderate", "weak"]>;
}, "strip", z.ZodTypeAny, {
    title: string;
    text: string;
    evidence: "strong" | "moderate" | "weak";
}, {
    title: string;
    text: string;
    evidence: "strong" | "moderate" | "weak";
}>;
export declare const OracleConfidenceSchema: z.ZodObject<{
    level: z.ZodEnum<["high", "medium", "low"]>;
    reason: z.ZodString;
}, "strip", z.ZodTypeAny, {
    level: "high" | "medium" | "low";
    reason: string;
}, {
    level: "high" | "medium" | "low";
    reason: string;
}>;
export declare const OracleActionSchema: z.ZodObject<{
    type: z.ZodEnum<["open_route", "open_health", "open_alert", "set_reminder", "none"]>;
    label: z.ZodString;
    payload: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    type: "open_route" | "open_health" | "open_alert" | "set_reminder" | "none";
    label: string;
    payload: Record<string, unknown>;
}, {
    type: "open_route" | "open_health" | "open_alert" | "set_reminder" | "none";
    label: string;
    payload?: Record<string, unknown> | undefined;
}>;
export declare const OracleResponseSchema: z.ZodObject<{
    title: z.ZodString;
    urgency: z.ZodEnum<["immediate", "today", "this_week", "info"]>;
    summary: z.ZodString;
    assemblyTime: z.ZodOptional<z.ZodString>;
    steps: z.ZodArray<z.ZodObject<{
        n: z.ZodNumber;
        label: z.ZodString;
        detail: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        n: number;
        label: string;
        detail: string;
    }, {
        n: number;
        label: string;
        detail: string;
    }>, "many">;
    impact: z.ZodArray<z.ZodObject<{
        metric: z.ZodString;
        value: z.ZodString;
        basis: z.ZodString;
        kind: z.ZodEnum<["health", "money", "carbon", "time"]>;
        isEstimate: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        value: string;
        metric: string;
        basis: string;
        kind: "health" | "money" | "carbon" | "time";
        isEstimate: boolean;
    }, {
        value: string;
        metric: string;
        basis: string;
        kind: "health" | "money" | "carbon" | "time";
        isEstimate?: boolean | undefined;
    }>, "many">;
    remedy: z.ZodObject<{
        title: z.ZodString;
        text: z.ZodString;
        evidence: z.ZodEnum<["strong", "moderate", "weak"]>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        text: string;
        evidence: "strong" | "moderate" | "weak";
    }, {
        title: string;
        text: string;
        evidence: "strong" | "moderate" | "weak";
    }>;
    evidenceNote: z.ZodString;
    safetyNote: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    confidence: z.ZodObject<{
        level: z.ZodEnum<["high", "medium", "low"]>;
        reason: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        level: "high" | "medium" | "low";
        reason: string;
    }, {
        level: "high" | "medium" | "low";
        reason: string;
    }>;
    followUps: z.ZodArray<z.ZodString, "many">;
    actions: z.ZodDefault<z.ZodArray<z.ZodObject<{
        type: z.ZodEnum<["open_route", "open_health", "open_alert", "set_reminder", "none"]>;
        label: z.ZodString;
        payload: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        type: "open_route" | "open_health" | "open_alert" | "set_reminder" | "none";
        label: string;
        payload: Record<string, unknown>;
    }, {
        type: "open_route" | "open_health" | "open_alert" | "set_reminder" | "none";
        label: string;
        payload?: Record<string, unknown> | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    title: string;
    urgency: "immediate" | "today" | "this_week" | "info";
    summary: string;
    steps: {
        n: number;
        label: string;
        detail: string;
    }[];
    impact: {
        value: string;
        metric: string;
        basis: string;
        kind: "health" | "money" | "carbon" | "time";
        isEstimate: boolean;
    }[];
    remedy: {
        title: string;
        text: string;
        evidence: "strong" | "moderate" | "weak";
    };
    evidenceNote: string;
    safetyNote: string | null;
    confidence: {
        level: "high" | "medium" | "low";
        reason: string;
    };
    followUps: string[];
    actions: {
        type: "open_route" | "open_health" | "open_alert" | "set_reminder" | "none";
        label: string;
        payload: Record<string, unknown>;
    }[];
    assemblyTime?: string | undefined;
}, {
    title: string;
    urgency: "immediate" | "today" | "this_week" | "info";
    summary: string;
    steps: {
        n: number;
        label: string;
        detail: string;
    }[];
    impact: {
        value: string;
        metric: string;
        basis: string;
        kind: "health" | "money" | "carbon" | "time";
        isEstimate?: boolean | undefined;
    }[];
    remedy: {
        title: string;
        text: string;
        evidence: "strong" | "moderate" | "weak";
    };
    evidenceNote: string;
    confidence: {
        level: "high" | "medium" | "low";
        reason: string;
    };
    followUps: string[];
    assemblyTime?: string | undefined;
    safetyNote?: string | null | undefined;
    actions?: {
        type: "open_route" | "open_health" | "open_alert" | "set_reminder" | "none";
        label: string;
        payload?: Record<string, unknown> | undefined;
    }[] | undefined;
}>;
export type OracleResponse = z.infer<typeof OracleResponseSchema>;
export declare const RoutineItemSchema: z.ZodObject<{
    id: z.ZodString;
    time: z.ZodString;
    title: z.ZodString;
    reason: z.ZodString;
    impactChip: z.ZodString;
    secondaryChip: z.ZodOptional<z.ZodString>;
    category: z.ZodEnum<["commute", "ventilation", "filtration", "cooking", "health"]>;
    icon: z.ZodString;
}, "strip", z.ZodTypeAny, {
    time: string;
    title: string;
    reason: string;
    id: string;
    impactChip: string;
    category: "health" | "commute" | "ventilation" | "filtration" | "cooking";
    icon: string;
    secondaryChip?: string | undefined;
}, {
    time: string;
    title: string;
    reason: string;
    id: string;
    impactChip: string;
    category: "health" | "commute" | "ventilation" | "filtration" | "cooking";
    icon: string;
    secondaryChip?: string | undefined;
}>;
export declare const RoutineResponseSchema: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        time: z.ZodString;
        title: z.ZodString;
        reason: z.ZodString;
        impactChip: z.ZodString;
        secondaryChip: z.ZodOptional<z.ZodString>;
        category: z.ZodEnum<["commute", "ventilation", "filtration", "cooking", "health"]>;
        icon: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        time: string;
        title: string;
        reason: string;
        id: string;
        impactChip: string;
        category: "health" | "commute" | "ventilation" | "filtration" | "cooking";
        icon: string;
        secondaryChip?: string | undefined;
    }, {
        time: string;
        title: string;
        reason: string;
        id: string;
        impactChip: string;
        category: "health" | "commute" | "ventilation" | "filtration" | "cooking";
        icon: string;
        secondaryChip?: string | undefined;
    }>, "many">;
    bestVentilationWindow: z.ZodObject<{
        startLabel: z.ZodString;
        endLabel: z.ZodString;
        reason: z.ZodString;
        minutesUntilChange: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        reason: string;
        startLabel: string;
        endLabel: string;
        minutesUntilChange: number;
    }, {
        reason: string;
        startLabel: string;
        endLabel: string;
        minutesUntilChange: number;
    }>;
}, "strip", z.ZodTypeAny, {
    items: {
        time: string;
        title: string;
        reason: string;
        id: string;
        impactChip: string;
        category: "health" | "commute" | "ventilation" | "filtration" | "cooking";
        icon: string;
        secondaryChip?: string | undefined;
    }[];
    bestVentilationWindow: {
        reason: string;
        startLabel: string;
        endLabel: string;
        minutesUntilChange: number;
    };
}, {
    items: {
        time: string;
        title: string;
        reason: string;
        id: string;
        impactChip: string;
        category: "health" | "commute" | "ventilation" | "filtration" | "cooking";
        icon: string;
        secondaryChip?: string | undefined;
    }[];
    bestVentilationWindow: {
        reason: string;
        startLabel: string;
        endLabel: string;
        minutesUntilChange: number;
    };
}>;
export type RoutineResponse = z.infer<typeof RoutineResponseSchema>;
export declare const PlaybookDetailSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    materials: z.ZodArray<z.ZodString, "many">;
    timeMinutes: z.ZodNumber;
    steps: z.ZodArray<z.ZodString, "many">;
    costEstimate: z.ZodString;
    directImpact: z.ZodString;
    evidenceLevel: z.ZodEnum<["strong", "moderate", "weak"]>;
    evidenceNote: z.ZodString;
    safetyNote: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    title: string;
    steps: string[];
    evidenceNote: string;
    safetyNote: string | null;
    id: string;
    materials: string[];
    timeMinutes: number;
    costEstimate: string;
    directImpact: string;
    evidenceLevel: "strong" | "moderate" | "weak";
}, {
    title: string;
    steps: string[];
    evidenceNote: string;
    safetyNote: string | null;
    id: string;
    materials: string[];
    timeMinutes: number;
    costEstimate: string;
    directImpact: string;
    evidenceLevel: "strong" | "moderate" | "weak";
}>;
export type PlaybookDetail = z.infer<typeof PlaybookDetailSchema>;
export declare const HealthDirectivesSchema: z.ZodObject<{
    safeAqiThreshold: z.ZodNumber;
    safePm25Threshold: z.ZodNumber;
    riskStatus: z.ZodString;
    directives: z.ZodArray<z.ZodObject<{
        title: z.ZodString;
        subtitle: z.ZodString;
        body: z.ZodString;
        icon: z.ZodString;
        urgency: z.ZodEnum<["immediate", "scheduled", "info"]>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        urgency: "immediate" | "info" | "scheduled";
        icon: string;
        subtitle: string;
        body: string;
    }, {
        title: string;
        urgency: "immediate" | "info" | "scheduled";
        icon: string;
        subtitle: string;
        body: string;
    }>, "many">;
    twilightWarning: z.ZodString;
    disclaimer: z.ZodString;
}, "strip", z.ZodTypeAny, {
    safeAqiThreshold: number;
    safePm25Threshold: number;
    riskStatus: string;
    directives: {
        title: string;
        urgency: "immediate" | "info" | "scheduled";
        icon: string;
        subtitle: string;
        body: string;
    }[];
    twilightWarning: string;
    disclaimer: string;
}, {
    safeAqiThreshold: number;
    safePm25Threshold: number;
    riskStatus: string;
    directives: {
        title: string;
        urgency: "immediate" | "info" | "scheduled";
        icon: string;
        subtitle: string;
        body: string;
    }[];
    twilightWarning: string;
    disclaimer: string;
}>;
export type HealthDirectives = z.infer<typeof HealthDirectivesSchema>;
export declare const AlertMessageSchema: z.ZodObject<{
    subject: z.ZodString;
    body: z.ZodString;
    protocolCode: z.ZodString;
}, "strip", z.ZodTypeAny, {
    body: string;
    subject: string;
    protocolCode: string;
}, {
    body: string;
    subject: string;
    protocolCode: string;
}>;
export type AlertMessage = z.infer<typeof AlertMessageSchema>;
export declare const VoiceIntentSchema: z.ZodObject<{
    intent: z.ZodEnum<["navigate", "read_aqi", "oracle_question", "mark_checklist", "log_dose", "set_reminder", "send_alert", "start_route", "change_language", "tutorial_control", "unknown"]>;
    params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    replyText: z.ZodString;
    requiresConfirmation: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    params: Record<string, string>;
    intent: "unknown" | "set_reminder" | "navigate" | "read_aqi" | "oracle_question" | "mark_checklist" | "log_dose" | "send_alert" | "start_route" | "change_language" | "tutorial_control";
    replyText: string;
    requiresConfirmation: boolean;
}, {
    intent: "unknown" | "set_reminder" | "navigate" | "read_aqi" | "oracle_question" | "mark_checklist" | "log_dose" | "send_alert" | "start_route" | "change_language" | "tutorial_control";
    replyText: string;
    params?: Record<string, string> | undefined;
    requiresConfirmation?: boolean | undefined;
}>;
export type VoiceIntent = z.infer<typeof VoiceIntentSchema>;
export declare const HouseholdMemberGroupSchema: z.ZodEnum<["infant", "toddler", "child", "adult", "elderly", "asthma", "copd", "pregnancy"]>;
export declare const LocationSchema: z.ZodObject<{
    name: z.ZodString;
    country: z.ZodOptional<z.ZodString>;
    lat: z.ZodNumber;
    lon: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    name: string;
    lat: number;
    lon: number;
    country?: string | undefined;
}, {
    name: string;
    lat: number;
    lon: number;
    country?: string | undefined;
}>;
export declare const ProfileSchema: z.ZodObject<{
    householdGroups: z.ZodDefault<z.ZodArray<z.ZodEnum<["infant", "toddler", "child", "adult", "elderly", "asthma", "copd", "pregnancy"]>, "many">>;
    familySafeMode: z.ZodDefault<z.ZodBoolean>;
    homeType: z.ZodDefault<z.ZodEnum<["flat", "house"]>>;
    floor: z.ZodDefault<z.ZodNumber>;
    windowsSealed: z.ZodDefault<z.ZodBoolean>;
    hasBalcony: z.ZodDefault<z.ZodBoolean>;
    fuel: z.ZodDefault<z.ZodEnum<["lpg", "wood", "coal", "electric", "induction"]>>;
    transport: z.ZodDefault<z.ZodEnum<["walk", "cycle", "motorbike", "car", "bus", "metro"]>>;
    budget: z.ZodDefault<z.ZodEnum<["low", "moderate", "flexible"]>>;
    purifierOwned: z.ZodDefault<z.ZodBoolean>;
    purifierRunning: z.ZodDefault<z.ZodBoolean>;
    purifierType: z.ZodDefault<z.ZodEnum<["hepaPurifier", "diyBoxFanMerv13", "corsiRosenthalCube"]>>;
    pets: z.ZodDefault<z.ZodBoolean>;
    plants: z.ZodDefault<z.ZodBoolean>;
    units: z.ZodDefault<z.ZodEnum<["metric", "imperial"]>>;
    currency: z.ZodDefault<z.ZodEnum<["INR", "USD"]>>;
    electricityRate: z.ZodDefault<z.ZodNumber>;
    schoolName: z.ZodDefault<z.ZodString>;
    schoolPhone: z.ZodDefault<z.ZodString>;
    emergencyContactName: z.ZodDefault<z.ZodString>;
    emergencyContactPhone: z.ZodDefault<z.ZodString>;
    notificationsEnabled: z.ZodDefault<z.ZodBoolean>;
    location: z.ZodDefault<z.ZodNullable<z.ZodObject<{
        name: z.ZodString;
        country: z.ZodOptional<z.ZodString>;
        lat: z.ZodNumber;
        lon: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        name: string;
        lat: number;
        lon: number;
        country?: string | undefined;
    }, {
        name: string;
        lat: number;
        lon: number;
        country?: string | undefined;
    }>>>;
}, "strip", z.ZodTypeAny, {
    windowsSealed: boolean;
    purifierRunning: boolean;
    householdGroups: ("infant" | "toddler" | "child" | "adult" | "elderly" | "asthma" | "copd" | "pregnancy")[];
    familySafeMode: boolean;
    homeType: "flat" | "house";
    floor: number;
    hasBalcony: boolean;
    fuel: "wood" | "coal" | "lpg" | "electric" | "induction";
    transport: "car" | "motorbike" | "bus" | "metro" | "cycle" | "walk";
    budget: "moderate" | "low" | "flexible";
    purifierOwned: boolean;
    purifierType: "hepaPurifier" | "diyBoxFanMerv13" | "corsiRosenthalCube";
    pets: boolean;
    plants: boolean;
    units: "metric" | "imperial";
    currency: "INR" | "USD";
    electricityRate: number;
    schoolName: string;
    schoolPhone: string;
    emergencyContactName: string;
    emergencyContactPhone: string;
    notificationsEnabled: boolean;
    location: {
        name: string;
        lat: number;
        lon: number;
        country?: string | undefined;
    } | null;
}, {
    windowsSealed?: boolean | undefined;
    purifierRunning?: boolean | undefined;
    householdGroups?: ("infant" | "toddler" | "child" | "adult" | "elderly" | "asthma" | "copd" | "pregnancy")[] | undefined;
    familySafeMode?: boolean | undefined;
    homeType?: "flat" | "house" | undefined;
    floor?: number | undefined;
    hasBalcony?: boolean | undefined;
    fuel?: "wood" | "coal" | "lpg" | "electric" | "induction" | undefined;
    transport?: "car" | "motorbike" | "bus" | "metro" | "cycle" | "walk" | undefined;
    budget?: "moderate" | "low" | "flexible" | undefined;
    purifierOwned?: boolean | undefined;
    purifierType?: "hepaPurifier" | "diyBoxFanMerv13" | "corsiRosenthalCube" | undefined;
    pets?: boolean | undefined;
    plants?: boolean | undefined;
    units?: "metric" | "imperial" | undefined;
    currency?: "INR" | "USD" | undefined;
    electricityRate?: number | undefined;
    schoolName?: string | undefined;
    schoolPhone?: string | undefined;
    emergencyContactName?: string | undefined;
    emergencyContactPhone?: string | undefined;
    notificationsEnabled?: boolean | undefined;
    location?: {
        name: string;
        lat: number;
        lon: number;
        country?: string | undefined;
    } | null | undefined;
}>;
export type UserProfile = z.infer<typeof ProfileSchema>;
export interface HourlyAirPoint {
    time: string;
    pm25: number;
    pm10: number;
    no2: number;
    aqi: number;
    windSpeed: number;
    temperature: number;
    boundaryLayerHeight: number;
}
export interface AirQualityData {
    locationName: string;
    lat: number;
    lon: number;
    aqi: number;
    categoryKey: 'pristine' | 'temperate' | 'intrusion' | 'hazardous';
    categoryLabel: string;
    accentWord: string;
    pm25: number;
    pm10: number;
    no2: number;
    o3: number;
    windSpeed: number;
    windDirection: number;
    temperature: number;
    humidity: number;
    boundaryLayerHeight: number;
    inversionDetected: boolean;
    inversionReason: string;
    whoMultiple: number;
    source: string;
    updatedAt: string;
    hourly: HourlyAirPoint[];
    nearbyPoints: Array<{
        name: string;
        lat: number;
        lon: number;
        aqi: number;
        pm25: number;
        isLiveStation?: boolean;
        distanceKm?: number;
        updatedTime?: string;
    }>;
}
